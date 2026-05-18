# Hawana Airways HAMS API — production image (Railway, Render, Fly, VPS).
FROM node:20-alpine
RUN apk add --no-cache wget
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=5013
EXPOSE 5013

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "src/index.js"]
