# Docker Deployment Guide for Saiisai Backend

## Overview
This guide covers deploying the Saiisai backend to AWS EC2 using Docker and Docker Compose v2.

## Architecture
- **Backend**: Node.js Express API in Docker container
- **Database**: MongoDB Atlas (external)
- **Reverse Proxy**: Nginx on EC2 host
- **SSL**: Certbot on EC2 host
- **Domain**: api.saiisai.com

## Prerequisites

1. **AWS EC2 Instance**
   - Ubuntu 22.04 LTS or Amazon Linux 2023
   - Minimum: 2 vCPU, 4GB RAM
   - Security Group: Port 80, 443 open to 0.0.0.0/0

2. **Installed on EC2 Host**
   ```bash
   # Docker & Docker Compose v2
   sudo apt update
   sudo apt install -y docker.io docker-compose-plugin
   sudo systemctl enable docker
   sudo usermod -aG docker $USER
   
   # Nginx
   sudo apt install -y nginx
   
   # Certbot
   sudo apt install -y certbot python3-certbot-nginx
   ```

## Setup Steps

### 1. Clone Repository on EC2
```bash
cd /opt
sudo git clone <your-repo-url> saiisai-backend
cd saiisai-backend/backend
```

### 2. Create Production .env File
```bash
# Copy and edit .env file
cp .env.example .env
nano .env
```

**Required Environment Variables:**
```env
NODE_ENV=production
PORT=4000
HOST=0.0.0.0

# MongoDB Atlas
MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/dbname
DATABASE_PASSWORD=your_db_password

# JWT
JWT_SECRET=your-super-secret-jwt-key-min-32-chars

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# SendGrid
SENDGRID_API_KEY=your-sendgrid-api-key

# Additional (if needed)
FRONTEND_URL=https://saiisai.com
MAIN_APP_URL=https://saiisai.com
```

### 3. Configure Nginx Reverse Proxy

Create `/etc/nginx/sites-available/api.saiisai.com`:

```nginx
server {
    listen 80;
    server_name api.saiisai.com;

    # Redirect HTTP to HTTPS (after SSL setup)
    # return 301 https://$server_name$request_uri;

    # For initial setup (before SSL), proxy to backend:
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint (optional: direct access)
    location /health {
        proxy_pass http://127.0.0.1:4000/health;
        access_log off;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/api.saiisai.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Build and Start Docker Container

```bash
cd /opt/saiisai-backend/backend

# Build the image
docker compose build

# Start the container
docker compose up -d

# Check logs
docker compose logs -f backend

# Check health
curl http://localhost:4000/health
```

### 5. Setup SSL with Certbot

```bash
# Stop nginx temporarily
sudo systemctl stop nginx

# Get SSL certificate
sudo certbot certonly --standalone -d api.saiisai.com

# Update nginx config to use SSL (see SSL config below)
sudo nano /etc/nginx/sites-available/api.saiisai.com

# Restart nginx
sudo systemctl start nginx
```

**SSL-enabled Nginx Config:**
```nginx
server {
    listen 80;
    server_name api.saiisai.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.saiisai.com;

    ssl_certificate /etc/letsencrypt/live/api.saiisai.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.saiisai.com/privkey.pem;
    
    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Increase body size limit if needed
        client_max_body_size 10M;
    }

    location /health {
        proxy_pass http://127.0.0.1:4000/health;
        access_log off;
    }
}
```

### 6. Verify Deployment

```bash
# Check container status
docker compose ps

# Check container logs
docker compose logs backend

# Test health endpoint
curl https://api.saiisai.com/health

# Test API endpoint
curl https://api.saiisai.com/api/v1/products
```

## Management Commands

### Container Management
```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View logs
docker compose logs -f backend

# Restart backend
docker compose restart backend

# Rebuild after code changes
docker compose build backend
docker compose up -d backend

# Execute commands in container
docker compose exec backend sh
```

### Monitoring
```bash
# Container stats
docker stats saiisai-backend

# Health check status
docker inspect saiisai-backend | grep Health -A 10

# Container processes
docker top saiisai-backend
```

## Security Best Practices

1. **.env File Permissions**
   ```bash
   chmod 600 .env
   chown root:root .env
   ```

2. **Firewall (UFW)**
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

3. **Regular Updates**
   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Rebuild container after Node.js updates
   docker compose build --no-cache
   docker compose up -d
   ```

4. **Log Rotation**
   - Docker logs: Configured in docker-compose.yml (max 10MB, 3 files)
   - Application logs: Configured in app (check logs/ directory)

## Troubleshooting

### Container Won't Start
```bash
# Check logs
docker compose logs backend

# Check environment variables
docker compose config

# Test .env file
docker compose exec backend env | grep MONGO_URL
```

### Port Already in Use
```bash
# Check what's using port 4000
sudo lsof -i :4000

# Or use netstat
sudo netstat -tlnp | grep 4000
```

### Database Connection Issues
```bash
# Test MongoDB connection from container
docker compose exec backend node -e "require('mongoose').connect(process.env.MONGO_URL).then(() => console.log('Connected')).catch(e => console.error(e))"
```

### Nginx 502 Bad Gateway
- Check if container is running: `docker compose ps`
- Check backend logs: `docker compose logs backend`
- Test backend directly: `curl http://127.0.0.1:4000/health`

## Backup & Recovery

### Backup Environment
```bash
# Backup .env file
sudo cp .env .env.backup.$(date +%Y%m%d)
```

### Backup Logs
```bash
# Logs are in ./logs directory (mounted volume)
tar -czf logs-backup-$(date +%Y%m%d).tar.gz logs/
```

## Auto-restart on Reboot

Docker Compose services with `restart: unless-stopped` will auto-start on reboot. To ensure Docker starts:

```bash
sudo systemctl enable docker
```

## Monitoring & Health Checks

- **Health Endpoint**: `https://api.saiisai.com/health`
- **Container Health**: Configured in docker-compose.yml
- **Nginx Status**: `sudo systemctl status nginx`

## Updates & Deployments

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker compose build
docker compose up -d

# Zero-downtime (with proper load balancing)
# Use blue-green deployment or rolling updates
```

## Notes

- Backend only listens on `127.0.0.1:4000` (localhost) - not exposed to internet
- Nginx handles all external traffic
- SSL termination at Nginx level
- MongoDB Atlas connection from container (ensure security group allows)
- Logs persist in `./logs` directory on host


