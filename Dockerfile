# Build stage: install production dependencies.
# Compiler tools are only a fallback in case the SQLite library has no
# prebuilt Alpine binary; they never reach the final image.
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage: Node only, no package managers.
FROM node:22-alpine

# npm, corepack and yarn are not needed to run the app, and their bundled
# dependencies are what the vulnerability scan flagged.
RUN rm -rf /usr/local/lib/node_modules \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js ./
COPY public ./public

# SQLite database lives here; the non-root user must be able to write to it.
ENV DATABASE_PATH=/app/data/tasks.db
RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 3000

USER node
CMD ["node", "server.js"]
