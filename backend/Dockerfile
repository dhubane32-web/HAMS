# Hawana Airways HAMS API — production image (Railway, Render, Fly, VPS).
FROM node:20-alpine
RUN apk add --no-cache wget
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD sh -c 'wget -qO- "http://127.0.0.1:${PORT:-5013}/health/live" || exit 1'

EXPOSE 5013

CMD ["node", "src/index.js"]
