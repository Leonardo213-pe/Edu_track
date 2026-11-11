FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund
COPY apps/api apps/api
RUN npm run generate && npm run build -w @edutrack/api

FROM base
ENV NODE_ENV=production
WORKDIR /app
# Prisma CLI is retained to apply versioned migrations in this local Compose setup.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/package*.json ./
# Amazon RDS certificate authorities: the API verifies the database TLS certificate (sslmode=verify-full) on AWS.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
RUN chmod 755 /app/certs && mkdir -p /app/storage/courses /app/storage/submissions && chown -R node:node /app/storage
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
