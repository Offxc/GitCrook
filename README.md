<h1 align="center">GitCrook</h1>

<p align="center">
  <strong>A self-hosted documentation platform.</strong><br>
  Multi-tenant docs sites with a live block editor, custom domains, visitor access control and analytics — on your own server.
</p>

<p align="center">
  <a href="https://github.com/Offxc/GitCrook/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Offxc/GitCrook/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: PolyForm Noncommercial 1.0.0" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue.svg"></a>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black.svg">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg">
  <img alt="PostgreSQL 18" src="https://img.shields.io/badge/PostgreSQL-18-336791.svg">
  <img alt="Self-hosted" src="https://img.shields.io/badge/deploy-Docker%20Compose-2496ED.svg">
</p>

---

GitCrook is a documentation platform you host yourself. One deployment serves any number of
organizations, each with their own docs sites, published either at `yourdomain.com/{site-slug}`
or at a customer's own verified domain with automatic HTTPS.

Content is edited **in place on the published page** — the structure you see while editing is the
structure a reader sees. There's no separate authoring app to switch to, and no build step between
writing and publishing.

## Why

Hosted documentation tools are excellent, and also a recurring bill, a third party holding your
content, and a feature set you don't control. GitCrook is the same shape of product with the
trade-offs reversed: you run it, you own the database, and the premium-tier features are just
features.

It is deliberately **not** an AI product. There is no assistant, no embeddings, no third-party
integrations, and no telemetry phoning home.

## Features

**Authoring**
- Live in-place editing on the published page — no separate editor view
- Block editor (BlockNote/ProseMirror): headings, lists, tables, quotes, toggles, columns
- Custom blocks: callouts, steppers, cards, buttons, page links, embeds, math, changelog entries
- Syntax highlighting via Shiki, diagrams via Mermaid, equations via KaTeX
- Drag to reorder pages, drag into and out of page groups, inline rename
- ~1,400 flat icons for pages, groups and sections, searchable
- Page history with restore, and optimistic-concurrency conflict detection on autosave

**Publishing**
- Multi-tenant: organizations → sites → sections → spaces → variants → pages
- Section tabs, collapsible sidebar groups, breadcrumbs, prev/next, "on this page" with scroll-spy
- Full-text search over page content (PostgreSQL `tsvector`)
- Content variants — parallel versions of a site (v1/v2 of an API, per-region docs)
- Copy or view any page as Markdown
- RSS feed for changelog-style updates
- PDF export, rendered by a background worker

**Custom domains**
- Add a domain, verify ownership by DNS TXT record, and it's served with an automatically issued
  certificate
- Certificates are gated by an internal endpoint Caddy asks before issuing, so only verified
  domains get one
- Verification is a DNS lookup only — nothing fetches the candidate domain, so adding one can't be
  used to make the server issue requests on your behalf

**Theming**
- Four theme styles, primary and tint colours, semantic callout colours
- Body/heading/mono font selection plus custom `.woff2` upload
- Corner, depth, link, icon and sidebar styles; light/dark/system with per-visitor override
- Logo and favicon, announcement banner, header nav, footer, social links
- No custom CSS/JS escape hatch, on purpose — themes stay upgradeable

**Access control**
- Discord OAuth sign-in with server-revocable database sessions
- Seven roles (Guest → Admin) cascading across org → site → section → space → page, most specific
  wins, deny by default
- Visitor access: public, members-only, password-protected (Argon2id), or revocable share links
- Optional sign-in allowlist by Discord user ID

**Analytics**
- Pageviews and unique visitors by country, device, browser and referrer
- Page ratings and written feedback, with CSV export
- Top search queries, outbound link clicks, and 404s from external referrers
- Managed redirects to fix broken inbound URLs

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React 19, TypeScript strict) |
| Database | PostgreSQL 18 + Prisma |
| Auth | Auth.js v5 (Discord provider, database sessions) |
| Editor | BlockNote (ProseMirror) |
| Rendering | Shiki, KaTeX, Mermaid |
| Background jobs | Node worker + Playwright/Chromium (PDF export) |
| Reverse proxy / TLS | Caddy 2 with on-demand certificates |
| Deployment | Docker Compose, supervised by systemd |

No Redis, no message broker, no search service — rate limiting is in-process and search is
PostgreSQL's own. Fewer moving parts to run and patch.

## Quick start

Requirements: **Node 20+** (22 recommended, matching the Docker images), **pnpm**, and either
Docker or nothing at all — local development can run PostgreSQL as a managed child process, so
Docker is only needed for deployment.

```bash
git clone https://github.com/Offxc/GitCrook.git gitcrook
cd gitcrook
pnpm install
cp .env.example .env
```

Fill in `.env`. The two values with no sensible default:

```bash
# 32+ characters
openssl rand -base64 32
```

Put that in `AUTH_SECRET`, then create a Discord application
(Discord Developer Portal → New Application → OAuth2) and set `AUTH_DISCORD_ID` /
`AUTH_DISCORD_SECRET`, with `http://localhost:3000/api/auth/callback/discord` as a redirect URI.

Start a local PostgreSQL (runs as a child process — no Docker, no root), then migrate, seed and run:

```bash
pnpm --filter @gitcrook/db dev:pg    # leave running in its own terminal
pnpm db:deploy
pnpm db:seed
pnpm dev
```

The app is on <http://localhost:3000>, the seeded demo site at
<http://localhost:3000/demo-docs/introduction>.

To work on PDF export, run the worker alongside it:

```bash
pnpm worker
```

## Self-hosting

[**RUNBOOK.md**](RUNBOOK.md) is the deployment guide: installing Docker on a fresh Ubuntu server,
the `.env` values, the systemd unit that supervises the Compose stack, DNS records, and the
redeploy procedure.

The short version:

```bash
cp .env.example .env     # fill in, then:
docker compose up -d --build
```

Five services come up: `postgres`, a one-shot `migrate` that applies pending migrations before the
app starts, `web`, `worker`, and `caddy`. Only Caddy is exposed to the internet — Postgres and the
app are on an internal network with no published ports.

Two named volumes must survive redeploys: `pgdata` (the database) and `uploads` (images, fonts and
generated PDFs, shared between `web` and `worker`).

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. Under Compose it's assembled from the `POSTGRES_*` vars below — don't set it directly there. |
| `AUTH_SECRET` | yes | 32+ characters. `openssl rand -base64 32`. |
| `AUTH_DISCORD_ID` | for sign-in | Discord OAuth client ID. |
| `AUTH_DISCORD_SECRET` | for sign-in | Discord OAuth client secret. |
| `ROOT_DOMAIN` | defaults to `localhost:3000` | The domain sites are published under. |
| `ROOT_PROTOCOL` | defaults to `http` | `https` in production. |
| `POSTGRES_PASSWORD` | Compose only | The `postgres` service's password. |
| `POSTGRES_USER` | Compose only | Defaults to `gitcrook`. Postgres applies this only when it initialises an empty data directory, so an existing volume keeps the role it was created with — set this to match one. |
| `POSTGRES_DB` | Compose only | Defaults to `gitcrook`. Same caveat as `POSTGRES_USER`. |
| `ALLOWED_DISCORD_IDS` | no | Comma-separated Discord user IDs. Set it and sign-in is allowlisted; leave it unset and anyone with a Discord account gets their own organization. |
| `STORAGE_DIR` | no | Upload directory. Compose points this at the shared volume. |
| `CHROMIUM_EXECUTABLE_PATH` | no | Local-only; the worker image bakes its own Chromium. |

## Project layout

```
apps/
  web/                    Next.js app — dashboard, published sites, API routes
    app/(published)/      Reader-facing site rendering and in-place editing
    app/(dashboard)/      Org, site and settings management
    lib/editor/           Block definitions, icon set, slash menu
    lib/renderer/         Read-only block renderer (ships no editor JS to readers)
    lib/tenancy/          Host/slug resolution, page tree, access resolution
    proxy.ts              Security headers + multi-tenant host routing
  worker/                 Background jobs (PDF export, domain re-verification)
packages/
  db/                     Prisma schema, migrations, seed, local dev Postgres
  auth/                   Auth.js config, RBAC, visitor access
  shared/                 Env schema, theme schema, block schemas, utilities
docker/                   Dockerfiles and Caddy config
scripts/                  Maintenance scripts (icon set generation)
```

The editor's block definitions and the read-only renderer are separate modules that share one Zod
schema per block. A reader never downloads the editor.

## Security

- **Access control** goes through one function (`canUserDoX`) that walks page → space → section →
  site → membership, most specific override wins, deny by default. Anonymous visitor access is a
  separate function so a `null` user can't fall through an allow branch meant for members.
- **Headers**: nonce-based CSP with `strict-dynamic`, `frame-ancestors`, `Referrer-Policy`,
  `Permissions-Policy`, `nosniff`, set on every response.
- **Uploads** are typed by magic bytes rather than the client's `Content-Type`, and raster images
  are re-encoded through sharp, which strips EXIF and neutralises polyglot files. SVG is rejected
  outright rather than sanitised. Everything is served through a route that re-checks the
  requester's access to the owning resource, so a private site's attachments inherit its
  permissions.
- **Outbound requests** on user-supplied URLs go through one chokepoint: HTTPS only, resolved IPs
  checked against private and link-local ranges, connection pinned to the validated IP, redirects
  re-validated per hop.
- **Secrets**: site passwords are Argon2id; Discord OAuth tokens are never persisted, since only
  identity is needed.
- **Audit log** records sensitive actions — role changes, domain add/verify/revoke, password
  changes, deletions — against the acting user.

Found something? Open a security advisory on the repository rather than a public issue.

## Status

Actively developed and running in production, but young. Known gaps, so nobody discovers them the
hard way:

- **No test suite yet.** A `test` script exists; nothing fills it.
- **Domain re-verification is manual.** Verifying is a button; there's no scheduled job re-checking
  a verified domain, so `NEEDS_REVERIFICATION` in the schema is currently unreachable.
- **OG images are schema-only.** The theme has an `ogImage` option that nothing reads yet.
- **Section groups** (folders around sections) are modelled but have no UI — sections themselves do.
- **Drafts publish immediately.** Saving an edit makes it live; there's no draft/publish staging.

## Not included, on purpose

No AI features. No third-party integrations or Git sync. No billing. No real-time multi-cursor
collaboration (autosave is last-write-wins with conflict detection). No change-request review
workflow — editing is direct, and `Space.editMode` is reserved for that if it lands later.

## Contributing

```bash
pnpm install
pnpm --filter @gitcrook/db dev:pg
pnpm db:deploy && pnpm db:seed
pnpm dev
```

CI runs on every push and pull request: typecheck, a production build, and applying the whole
migration chain plus the seed against a real PostgreSQL 18 service. Run the first two locally with:

```bash
pnpm --filter @gitcrook/web exec tsc --noEmit -p .
pnpm build
```

A `test` script exists but there is no test suite yet — `packages/auth`'s RBAC matrix is the
obvious first target if you want somewhere to start.

Schema changes need care in one specific place: `Page.searchVector` is a generated column Prisma
can't express, so `prisma migrate dev` produces a spurious `DROP INDEX` on every schema change.
Read the comment above that field in `packages/db/prisma/schema.prisma` before generating a
migration.

## License

[PolyForm Noncommercial 1.0.0](LICENSE).

Use it, change it, self-host it, build on it — for any **noncommercial** purpose. Personal and
hobby use, study and research, and charities, schools, public research and government bodies are
all explicitly covered. What the licence does not grant is commercial use: you may not sell it,
run it as a paid service, or use it commercially inside a business.

Attribution is a condition, not a courtesy. If you pass on any part of this software you must
include these terms (or the URL to them) and preserve the `Required Notice:` line at the top of
[LICENSE](LICENSE).

Want to use it commercially? Open an issue and ask — the licence reserves that right rather than
forbidding it forever.

> Note: this is a *source-available* licence, not an OSI-approved open-source one. That's
> deliberate, and it's why GitHub won't label the repository with a recognised licence.

GitCrook is not affiliated with GitBook.
