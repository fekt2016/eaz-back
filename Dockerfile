# ============================================
# Multi-stage Dockerfile for Node.js Backend
# Production-ready, optimized for AWS EC2
# ============================================

# Stage 1: Dependencies and Build
FROM node:20-alpine AS dependencies

# Set working directory
WORKDIR /app

# Install security updates and required packages
RUN apk add --no-cache \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for potential builds)
RUN npm ci --only=production --no-audit --no-fund && \
    npm cache clean --force

# Stage 2: Production Image
FROM node:20-alpine AS production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy node_modules from dependencies stage
COPY --from=dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs . .

# Create logs directory with proper permissions
RUN mkdir -p /app/logs && \
    chown -R nodejs:nodejs /app/logs

# Set environment to production
ENV NODE_ENV=production

# Expose port (internal only - not exposed to host)
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Switch to non-root user
USER nodejs

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "src/server.js"]

