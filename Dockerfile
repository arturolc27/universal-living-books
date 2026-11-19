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

# Stage 2: Hardened non-root Nginx runtime
FROM nginx:1.27-alpine AS runner

RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# Ensure non-root nginx user can run with read-only rootfs and /tmp pid
RUN sed -i 's|/run/nginx.pid|/tmp/nginx.pid|g' /etc/nginx/nginx.conf \
  && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

ENTRYPOINT ["nginx", "-g", "daemon off;"]
