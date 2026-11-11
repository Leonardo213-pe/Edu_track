# SIMULADO: Registro Académico de demostración (servicio externo al LMS, sin dependencias npm).
FROM node:24-alpine
WORKDIR /registry
COPY infra/registry/server.mjs infra/registry/sections.json ./
USER node
EXPOSE 4010
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:4010/health || exit 1
CMD ["node", "server.mjs"]
