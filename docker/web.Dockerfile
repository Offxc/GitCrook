# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: install with just the manifests, so this layer only rebuilds when a
# dependency actually changes, not on every source edit. -----------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
# apps/worker's own manifest has to be present too — pnpm's lockfile encodes
# the whole workspace, so `install --frozen-lockfile` needs every member's
# package.json even though this image only ever builds/runs @voiddocs/web.
# `prisma generate` (packages/db's postinstall) only needs the schema to exist
# and DATABASE_URL to be syntactically present — it does not connect to a
# database. The real value is injected by Docker Compose at container start.
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
COPY packages/db/prisma packages/db/prisma
COPY packages/db/prisma.config.ts packages/db/prisma.config.ts
RUN pnpm install --frozen-lockfile

# ---- build: full source, produce Next.js's standalone output -----------------
FROM base AS build
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
COPY --from=deps /repo ./
COPY . .
RUN pnpm --filter @voiddocs/web build

# ---- runtime: minimal image, non-root, only the traced output files ----------
FROM node:22-alpine AS runtime
RUN addgroup -S voiddocs && adduser -S voiddocs -G voiddocs
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=voiddocs:voiddocs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=voiddocs:voiddocs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=voiddocs:voiddocs /repo/packages/db/generated ./packages/db/generated
USER voiddocs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
