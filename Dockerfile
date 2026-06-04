FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/sdk/package*.json ./packages/sdk/
COPY packages/server/package*.json ./packages/server/
COPY packages/debugger/package*.json ./packages/debugger/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build all packages
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy package files for production install
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/sdk/package*.json ./packages/sdk/
COPY packages/server/package*.json ./packages/server/
COPY packages/debugger/package*.json ./packages/debugger/

# Install production dependencies only
RUN npm install --production

# Copy built files from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/debugger/dist ./packages/debugger/dist

# Copy static files
COPY packages/debugger/index.html ./packages/debugger/
COPY examples ./examples

# Expose port
EXPOSE 9777

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9777/remotr.js', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["npm", "start"]
