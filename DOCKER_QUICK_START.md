# Docker Quick Start Guide

## Quick Commands

```bash
# Build image
docker compose build

# Start container
docker compose up -d

# View logs
docker compose logs -f backend

# Stop container
docker compose down

# Restart container
docker compose restart backend

# Check status
docker compose ps

# Execute commands in container
docker compose exec backend sh
```

## Health Check Endpoints

- **Basic Health**: `http://localhost:4000/health`
- **Readiness**: `http://localhost:4000/health/ready` (checks DB connection)
- **Liveness**: `http://localhost:4000/health/live` (server alive check)

## Important Notes

1. **Backend only binds to localhost** (`127.0.0.1:4000`) - not exposed to internet
2. **Nginx on host** must be configured to proxy to `http://127.0.0.1:4000`
3. **SSL termination** happens at Nginx level (Certbot)
4. **MongoDB Atlas** must allow EC2 instance IP in network access list
5. **.env file** must exist in backend directory with all required variables

## Container Info

- **Image**: Built from Dockerfile (multi-stage)
- **User**: Runs as non-root (`nodejs` user)
- **Restart Policy**: `unless-stopped`
- **Resource Limits**: 2 CPU, 2GB RAM max
- **Log Retention**: 10MB per file, 3 files rotated
