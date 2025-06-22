# Use official Node.js runtime as base image
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S flowmatik -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=flowmatik:nodejs /app/dist ./dist
COPY --from=builder --chown=flowmatik:nodejs /app/package.json ./

# Create necessary directories
RUN mkdir -p logs uploads temp && chown -R flowmatik:nodejs logs uploads temp

# Switch to non-root user
USER flowmatik

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start:prod"]

# Labels for metadata
LABEL maintainer="Flowmatik Team <team@flowmatik.co>"
LABEL version="1.0.0"
LABEL description="Flowmatik Backend - AI-powered content creation platform"
LABEL org.opencontainers.image.source="https://github.com/flowmatik/backend"

