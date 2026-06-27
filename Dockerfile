FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

COPY . .
# Next's production build imports server routes in parallel. Without runtime
# DATABASE_URL values the build falls back to SQLite, so give those transient
# workers a disposable DB and enough busy-timeout room for import-time setup.
RUN DB_PATH=/tmp/esports-community-build.sqlite SQLITE_BUSY_TIMEOUT_MS=60000 npm run web:build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
  DB_PATH=/app/data/bot.sqlite \
  LOGO_CACHE_DIR=/app/data/logo-cache \
  LOGO_DOWNLOAD_MIN_GAP_MS=10000 \
  WEB_LOGO_PROXY_DOWNLOADS=false \
  LIQUIPEDIA_CACHE_TTL_MS=900000 \
  LIVE_POLL_INTERVAL_MS=300000 \
  LIQUIPEDIA_RATE_STATE_PATH=/app/data/liquipedia-rate-limit.json \
  LOGO_RATE_STATE_PATH=/app/data/logo-rate-limit.json

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fontconfig fonts-dejavu-core fonts-inter fonts-noto-core \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data \
  && chown -R node:node /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/apps/web ./apps/web
COPY --from=build --chown=node:node /app/src ./src
# Postgres path reads scripts/postgres/schema.sql at boot (ensurePostgresAppSchema).
COPY --from=build --chown=node:node /app/scripts/postgres ./scripts/postgres

USER node

EXPOSE 3000

# Exec Node directly (not `npm run`) so this process is PID 1 and receives
# SIGTERM itself — start-production.js forwards it to the bot/web children and
# exits 0 on a clean stop. Going through npm makes npm PID 1, which mishandles
# the signal and reports a spurious exit 1 on every shutdown.
CMD ["node", "src/start-production.js"]
