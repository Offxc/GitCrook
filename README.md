<h1 align="center">GitCrook</h1>

<p align="center">
  <strong>$65 a month per site — plus $12 a seat — for a custom domain and analytics? I don't think so.</strong>
</p>

<p align="center">
  A self-hosted documentation platform. Multi-tenant docs sites with a live block editor, custom
  domains, visitor access control and analytics — on your own server, for the price of the server.
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

Or keep the content in Git instead. **[Git Sync](#git-sync)** points a site at a repository and
follows your commits, so the docs stay current when the thing that changed was the code — whether a
teammate or an AI coding agent changed it.

## Why

Hosted documentation tools are genuinely good. They're also a recurring bill, a third party holding
your content, and a feature set you don't control.

The things a docs site actually needs past the free tier — a custom domain, analytics, reader
feedback, proper branding, redirects — are, at time of writing, GitBook's Premium plan: $65 per
site per month billed annually, plus $12 per user per month. Two sites and a couple of teammates
and you're past $1,800 a year to publish Markdown.

GitCrook is the same shape of product with the trade-offs reversed. You run it, you own the
database, the "premium" features are just features, and more sites cost nothing extra. The bill is
whatever your server costs.

It is deliberately **not** an AI product. No assistant, no embeddings, no agent inside it, no
telemetry phoning home. That's most of what the tier above Premium sells, and none of what I wanted.
What it *is* is easy for your own tools to feed: with Git Sync the docs are plain Markdown in a
repository, so whatever writes that Markdown — you, a teammate, or an AI agent working on the code —
keeps the published site up to date. The one external integration is the Git host you point it at.

## Features

**Authoring**
- Live in-place editing on the published page — no separate editor view
- Block editor (BlockNote/ProseMirror): headings, lists, tables, quotes, toggles, columns
- Custom blocks: callouts, steppers, cards, buttons, page links, embeds, math, changelog entries
- Syntax highlighting via Shiki, equations via KaTeX
- Drag to reorder pages, drag into and out of page groups, inline rename
- ~1,400 flat icons for pages, groups and sections, searchable
- Page history with restore, and optimistic-concurrency conflict detection on autosave

**Publishing**
- Multi-tenant: organizations → sites → sections → spaces → variants → pages
- Section tabs, collapsible sidebar groups, breadcrumbs, prev/next, "on this page" with scroll-spy
- Full-text search over page content (PostgreSQL `tsvector`)
- Content variants — parallel versions of a site (v1/v2 of an API, per-region docs)
- Copy or view any page as Markdown — and every page is available at `/{page}.md`, with `llms.txt` and `llms-full.txt`
  per site, for tools and AI agents that read documentation (same visitor access as the page itself)
- RSS feed for changelog-style updates
- PDF export, rendered by a background worker
- **Git Sync** — pages from a GitHub repository, updated on every push (see [below](#git-sync))

**Custom domains**
- Add a domain, verify ownership by DNS TXT record, and it's served with an automatically issued
  certificate
- Certificates are gated by an internal endpoint Caddy asks before issuing, so only verified
  domains get one
- Verification is a DNS lookup only — nothing fetches the candidate domain, so adding one can't be
  used to make the server issue requests on your behalf

**Theming**
- Primary and tint colours, semantic callout colours
- Body/heading/mono font selection plus custom `.woff2` upload
- Corner, depth, link and sidebar styles; light/dark/system with per-visitor override
- Logo and favicon, announcement banner, header nav, footer, social links
- No custom CSS/JS escape hatch, on purpose — themes stay upgradeable

**Access control**
- Discord OAuth sign-in with server-revocable database sessions
- Seven roles (Guest → Admin) cascading across org → site → section → space → page, most specific
  wins, deny by default
- Visitor access: public, members-only, password-protected (Argon2id), or revocable share links
- Sign-up is closed by default: the first sign-in on an empty instance becomes the owner, then only
  allow-listed Discord IDs and people with an email invitation can create an account
  (`SIGNUP_MODE=open` opts in to open sign-up)

**Analytics**
- Pageviews and unique visitors by country, device, browser and referrer
- Page ratings and written feedback, with CSV export
- Top search queries, outbound link clicks, and 404s from external referrers
- Managed redirects to fix broken inbound URLs

## Git Sync

Git Sync lets a site's content live in a Git repository instead of the editor. Connect a
repository, branch and folder, and every push to that branch re-publishes the pages it touched. It
exists for the case where docs change because *code* changed — a pull request, or an AI coding
agent that was asked to keep the documentation current — and nobody should have to open an editor
to reflect it.

Setup, the repository layout, and troubleshooting are in [docs/git-sync/README.md](docs/git-sync/README.md);
the Markdown dialect is specified in [docs/git-sync/FORMAT.md](docs/git-sync/FORMAT.md). Short version:
**Site settings → Git Sync**, enter `owner/repo`, connect. A public repository needs no credentials.

- **Repository → site, one way.** The repository is the source of truth for the pages it
  manages. Those pages are read-only in the editor (enforced on the server, not only hidden in the
  UI) and carry an "Edit on GitHub" link; the rest of the site stays editable as normal. Nothing is
  ever written back to your repository.
- **Push-driven, with a safety net.** A signed webhook triggers a sync within seconds, and the
  worker also polls so a missed delivery heals itself. "Sync now" and "Full re-sync" are there for
  when you don't want to wait.
- **Plain Markdown that GitHub can render.** Ordinary content is CommonMark + GFM. Callouts use
  GitHub's `> [!NOTE]` alert syntax and expandables use `<details>`; richer blocks (tabs, steps,
  columns, cards, changelog entries) use `:::` container directives. Everything degrades to
  readable text in GitHub's own preview and in any editor. Repositories already synced with
  GitBook (`SUMMARY.md`, `.gitbook.yaml`, `{% hint %}` tags) are read as they are.
- **Structure from the folder tree.** Folders and `index.md`/`README.md` become the page tree;
  front matter (`title`, `description`, `icon`, `slug`, `order`, `draft`, `hidden`, `redirect_from`)
  tunes individual pages; an optional `gitcrook.yaml` or `SUMMARY.md` makes the navigation explicit.
- **Stable identity.** A renamed or moved file keeps its page and history and gets an automatic
  redirect from the old URL. A deleted file unpublishes first and is removed after a grace period.
- **Visible and debuggable.** Every sync leaves a run log with per-file diagnostics (file, line,
  stable `GS-…` code). Files left out of the navigation, broken links, missing images and unknown
  directives are warnings you can see, not silent omissions.
- **Safe by construction.** The repository is treated as untrusted input: only the configured
  branch is read, raw HTML is allow-listed, URLs and sizes are validated, images go through the
  same upload pipeline as editor uploads (SVG sanitised), tokens are encrypted at rest, and every
  outbound request goes through the SSRF-checked fetch chokepoint to an allow-listed host.
- **Lossless or locked.** The Markdown ↔ block converter is a written spec with a conformance
  suite and a property-based round-trip test. A page that can't round-trip without loss is never
  offered for write-back; it stays read-only rather than risk rewriting your content.

**Keeping docs current with an AI agent**

An agent doesn't need a GitCrook integration: it edits Markdown in the repository and commits.
[docs/git-sync/agent-guide.md](docs/git-sync/agent-guide.md) is a section to paste into its instruction file
(layout, front matter, the Markdown it may use, how to check its work), and `gitcrook-docs check` validates a
documentation folder locally or in CI with the same parser and messages the server uses
([packages/docs-cli](packages/docs-cli/README.md)).
The published site answers back in a form agents can read: add `.md` to any page's address, or fetch
`/llms.txt` (a table of contents) and `/llms-full.txt` (all the text).

Not yet supported: authenticating as a GitHub App (access tokens only for now), Git hosts other
than GitHub / GitHub Enterprise Server, and previewing a sync in the dashboard before it applies
(`gitcrook-docs check` does the equivalent locally).

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React 19, TypeScript strict) |
| Database | PostgreSQL 18 + Prisma |
| Auth | Auth.js v5 (Discord provider, database sessions) |
| Editor | BlockNote (ProseMirror) |
| Rendering | Shiki, KaTeX |
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

You need a Linux server with Docker (Compose v2), ports 80 and 443 open, and DNS for your root
domain pointing at it.

```bash
cp .env.example .env     # fill in AUTH_SECRET, the Discord credentials, ROOT_DOMAIN,
                         # ROOT_PROTOCOL=https and POSTGRES_PASSWORD, then:
docker compose up -d --build
```

Five services come up: `postgres`, a one-shot `migrate` that applies pending migrations before the
app starts, `web`, `worker`, and `caddy`. Only Caddy is exposed to the internet — Postgres and the
app are on an internal network with no published ports.

**Redeploying:** `git pull && docker compose up -d --build`. The `migrate` service runs before the
new `web` container starts.

**Custom domains:** the tenant points the domain at your server, then adds a TXT record at
`_gitcrook-challenge.<their-hostname>` with the `gitcrook-verify=…` value the dashboard shows. Caddy
only issues a certificate for a hostname once it is verified.

**State and backups:** two named volumes must survive redeploys — `pgdata` (the database) and
`uploads` (images, fonts and generated PDFs, shared between `web` and `worker`). Nothing backs them
up for you: schedule a `pg_dump` and a snapshot of `uploads`. Run the stack under something that
restarts it after a reboot (a systemd unit that runs `docker compose up -d` works); the `postgres`
service has no restart policy of its own.

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
| `SIGNUP_MODE` | no | `closed` (default) or `open`. Closed admits only allow-listed Discord IDs, people holding an email invitation (their Discord email must be verified) and, on an empty database, the first sign-in, who becomes the owner. People who already have an account can always sign in. `open` lets any Discord account create its own organization — and publish under your domain. |
| `ALLOWED_DISCORD_IDS` | no | Comma-separated Discord user IDs that may create an account. Setting it also turns off *first sign-in becomes the owner*, so list your own ID before exposing a new deployment (or sign in yourself the moment it comes up). |
| `STORAGE_DIR` | no | Upload directory. Compose points this at the shared volume. |
| `GIT_SYNC_ENCRYPTION_KEY` | for private repositories | Encrypts saved access tokens (AES-256-GCM). `openssl rand -base64 32`. Public repositories need no key. `GIT_SYNC_ENCRYPTION_KEYS_PREVIOUS` holds older keys during a rotation. |
| `GITHUB_WEBHOOK_SECRET` | for push webhooks | 32+ characters. Each repository's own webhook secret is derived from it and shown on the Git Sync page. Without it the worker polls instead. |
| `GITHUB_API_URL`, `GIT_SYNC_ALLOWED_HOSTS`, `GIT_SYNC_CONCURRENCY` | no | GitHub Enterprise Server API base, the hosts the worker may contact, and how many repositories sync at once. Details in [docs/git-sync/README.md](docs/git-sync/README.md#configuration). |
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
  worker/                 Background jobs (PDF export, Git Sync runs)
packages/
  db/                     Prisma schema, migrations, seed, local dev Postgres
  auth/                   Auth.js config, RBAC, visitor access
  shared/                 Env schema, theme schema, block schemas, SSRF-safe fetch, utilities
  markdown/               Markdown ↔ blocks (GitCrook Markdown), navigation builder
  git-sync/               GitHub client, sync engine, run queue, webhook handling
  docs-cli/               gitcrook-docs: check a documentation folder locally or in CI
  assets/                 Upload pipeline: type detection, image re-encoding, SVG sanitiser
docs/git-sync/            Git Sync setup guide and the Markdown format specification
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
  are re-encoded through sharp, which strips EXIF and neutralises polyglot files. SVG is parsed and
  rebuilt from an allow-list of elements and attributes (no scripts, handlers, external references or
  `foreignObject`) and is also served with a sandboxing CSP. Everything is served through a route
  that re-checks the requester's access to the owning resource, so a private site's attachments
  inherit its permissions.
- **Outbound requests** on user-supplied URLs go through one chokepoint: HTTPS only, resolved IPs
  checked against private and link-local ranges, redirects re-validated per hop, and the check runs
  inside the socket's own DNS lookup so there is no gap between "validated" and "connected" for a
  rebinding DNS record to use. Git Sync, the feature that makes server-initiated requests, uses only
  this, and only to hosts the operator lists.
- **Secrets**: site passwords are Argon2id; Discord OAuth tokens are never persisted, since only
  identity is needed. Git Sync access tokens are encrypted at rest (AES-256-GCM, bound to their own
  record, key-rotatable), decrypted only inside the worker, and scrubbed from logs and stored messages.
- **Webhooks** are verified by HMAC over the raw body before anything is parsed, compared in constant
  time, with a secret that belongs to one connected repository (derived from the server's); with no
  secret configured they are refused.
- **Audit log** records sensitive actions — role changes, domain add/verify/revoke, password
  changes, site and section deletions — against the acting user.

Found something? Open a security advisory on the repository rather than a public issue.

## Status

Actively developed and running in production, but young. Known gaps, so nobody discovers them the
hard way:

- **Git Sync is new.** It reads GitHub and GitHub Enterprise Server with access tokens, one way. A
  GitHub App login, other Git hosts and a dry-run preview in the dashboard are still to come
  ([PLAN.md](PLAN.md)). `gitcrook-docs` is not published to a package registry yet; you build the
  single-file checker from this repository.
- **Domain re-verification is manual.** Verifying is a button; there's no scheduled job re-checking
  a verified domain, so `NEEDS_REVERIFICATION` in the schema is currently unreachable.
- **OG images are schema-only.** The theme has an `ogImage` option that nothing reads yet, and
  there is no `sitemap.xml`, `robots.txt` or canonical/OpenGraph metadata.
- **Mermaid diagrams are not implemented.** The dependency is installed but nothing renders it.
- **Section groups** (folders around sections) are modelled but have no UI — sections themselves do.
- **Drafts publish immediately.** Saving an edit makes it live; there's no draft/publish staging.
- **Rough edges in multi-section and multi-variant sites.** Pages created from the live sidebar
  always land in the first section's default variant, and sidebar links don't carry the
  section/variant prefix. Both are tracked in [PLAN.md](PLAN.md).
- **Share links open one page.** Following a link inside the site loses the token.
- **PDF export renders public pages only**, and search matches whole words only.

## Not included, on purpose

No AI features inside the product. No third-party integrations beyond the Git host you connect for
Git Sync. No billing. No real-time multi-cursor collaboration (autosave is last-write-wins with
conflict detection). No change-request review workflow — editing is direct, and `Space.editMode`
is reserved for that if it lands later. Git Sync starts one-way (repository → site); write-back, if
it comes, goes through pull requests rather than direct commits.

## Contributing

```bash
pnpm install
cp .env.example .env        # fill in, as in Quick start
pnpm --filter @gitcrook/db dev:pg
pnpm db:deploy && pnpm db:seed
pnpm dev
```

[PLAN.md](PLAN.md) is the working backlog: audited fixes, the Git Sync build plan and the order to
do them in. Start there if you want to pick something up.

CI runs on every pull request and every push to `main`: lint, typecheck, unit tests, a migration
history check, a production build, the integration tests against a real PostgreSQL 18 service
(which also applies the whole migration chain and the seed), end-to-end tests in Chromium, a
dependency audit, and a build of both Docker images. Run the same locally with:

```bash
pnpm lint
pnpm typecheck
pnpm test                   # unit tests, no database needed
pnpm check:migrations
pnpm build
pnpm test:integration       # needs DATABASE_URL pointing at a throwaway Postgres
```

The Markdown dialect has a conformance suite (`packages/markdown/fixtures`) and a property-based
round-trip test; if you change the format, change [docs/git-sync/FORMAT.md](docs/git-sync/FORMAT.md)
and the fixtures with it.

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
