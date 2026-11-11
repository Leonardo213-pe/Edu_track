FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund
COPY apps/web apps/web
RUN npm run build -w @edutrack/web
FROM nginxinc/nginx-unprivileged:stable-alpine
USER root
# openssl only creates the local self-signed certificate on first start (infra/tls-selfsigned.sh).
RUN apk add --no-cache openssl && mkdir -p /etc/nginx/tls && chown 101:101 /etc/nginx/tls
COPY --chmod=755 infra/tls-selfsigned.sh /docker-entrypoint.d/05-tls-selfsigned.sh
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080 8443
