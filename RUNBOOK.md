# GitCrook deployment runbook

Self-hosting GitCrook on a VPS via Docker Compose, supervised directly by **systemd** — not routed through AMP (CubeCoders Application Management Portal). AMP's Generic module can technically do this, but only via a locally-authored deployment template whose file format CubeCoders' own docs don't fully specify (see the note in step 5); systemd achieves the identical result — start on boot, restart on crash, clean stop — with standard, fully-documented Linux tooling instead. If AMP is already running on this VPS for other things, it's untouched; it just isn't in this stack's path. Every step below assumes nothing is set up yet.

## 0. Get the code onto the VPS

This repo isn't in git yet. From your local machine, in the repo root:

```bash
git init
git add .
git commit -m "Initial commit"
```

Create a new **private** repo on GitHub (github.com/new — private, since even though `.env` itself is gitignored, there's no reason to make the source public unless you want to). Then:

```bash
git remote add origin git@github.com:<you>/gitcrook.git
git branch -M main
git push -u origin main
```

On the VPS, do this over SSH **as root** — if `root` and `amp` are the only two accounts you've got (no separate personal sudo user), root is the right one for this part; `amp` is a service account and almost certainly can't even log in interactively (typically locked to `/usr/sbin/nologin`). You'll hand the directory over to `amp` in step 6, before anything actually runs `docker compose` as it:

```bash
ssh root@<vps-ip>
mkdir -p /opt/gitcrook
git clone git@github.com:<you>/gitcrook.git /opt/gitcrook
cd /opt/gitcrook
```

Cloning a private repo on the VPS needs its own auth — either generate a fresh SSH key on the VPS (`ssh-keygen -t ed25519`, add the printed public key under GitHub → Settings → SSH and GPG keys) or use a GitHub Personal Access Token with the HTTPS clone URL instead. Either is fine; pick whichever you already have set up.

`/opt/gitcrook` is this runbook's assumed path from here on — swap it everywhere below if you put it somewhere else.

`root` owns this directory for now, through step 4 below (cloning, `.env`). Step 6 hands ownership over to `amp` before anything actually runs `docker compose` — see that step for why, and don't skip it.

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
2. **New Application** (top right) → give it a name (e.g. "GitCrook") → accept the terms → **Create**.
3. Left sidebar → **OAuth2** → **General**.
4. Copy the **Client ID** shown there — this is `AUTH_DISCORD_ID`.
5. Under **Client Secret**, click **Reset Secret**, confirm, and copy the value immediately — it's shown once only. This is `AUTH_DISCORD_SECRET`.
6. Still on that OAuth2 page, find **Redirects**, click **Add Redirect**, and enter exactly:
   ```
   https://docs.voidsmp.com/api/auth/callback/discord
   ```
   (swap in your real subdomain if different from the example throughout this doc). It must match exactly, including `https://` and no trailing slash.
7. Click **Save Changes** at the bottom of the page — easy to miss, and the redirect silently isn't saved without it.

## 3. Install Docker, then grant the service account permission

AMP's installer asks about Docker for a *different* feature (AMP managing its own per-instance containers) — it doesn't install Docker Engine system-wide for your own use. If `which docker` prints nothing, it's not installed yet. As root, via Docker's official apt repository (these exact commands are for **Ubuntu 24.04 "noble"** — confirmed against Docker's current install docs):

```bash
apt-get update
apt-get install ca-certificates curl
```

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
```

```bash
apt-get update
apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify both the engine and the Compose plugin landed:

```bash
docker --version && docker compose version
```

Then prove the daemon can actually *run* a container, not just that the CLI exists — this is the real test, and the only thing that rules out a VPS whose virtualization doesn't support nested containers (rare, but this is where it'd show up):

```bash
docker run --rm hello-world
```

That should print a "Hello from Docker!" message. If it hangs or errors, stop here and paste the output before continuing.

Installing `docker-ce` creates the `docker` group automatically. Docker's daemon socket is root-only by default; the account running this stack (`amp` — reused here purely as a low-privilege system account, not because AMP itself is involved — see step 5) needs to be in that group or every `docker compose` invocation will fail immediately with a permissions error:

```bash
usermod -aG docker amp
```

Worth knowing: being in the `docker` group is effectively root-equivalent on this host (anyone who can talk to the Docker daemon can trivially get a root shell through it, e.g. by mounting `/` into a container) — this isn't a meaningful security boundary, just a least-surprise convention of keeping this stack's files owned by a dedicated account rather than root. No service restart needed for this to take effect — systemd (step 5) resolves group membership fresh every time it starts a service, unlike an interactive login shell.

## 4. `.env`

```bash
cd /opt/gitcrook
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

**Optional but recommended before your first real sign-in**: sign-up is open to anyone with a Discord account by default, and each new sign-in immediately gets its own organization (see `packages/auth/src/auth.ts`'s `createUser` event) — there's no invite-only gate otherwise. To restrict sign-in to specific Discord accounts while you're setting things up, add to `.env`:

```bash
ALLOWED_DISCORD_IDS="<your Discord user ID>"
```

(Comma-separate multiple IDs. Get your own ID in Discord: Settings → Advanced → enable Developer Mode, then right-click your username → Copy User ID.) Remove this line later to open sign-up back up.

## 5. systemd service

AMP's Generic module *can* do this, but only via a manually-authored local deployment template — CubeCoders' own wiki documents the concept (a `GenericModule.kvp` split into "Application / Console / Meta" sections) without publishing the actual file syntax, and there's no plain built-in "Generic" entry sitting in the instance-creation list until such a template exists. Rather than reverse-engineer an undocumented format, systemd does exactly the same job — keep `docker compose up` running, restart it if it dies, stop it cleanly on shutdown — with standard, fully-documented Linux tooling.

Create the unit file as root:

```bash
tee /etc/systemd/system/gitcrook.service <<'EOF'
[Unit]
Description=GitCrook (Docker Compose stack)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=amp
Group=amp
WorkingDirectory=/opt/gitcrook
ExecStart=/usr/bin/docker compose up --build
Restart=on-failure
RestartSec=5
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
```

Confirm `/usr/bin/docker` is really where it landed first — `which docker` — it's occasionally `/usr/local/bin/docker` instead; edit `ExecStart` to match if so.

```bash
systemctl daemon-reload
systemctl enable gitcrook
```

`enable` (no `--now`) registers it to start on every future boot but doesn't start it right now — step 6 does one manual verification run first, then starts the real service at the very end.

Why these specific choices:
- **`docker compose up` directly, no wrapper shell script** — fewer moving parts; systemd supervises the process it launches directly, same principle AMP's own template guidelines insist on for Generic modules.
- **`--build` stays in the command permanently.** A restart then also picks up code changes — Docker's build cache makes this fast when nothing changed, and only slow right after a `git pull`.
- **No explicit `ExecStop`.** systemd's default stop action for `Type=simple` is to send SIGTERM to the main process, and `docker compose up` (run attached, exactly how this unit runs it) already catches that and stops its containers gracefully — equivalent to `docker compose stop`, not `docker compose down`. That's deliberate: `down` also removes the network, which would just get recreated next start; `stop`/`start` is faster and just as clean. Run a real `docker compose down` by hand over SSH only when you actually want to tear everything down.
- **`Restart=on-failure`** recovers if the `docker compose up` process itself dies (e.g. the Docker daemon restarts underneath it). Each container's own `restart: unless-stopped` in `docker-compose.yml` already handles a single container crashing — this is a second, independent layer for the supervisor process itself.

## 6. Ownership handoff, then first run — verify by hand before handing it to systemd

**Hand the directory over to `amp` first.** The systemd unit (step 5) runs `docker compose` *as the `amp` user*, not as root. Skipping this is a real trap: everything works when you run `docker compose` by hand as root, then the service silently fails to start because `amp` can't read `.env` or `docker-compose.yml` (root can read/write anything regardless of ownership, so this failure mode won't show up until systemd itself, running the unit as the much-less-privileged `amp`, tries it).

```bash
id amp                          # confirm the exact user/group name — usually also "amp"
chown -R amp:amp /opt/gitcrook
```

Everything from this point on (the verification below, and every future `git pull`+restart) runs *as* `amp` via `sudo -u amp`, not as root directly — that's what actually exercises the same permissions the systemd unit will have.

**If AMP's panel is already reachable at a domain (e.g. via nginx+Certbot, a common AMP setup pattern)**, `docker compose up` will fail with `address already in use` on port 80/443 — only one thing can hold those. Stop and disable that nginx (`systemctl stop nginx && systemctl disable nginx`); the Caddyfile in this repo already includes a block proxying `dev.voidsmp.com` to the panel at `host.docker.internal:8080` (adjust that hostname if your panel's domain differs), so Caddy picks up serving it, cert and all, once nginx is out of the way. Expect a brief interruption to panel access during the cutover itself.

Now verify the stack actually works, over SSH, before starting the service from step 5 — far easier to debug here than through `journalctl`:

```bash
sudo -u amp bash -c "cd /opt/gitcrook && docker compose up -d --build"
```

(`-d` here is specific to this manual check — it detaches so your SSH session gets control back. This is *not* what the systemd unit itself runs — it runs the same command attached, per step 5, because `Type=simple` needs to hold the foreground process to supervise and signal it. Both start the identical stack, as the identical user, so this is a faithful test of exactly what systemd is about to do.)

This builds four images (`web`, `worker`, and `migrate` — a one-shot job reusing `web`'s build stage) and starts `postgres`, runs migrations to completion, then starts `web`, `worker`, and `caddy`. First build takes a few minutes — Playwright's Chromium install for the worker image is the slow part. Rebuilds after that are much faster.

```bash
docker compose logs -f
```

(no `sudo -u amp` needed just to *read* logs — only actions that touch the containers/files need to run as `amp`)

Once `caddy`'s logs show it obtained a certificate for `docs.voidsmp.com`, visit `https://docs.voidsmp.com` — you should see the GitCrook marketing page and a working "Continue with Discord" sign-in button. Try signing in.

The first person to sign in doesn't automatically get an organization — visit `/dashboard` after signing in and follow the prompt to create one; that account becomes its `ADMIN`.

Once confirmed working:

```bash
sudo -u amp bash -c "cd /opt/gitcrook && docker compose down"
```

Then start the real service instead — both running at once fights over ports 80/443:

```bash
systemctl start gitcrook
systemctl status gitcrook
```

From here on, systemd owns the process lifecycle — it also starts this automatically on every VPS reboot, since step 5 already `enable`d it.

## 7. Redeploying after a code change

Pull as **root**, not `amp` — `amp` has no GitHub credentials of its own (nobody set any up, deliberately; see step 0), so a pull run as `amp` would hit the exact same "Permission denied (publickey)" you saw earlier, just for a different account. Then hand ownership back to `amp`, since the pull just wrote new files as root again:

```bash
cd /opt/gitcrook
git pull
chown -R amp:amp /opt/gitcrook
```

**First time only**: since step 6 already handed this directory to `amp`, root pulling here trips git's "dubious ownership" check (`fatal: detected dubious ownership in repository`) — root doesn't own the directory it's running git in. Fix once, permanently:

```bash
git config --global --add safe.directory /opt/gitcrook
```

Then re-run the `git pull` above.

```bash
systemctl restart gitcrook
```

The unit's `ExecStart` already includes `--build`, so the restart itself picks up the new code; no separate manual `docker compose` invocation needed. The `migrate` service re-runs on every start, applying any new migrations before `web`/`worker` come up — safe even when there's nothing new to migrate. To watch it come up: `journalctl -u gitcrook -f`.

**One-time fix if your `uploads` volume predates the Dockerfiles' baked-in ownership**: if uploads were ever failing with `EACCES: permission denied, mkdir '/data/uploads/...'` before this was fixed, the volume itself needs a one-time ownership correction after you rebuild — the new image only fixes what a *fresh* volume inherits, not one that already existed with the old (wrong) ownership:

```bash
docker compose run --rm --user root web chown -R 1001:1001 /data/uploads
```

Run this once, after pulling the fix and rebuilding, not before — it targets UID 1001 directly, which only matches what the *new* image runs as.

**One-time-per-project caveat**, not something you'll hit on ordinary schema changes: this project has one raw-SQL-managed column (`Page.searchVector`, a Postgres `GENERATED ALWAYS AS ... STORED` column backing full-text search) that Prisma's schema language can't fully express. If you ever edit `packages/db/prisma/schema.prisma` yourself and regenerate a migration with `prisma migrate dev`, read the warning comment directly above the `searchVector` field first — an unedited auto-generated migration will silently drop the search index. Migrations already committed to this repo have this already handled; it only matters if you're authoring a *new* one.

## 7b. Renaming an existing deployment (VoidDocs → GitCrook)

Only relevant to a server that was deployed **before** the rename. The code is now `gitcrook`
throughout, but three things on a running server are tied to data rather than code, and changing
them without care costs you the database or the uploads.

**The database role and name.** Postgres applies `POSTGRES_USER`/`POSTGRES_DB` only when it
initialises an *empty* data directory, and never again. Your `pgdata` volume was created with the
role and database both called `voiddocs`, so they still are. `docker-compose.yml` now defaults to
`gitcrook`, which would point the app at a role that doesn't exist. Pin the old names in `.env`
before pulling:

```bash
cd /opt/voiddocs
printf 'POSTGRES_USER="voiddocs"\nPOSTGRES_DB="voiddocs"\n' >> .env
git pull
chown -R amp:amp /opt/voiddocs
systemctl restart voiddocs
```

That's the whole migration — nothing else needs to change, and it stays correct indefinitely. If
you'd rather the database actually be called `gitcrook`, rename it in place first, then drop those
two lines from `.env`:

```bash
docker compose exec postgres psql -U voiddocs -d postgres -c 'ALTER DATABASE voiddocs RENAME TO gitcrook;'
docker compose exec postgres psql -U voiddocs -d gitcrook -c 'ALTER ROLE voiddocs RENAME TO gitcrook;'
```

Do that with the stack stopped apart from `postgres` (`docker compose stop web worker`), since you
can't rename a database that has open connections.

**The deployment directory.** Compose derives its project name from the directory, and the project
name prefixes the volumes — your volumes are `voiddocs_pgdata` and `voiddocs_uploads`. Moving
`/opt/voiddocs` to `/opt/gitcrook` would have Compose look for `gitcrook_*` volumes, find none, and
create empty ones: an empty database and no uploads. Either leave the directory where it is, or
move it and pin the old project name:

```bash
echo 'COMPOSE_PROJECT_NAME=voiddocs' >> /opt/gitcrook/.env
```

**The systemd unit.** `voiddocs.service` keeps working as-is. To rename it, write the new unit
(step 5, with the new name), then swap:

```bash
systemctl disable --now voiddocs
systemctl daemon-reload
systemctl enable --now gitcrook
rm /etc/systemd/system/voiddocs.service
```

One last thing that isn't data: the DNS verification record changed from `_voiddocs-challenge` /
`voiddocs-verify=` to `_gitcrook-challenge` / `gitcrook-verify=`. Domains already verified stay
verified — nothing re-checks them — but a domain still *pending* verification needs its TXT record
updated to the new name and value shown on its settings page.

## 8. Custom domains for tenant sites

Nothing to do here beyond what's above — a site owner adds their own domain from the dashboard's "Custom domain" settings page, gets a TXT record to prove ownership, and once verified, Caddy's `on_demand_tls` (gated by `/api/internal/certs/ask`, which only says yes to verified domains) issues that domain its own certificate automatically on first request. No AMP/Compose changes needed per tenant domain.

## 9. Backups

Two volumes need backing up (see `docker-compose.yml`'s `volumes:` section) — everything else rebuilds from the image on redeploy:

- `pgdata` — the actual database. Prefer a real `pg_dump` on a schedule over a raw volume snapshot:
  ```bash
  docker compose exec postgres pg_dump -U gitcrook gitcrook > backup-$(date +%F).sql
  ```
- `uploads` — uploaded images/files and generated PDFs. A plain recursive copy/snapshot of this volume is fine — just files, no in-flight-transaction concerns.

`caddy_data` (issued TLS certificates) is worth keeping too, but is fully regenerable — losing it just means Caddy re-issues certificates on next boot, not data loss.

## 10. What's intentionally not here

No Redis, no separate job-queue infrastructure, no CDN/object-storage config — this stack is sized for a single-VPS, single-`docker compose`-stack deployment. If usage ever outgrows one VPS, the places that would need to change are documented inline: `packages/shared/src/rateLimit.ts` (swap the in-memory limiter for Redis-backed) and `apps/worker` (swap the poll loop for a real queue) — both were built with that seam in mind, not because it's needed today.
