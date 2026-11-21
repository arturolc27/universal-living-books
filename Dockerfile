# Stage 1: Build static bundle
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

ARG VITE_APP_ACCESS_PIN_SHA256=""
ENV VITE_APP_ACCESS_PIN_SHA256=${VITE_APP_ACCESS_PIN_SHA256}

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Stage 2: Hardened non-root Node.js 24 runtime (SPA + Persistent Sync API)
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

RUN mkdir -p /data/books \
  && chown -R node:node /app /data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["node", "server/index.mjs"]
