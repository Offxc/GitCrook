# VoidDocs deployment runbook

Self-hosting VoidDocs on a VPS via a generic AMP (CubeCoders Application Management Portal) instance running Docker Compose. Every step below assumes nothing is set up yet.

## 0. Get the code onto the VPS

This repo isn't in git yet. From your local machine, in the repo root:

```bash
git init
git add .
git commit -m "Initial commit"
```

Create a new **private** repo on GitHub (github.com/new — private, since even though `.env` itself is gitignored, there's no reason to make the source public unless you want to). Then:

```bash
git remote add origin git@github.com:<you>/voiddocs.git
git branch -M main
git push -u origin main
```

On the VPS (over SSH):

```bash
ssh <you>@<vps-ip>
sudo mkdir -p /opt/voiddocs
sudo chown $(whoami):$(whoami) /opt/voiddocs
git clone git@github.com:<you>/voiddocs.git /opt/voiddocs
cd /opt/voiddocs
```

Cloning a private repo on the VPS needs its own auth — either generate a fresh SSH key on the VPS (`ssh-keygen -t ed25519`, add the printed public key under GitHub → Settings → SSH and GPG keys) or use a GitHub Personal Access Token with the HTTPS clone URL instead. Either is fine; pick whichever you already have set up.

`/opt/voiddocs` is this runbook's assumed path from here on — swap it everywhere below if you put it somewhere else.

## 1. DNS — exact record

Log into wherever `voidsmp.com`'s DNS is actually managed (your registrar, or Cloudflare/similar if you've delegated DNS there). Find the **DNS records** / **Zone editor** section, and add:

| Field | Value |
|---|---|
| Type | `A` |
| Name / Host | `docs` — **not** `docs.voidsmp.com`; almost every provider auto-appends the base domain to whatever you type here. If your provider's field is explicitly labeled "full hostname" instead, use `docs.voidsmp.com`. |
| Value / Points to | your VPS's public **IPv4** address |
| TTL | `Auto`, or `3600` if it asks for a number — doesn't matter much for a new record |

If the VPS also has a public IPv6 address, add a second record the same way with **Type `AAAA`** and the IPv6 address as the value. If you don't know whether it has one, skip this — an A record alone is enough.

Don't use a CNAME here — a CNAME points a name at another *hostname*, not an IP, and `ROOT_DOMAIN` needs to resolve straight to the VPS.

**Verify it before moving on** — from your own machine or the VPS:

```bash
dig +short docs.voidsmp.com
```

This should print the VPS's IP address and nothing else. If it prints nothing, DNS hasn't propagated yet (can take a few minutes, occasionally longer) — wait and re-run. Don't skip this check: Caddy requests a certificate on the *first real request* to the domain, and that fails outright if DNS doesn't yet resolve correctly at that moment.

## 2. Discord Application (for sign-in)

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and log in.
2. **New Application** (top right) → give it a name (e.g. "VoidDocs") → accept the terms → **Create**.
3. Left sidebar → **OAuth2** → **General**.
4. Copy the **Client ID** shown there — this is `AUTH_DISCORD_ID`.
5. Under **Client Secret**, click **Reset Secret**, confirm, and copy the value immediately — it's shown once only. This is `AUTH_DISCORD_SECRET`.
6. Still on that OAuth2 page, find **Redirects**, click **Add Redirect**, and enter exactly:
   ```
   https://docs.voidsmp.com/api/auth/callback/discord
   ```
   (swap in your real subdomain if different from the example throughout this doc). It must match exactly, including `https://` and no trailing slash.
7. Click **Save Changes** at the bottom of the page — easy to miss, and the redirect silently isn't saved without it.

## 3. Docker permission for AMP's service user

Docker's daemon socket is root-only by default; AMP's service account needs to be in the `docker` group or every Generic instance wrapping `docker` will fail immediately with a permissions error.

```bash
# Find AMP's actual running user (commonly "amp"):
ps aux | grep -i amp

sudo usermod -aG docker <that-username>
```

Then restart the AMP service itself so the new group membership takes effect — how you do this depends on how AMP was installed (`sudo systemctl restart <ampservicename>` if it's a systemd service; check `systemctl list-units | grep -i amp` if you're not sure of the exact unit name). A full VPS reboot also works and is the reliable fallback if you can't find the right service name.

## 4. `.env`

```bash
cd /opt/voiddocs
cp .env.example .env
```

Generate the two secrets:

```bash
openssl rand -base64 24   # -> POSTGRES_PASSWORD
openssl rand -base64 32   # -> AUTH_SECRET
```

Edit `.env` (`nano .env`) and fill in:

```bash
POSTGRES_PASSWORD="<output of the first command above>"
AUTH_SECRET="<output of the second command above>"
AUTH_DISCORD_ID="<from step 2.4>"
AUTH_DISCORD_SECRET="<from step 2.5>"
ROOT_DOMAIN="docs.voidsmp.com"
ROOT_PROTOCOL="https"
```

Leave `DATABASE_URL`, `STORAGE_DIR`, `CHROMIUM_EXECUTABLE_PATH`, and `REDIS_URL` alone (commented out / unset) — Compose sets the first three itself per-service, and nothing in this stack uses Redis.

## 5. AMP instance — exact steps

Two different AMP features both involve "Docker," and neither is this:
- **"Docker/Podman for instances"** makes AMP run instances *inside containers AMP itself creates*.
- **"Custom Docker images with the generic module"** is for a single image built `FROM` AMP's own `ampbase` with `ENTRYPOINT ["/ampstart.sh"]`, so AMP manages that one container directly — [confirmed on the AMP wiki](https://github.com/CubeCoders/AMP/wiki/Using-custom-Docker-images-with-AMP-and-the-generic-module) to run one container per instance, not a Compose stack.

What we actually want: AMP running natively on the VPS (already true — you didn't containerize AMP itself), with a Generic instance whose "application" is just the `docker` binary, supervised the same way AMP would supervise a game server process.

1. Log into the AMP panel.
2. Top navigation → **Instance Management**.
3. **Create Instance** (button label/placement varies slightly by AMP version — look for "+" or "New Instance" if you don't see that exact text).
4. **Module**: select **Generic**.
5. Friendly name: `VoidDocs` (or anything). Description optional.
6. Ports: skip/leave default — this instance doesn't need AMP to allocate or forward any ports; Caddy binds 80/443 directly, outside AMP's own port management, since it's a container port publish in `docker-compose.yml`, not something this AMP instance itself listens on.
7. Finish creating the instance, then open it.
8. Find its Generic module configuration (on first open this may be a setup prompt; otherwise look under the instance's **Configuration** section for the application/executable settings) and set:

   | Setting | Value |
   |---|---|
   | Working directory | `/opt/voiddocs` |
   | Executable | `/usr/bin/docker` — confirm the real path first by running `which docker` on the VPS; it's occasionally `/usr/local/bin/docker` instead |
   | Command line arguments | `compose up --build` |
   | Exit method | `SIGTERM` |

9. Save.

Why these specific choices:
- **The `docker` binary directly, never a wrapper shell script.** AMP's own template-contribution guidelines say explicitly: *"Do not invoke any shell scripts/batch files. You must only launch actual executables."*
- **`--build` stays in the command permanently.** An AMP restart then also picks up code changes — Docker's build cache makes this fast when nothing changed, and only slow right after a `git pull`.
- **`SIGTERM`** is what AMP sends on stop, and `docker compose up` (run attached, which is how AMP runs it) catches that and stops its containers gracefully — equivalent to `docker compose stop`, not `docker compose down`. That's deliberate: `down` also removes the network, which would just get recreated next start; `stop`/`start` is faster and just as clean. Run a real `docker compose down` by hand over SSH only when you actually want to tear everything down.
- If AMP's UI asks for an "Application Ready" regex to detect a successful start, match on Caddy's own log line for obtaining a certificate, or leave it permissive and just watch the console the first time through.

## 6. First run — verify by hand before handing it to AMP

Do this over SSH first, before starting the AMP instance from step 5 — far easier to debug here than through AMP's console, and it confirms the stack actually works before AMP starts supervising it.

```bash
cd /opt/voiddocs
docker compose up -d --build
```

(`-d` here is specific to this manual check — it detaches so your SSH session gets control back. This is *not* what AMP itself runs — AMP's instance runs the same command attached, per step 5, because it needs to hold the foreground process to supervise and signal it. Both start the identical stack.)

This builds four images (`web`, `worker`, and `migrate` — a one-shot job reusing `web`'s build stage) and starts `postgres`, runs migrations to completion, then starts `web`, `worker`, and `caddy`. First build takes a few minutes — Playwright's Chromium install for the worker image is the slow part. Rebuilds after that are much faster.

```bash
docker compose logs -f
```

Once `caddy`'s logs show it obtained a certificate for `docs.voidsmp.com`, visit `https://docs.voidsmp.com` — you should see the VoidDocs marketing page and a working "Continue with Discord" sign-in button. Try signing in.

The first person to sign in doesn't automatically get an organization — visit `/dashboard` after signing in and follow the prompt to create one; that account becomes its `ADMIN`.

Once confirmed working:

```bash
docker compose down
```

Then start the instance from the AMP panel instead — both running at once fights over ports 80/443. From here on, AMP owns the process lifecycle.

## 7. Redeploying after a code change

```bash
cd /opt/voiddocs
git pull
```

Then restart the instance from the AMP panel (stop, then start) — its command already includes `--build`, so the restart itself picks up the new code; no separate manual `docker compose` invocation needed. The `migrate` service re-runs on every start, applying any new migrations before `web`/`worker` come up — safe even when there's nothing new to migrate.

**One-time-per-project caveat**, not something you'll hit on ordinary schema changes: this project has one raw-SQL-managed column (`Page.searchVector`, a Postgres `GENERATED ALWAYS AS ... STORED` column backing full-text search) that Prisma's schema language can't fully express. If you ever edit `packages/db/prisma/schema.prisma` yourself and regenerate a migration with `prisma migrate dev`, read the warning comment directly above the `searchVector` field first — an unedited auto-generated migration will silently drop the search index. Migrations already committed to this repo have this already handled; it only matters if you're authoring a *new* one.

## 8. Custom domains for tenant sites

Nothing to do here beyond what's above — a site owner adds their own domain from the dashboard's "Custom domain" settings page, gets a TXT record to prove ownership, and once verified, Caddy's `on_demand_tls` (gated by `/api/internal/certs/ask`, which only says yes to verified domains) issues that domain its own certificate automatically on first request. No AMP/Compose changes needed per tenant domain.

## 9. Backups

Two volumes need backing up (see `docker-compose.yml`'s `volumes:` section) — everything else rebuilds from the image on redeploy:

- `pgdata` — the actual database. Prefer a real `pg_dump` on a schedule over a raw volume snapshot:
  ```bash
  docker compose exec postgres pg_dump -U voiddocs voiddocs > backup-$(date +%F).sql
  ```
- `uploads` — uploaded images/files and generated PDFs. A plain recursive copy/snapshot of this volume is fine — just files, no in-flight-transaction concerns.

`caddy_data` (issued TLS certificates) is worth keeping too, but is fully regenerable — losing it just means Caddy re-issues certificates on next boot, not data loss.

## 10. What's intentionally not here

No Redis, no separate job-queue infrastructure, no CDN/object-storage config — this stack is sized for a single-VPS, single-`docker compose`-stack deployment, matching what a generic AMP instance actually runs. If usage ever outgrows one VPS, the places that would need to change are documented inline: `packages/shared/src/rateLimit.ts` (swap the in-memory limiter for Redis-backed) and `apps/worker` (swap the poll loop for a real queue) — both were built with that seam in mind, not because it's needed today.
