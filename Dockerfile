# HAMS API — Railway production image (build from REPO ROOT, not backend/).
# Railway: Root Directory = / (repository root), Dockerfile path = Dockerfile
FROM node:20-alpine
RUN apk add --no-cache wget postgresql-client bash
WORKDIR /app

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/ ./
COPY database/ /database/

ENV NODE_ENV=production
ENV HAMS_DATABASE_DIR=/database
ENV HAMS_RUN_MIGRATIONS_ON_START=true

RUN chmod +x docker-entrypoint.sh

EXPOSE 5013

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD sh -c 'wget -qO- "http://127.0.0.1:${PORT:-5013}/health/live" || wget -qO- "http://127.0.0.1:${PORT:-5013}/api/health" || exit 1'

ENTRYPOINT ["./docker-entrypoint.sh"]
