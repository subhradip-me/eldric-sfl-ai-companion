# ==============================================================================
# Stage 1: Build the React / Vite Client SPA
# ==============================================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app/client

# Copy client dependency manifests
COPY client/package*.json ./

# Install client build dependencies
RUN npm ci --prefer-offline --no-audit || npm install

# Copy client source files
COPY client/ ./

# Build optimized production bundle -> /app/client/dist
RUN npm run build

# ==============================================================================
# Stage 2: Production Server Runner
# ==============================================================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install root dependencies
COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit && npm cache clean --force

# Copy server code, game metadata, and configuration
COPY server/ ./server/
COPY metadata/ ./metadata/
COPY metadata.ts ./
COPY tsconfig.json ./

# Copy compiled frontend from Stage 1 into client/dist
COPY --from=builder /app/client/dist ./client/dist

# Run container as non-root user
USER node

EXPOSE 3000

# Container healthcheck against /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "import('http').then(h => h.get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)))" || exit 1

CMD ["npm", "start"]
