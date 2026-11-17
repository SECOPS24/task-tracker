FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY public ./public

# SQLite database lives here; the non-root user must be able to write to it.
ENV DATABASE_PATH=/app/data/tasks.db
RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 3000

USER node
CMD ["node", "server.js"]
