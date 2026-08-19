# syntax=docker/dockerfile:1
#
# StoReel — two images from one build (see docker-compose.yml):
#
#   target `api` — the Node API plus the whole render pipeline. This is the
#                  container that actually spawns ffmpeg, so it carries ffmpeg,
#                  the fonts, and assets/.
#   target `web` — Caddy serving the built single-page app and terminating TLS,
#                  proxying /api to the container above.
#
# Splitting them this way is what makes G2.3's "HTTPS is mandatory, there is no
# HTTP path" achievable: the API never listens on a public interface at all.

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Dependencies first, so a source-only change does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `build` = web:build (Vite → apps/web/dist) + api:build (tsc → dist/server).
RUN npm run build

# ── API runtime ──────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS api

# ffmpeg is the engine's one hard external dependency. fontconfig is not
# optional either: drawtext resolves faces through it, and without it every
# caption silently falls back to a default face — the failure looks like a
# design bug, not a missing package.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
# Pinned rather than left to PATH discovery so a broken image fails loudly at
# the first render instead of resolving some other ffmpeg.
ENV FFMPEG_PATH=/usr/bin/ffmpeg
# Inside the container this is a private network interface, reachable only
# from the web container — see docker-compose.yml, which does not publish it.
ENV STOREEL_API_HOST=0.0.0.0
ENV STOREEL_API_PORT=8787

# `--omit=dev` is safe only because `tsx` is a real dependency: the render
# phase runs `node --import tsx src/index.ts`, so the TypeScript sources and
# their loader ship to production on purpose.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The fonts the recipes name, installed where fontconfig will find them.
COPY fonts /usr/share/fonts/truetype/storeel
RUN fc-cache -f

COPY --from=build /app/dist ./dist
# Everything the pipeline reads at runtime. Listed file by file rather than
# `COPY . .` so that projects/, temp/, output/ and the development music in
# music/ cannot ride along into a production image.
COPY assets ./assets
COPY fonts ./fonts
COPY layouts ./layouts
COPY schema ./schema
COPY scripts ./scripts
COPY src ./src
COPY story-templates ./story-templates
COPY tsconfig.json ./tsconfig.json

# Customer data and account state. Declared so a `docker run` without the
# compose file still gets a volume rather than writing into the container
# layer, where the next deploy would delete it.
VOLUME ["/app/projects", "/app/server/data"]

EXPOSE 8787
# tini reaps the ffmpeg children. Without an init, a cancelled render leaves a
# zombie per run and PID 1 never collects them.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server/index.js"]

# ── Web runtime ──────────────────────────────────────────────────────────────
FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
