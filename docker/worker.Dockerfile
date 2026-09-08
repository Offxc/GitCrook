# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---- deps ----------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
COPY packages/db/prisma packages/db/prisma
COPY packages/db/prisma.config.ts packages/db/prisma.config.ts
RUN pnpm install --frozen-lockfile

# ---- runtime ---------------------------------------------------------------
# Full source, no build step (the worker runs via tsx, same as its own `dev`
# script — a plain long-running poll loop has no meaningful bundling win, and
# this keeps one less moving piece to keep in sync with apps/web's build).
#
# System Chromium from Alpine's own package index, not Playwright's
# downloader — playwright-core (see apps/worker/package.json) ships with no
# bundled browser at all, so this is the ONLY Chromium in the image, sized
# and patched by Alpine's own security updates rather than a second
# vendored copy. The library list is the well-established minimum Chromium
# needs on musl/Alpine (missing any one of these fails at launch, not at a
# clearly-labeled step).
FROM base AS runtime
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
RUN addgroup -S voiddocs && adduser -S voiddocs -G voiddocs
ENV NODE_ENV=production
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY --from=deps /repo ./
COPY . .
USER voiddocs
CMD ["pnpm", "--filter", "@voiddocs/worker", "exec", "tsx", "src/index.ts"]
