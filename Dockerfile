# ============================================
# Multi-stage Dockerfile for Node.js Backend
# Reliable production build (Docker Compose on EC2)
# ============================================

# NOTE:
# - Uses Debian slim to avoid common native-module issues (e.g., sharp on alpine/musl).
# - Expects runtime env vars to be provided at container start (compose env_file, etc.)

# Stage 1: Install production dependencies
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# Install OS packages needed for a clean runtime and signal handling
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Copy lockfile explicitly (required for npm ci)
COPY package.json package-lock.json ./

# Install only production deps
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# Stage 2: Production runtime
FROM node:20-bookworm-slim AS production

WORKDIR /app

# Minimal runtime packages
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Set default runtime env
ENV NODE_ENV=production
ENV PORT=4000

# Copy dependencies then app source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create non-root user + fix permissions for logs
RUN useradd -m -u 1001 nodejs \
  && mkdir -p /app/logs \
  && chown -R nodejs:nodejs /app

EXPOSE 4000

# Docker healthcheck (no curl dependency required)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||4000) + '/health/live', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

USER nodejs

ENTRYPOINT ["dumb-init", "--"]

# Start in production mode (no nodemon)
CMD ["npm", "run", "start:prod"]

