# Git Sync

Git Sync keeps a version of a site in a Git repository. The pages are Markdown files; a push to the branch
updates the site, and those pages are read-only in the editor. The rest of the site stays editable as normal.

The sync is **one way**: repository → site. GitCrook never writes to your repository.

- [Quick start](#quick-start)
- [Private repositories](#private-repositories)
- [Push webhooks](#push-webhooks)
- [What a repository looks like](#what-a-repository-looks-like)
- [What a sync does](#what-a-sync-does)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Moving from GitBook](#moving-from-gitbook)
- [Security](#security)
- [Limits](#limits)

The page format (front matter, callouts, directives, navigation files) is specified in [FORMAT.md](FORMAT.md).

## Quick start

A public repository needs nothing on the server beyond a running worker.

1. Open the site in the dashboard → **Site settings → Git Sync**.
2. Choose which **version** of the site the repository fills (a site with no variants has one, "Main").
   A repository takes over a whole version: if that version already has pages, you are asked to confirm that they
   will be deleted. Nothing is deleted before GitCrook has confirmed it can read the repository.
3. Enter the repository as `owner/repo` (or paste its GitHub URL), optionally a branch (default: the repository's
   default branch) and a folder inside it (default: the repository root).
4. **Connect.** The first sync starts straight away; the result, with any problems found, is in **Recent syncs**.

After that, every push to the branch updates the site. Without a [webhook](#push-webhooks) the worker polls, every
5 minutes by default.

Use **Sync now** to check immediately, **Full re-sync** to re-read every file even if nothing looks changed, and
**Pause** to stop syncing without disconnecting.

## Private repositories

Create a **fine-grained personal access token** on GitHub, limited to the one repository, with the single
permission *Contents: Read-only* (GitHub adds *Metadata: Read-only* itself). Paste it into the connect form's
**Access token** field.

Tokens are stored **encrypted** (AES-256-GCM), never shown again, and only decrypted inside the worker for the length
of a run. That needs a key on the server:

```bash
openssl rand -base64 32     # → GIT_SYNC_ENCRYPTION_KEY in .env
```

Without `GIT_SYNC_ENCRYPTION_KEY` the token field is disabled and only public repositories can be connected.

**Replacing or removing a token** is done from the source's settings. Removing the token of a private repository is
refused: the repository is checked first, and the source is left as it was if it can no longer be read.

**Rotating the encryption key.** Put the new key in `GIT_SYNC_ENCRYPTION_KEY` and the old one (several, comma
separated, if there have been more rotations) in `GIT_SYNC_ENCRYPTION_KEYS_PREVIOUS`, then restart `web` and
`worker`. Existing tokens keep working. A token is re-encrypted under the new key the next time it is saved, so
keep the old key listed until you have re-saved every token you care about — or until you no longer need to
open them.

A token cannot be decrypted by the wrong key, and a ciphertext copied into another credential's row does not
open there: each one is bound to its own id.

## Push webhooks

Webhooks make the site update within seconds of a push. They are optional: polling heals a missed delivery either way.

1. Generate a secret and put it in `GITHUB_WEBHOOK_SECRET`:

   ```bash
   openssl rand -hex 32
   ```

2. In the repository: **Settings → Webhooks → Add webhook**.

   | Field | Value |
   | --- | --- |
   | Payload URL | `https://<your-domain>/api/webhooks/github` |
   | Content type | `application/json` |
   | Secret | the same value |
   | Events | *Just the push event* |

The endpoint verifies GitHub's HMAC-SHA256 signature over the raw request body before it reads anything else, and
refuses every request when no secret is configured. A delivery that is repeated is recognised and ignored. Only
pushes to a connected source's branch cause a sync, and one push to a repository that feeds several sites updates
all of them.

The dashboard shows the exact payload URL for your deployment.

## What a repository looks like

The simplest repository is a folder of Markdown files:

```
docs/
  README.md             → the home page
  install.md            → /install
  guides/
    README.md           → /guides            (the folder's own page)
    configure.md        → /guides/configure
    advanced.md         → /guides/advanced
  images/
    architecture.png    → used by ![…](images/architecture.png)
```

Set the folder to `docs` when connecting if the documentation shares the repository with code.

A page can carry front matter:

```md
---
title: Configure
description: Every setting, explained.
order: 2
icon: settings
redirect_from: [/old/configure]
---
```

Folders and file names give the page tree and URLs; `order` sorts siblings; `draft: true` keeps a page unpublished;
`hidden: true` publishes it without listing it in the sidebar. An optional `gitcrook.yaml` or a GitBook-style
`SUMMARY.md` makes the navigation explicit — then **only listed files are published**, and any file left out is
reported. See [FORMAT.md](FORMAT.md#navigation) for the rules.

Plain Markdown is all you need. Callouts are GitHub's `> [!NOTE]` alerts, expandable sections are `<details>`, and a
few richer blocks (columns, cards, steps, tabs, changelog entries) use `:::` containers; everything shows readably in
GitHub's own file view.

Relative links between pages (`[Install](./install.md)`) and images are rewritten to the published URLs, and keep
working when files move.

## What a sync does

A run reads the branch's tree from GitHub, compares it with what the site has, and applies the difference in one
transaction: it either all lands or none of it does.

- **New and changed files** become new and changed pages. Every sync that changes a page adds a version to the
  page's history, labelled with the commit.
- **Pages are read-only in the dashboard.** The editor shows a banner with an **Edit on GitHub** link instead of the
  editing surface, and the same restriction is enforced on the server, not only in the UI. Pages the repository
  does not own (in other versions or sections) stay editable.
- **Renamed or moved files keep their page and history**, and the old URL redirects to the new one automatically.
  A page's `id` front-matter key makes that survive a rename plus a rewrite in the same commit. Links from other pages
  are rewritten to follow. Renaming a folder that only groups pages (no index of its own) does not create a redirect.
- **`redirect_from`** and the redirects in `gitcrook.yaml` / `.gitbook.yaml` become site redirects owned by the
  source: deleting the key removes the redirect.
- **Deleted files unpublish first.** The page is hidden at once and removed after the source's **grace period**
  (14 days by default, 1–90 configurable). Restoring the file inside the grace period brings the page back with its
  history.
- **Images and files** are fetched from the repository and put through the same pipeline as editor uploads: typed by
  content rather than by name, raster images re-encoded (which removes metadata), SVG sanitised. They are
  de-duplicated by content, so an image used by twenty pages is stored once.
- **Problems are reported, not skipped silently.** Parsing never throws: a file with bad front matter or an unknown
  directive is still published, with the problem listed. A file that cannot be read at all (over the size limit,
  or an error fetching it) keeps its previous content. When any error was found the run is marked *Partly*, but
  everything that could be applied has been.
- **Diagnostics** — per file and line, with a stable `GS-…` code — are listed under each run. Links to pages that
  don't exist, missing images, unknown directives and files left out of the navigation are warnings you can see.
- **One run at a time per source.** A push during a run queues exactly one follow-up; ten pushes during a run
  still give one.

## Configuration

Set on the server (`.env`); `web` and `worker` both read them. None is needed unless you use the feature they
describe.

| Variable | Default | Notes |
| --- | --- | --- |
| `GIT_SYNC_ENCRYPTION_KEY` | — | Required to save an access token for a private repository. `openssl rand -base64 32`. |
| `GIT_SYNC_ENCRYPTION_KEYS_PREVIOUS` | — | Comma-separated older keys, so tokens saved under them can still be read after a rotation. |
| `GITHUB_WEBHOOK_SECRET` | — | Verifies push webhooks. Without it webhooks are refused and polling does the work. |
| `GITHUB_API_URL` | `https://api.github.com` | GitHub Enterprise Server: `https://ghe.example.com/api/v3`. |
| `GIT_SYNC_ALLOWED_HOSTS` | the host of `GITHUB_API_URL` | The only hosts the worker may contact. |
| `GIT_SYNC_CONCURRENCY` | `2` | Repositories synced at once. |

Per source, in the dashboard: the branch, the folder, how often to poll (60 seconds to 24 hours, default 5
minutes), the delete grace period, and the token.

Applying the feature to an existing deployment: the migrations run through the `migrate` service on the next
`docker compose up -d --build`; rebuild both `web` and `worker`, since the worker is what syncs.

## Troubleshooting

Each run's diagnostics carry these codes; the table in [FORMAT.md](FORMAT.md#diagnostics) lists all of them.

| Code | What to do |
| --- | --- |
| `GS-302` | The repository or branch can't be found with the credential in use. GitHub answers *not found* for a private repository the token can't see, so check the token's repository access as well as the spelling. |
| `GS-303` | The token was rejected: expired, revoked, or missing the *Contents: Read* permission. Save a new one in the source's settings. |
| `GS-301` | GitHub's rate limit. The sync waits and retries on its own. |
| `GS-304` | The version already has pages this source didn't create. Remove them, or connect to an empty version. |
| `GS-305` | The branch isn't protected on GitHub. Informational: anyone who can push to it can change the published site. |
| `GS-306` | The run took longer than 10 minutes and was stopped. Reduce the folder (`rootDir`) or the number of large assets. |
| `GS-150` / `GS-151` | A file, or the whole repository, is over a [limit](#limits). |
| `GS-101` | Front matter isn't valid YAML. The line number points at the problem; the page is still published without it. |
| `GS-120` / `GS-121` | With an explicit navigation, a file isn't listed (so it isn't published), or the navigation lists one that doesn't exist. |
| `GS-130` / `GS-131` | A link or image points at a file that isn't in the repository. |
| `GS-160` | A symlink, submodule or Git LFS pointer was skipped. Git Sync reads regular files only. |

**Nothing happens after a push.** Check the webhook's *Recent Deliveries* on GitHub: `200` means GitCrook accepted
it; `401` means the secret doesn't match `GITHUB_WEBHOOK_SECRET`; `404`/`5xx` means the URL or the server is
wrong. Without a webhook, the next poll picks the change up.

**A page disappeared.** If its file was deleted, it is hidden until the grace period ends and comes back if the file
does. If it carries `draft: true` it is deliberately not published.

**The source says "Needs attention".** The message under the heading is the last run's error. Fix the cause and press
**Sync now**. A source in this state is retried automatically, every 15 minutes (or the poll interval, if longer),
and goes back to normal on the first run that succeeds.

## Moving from GitBook

A repository already synced with GitBook is read as it is: `.gitbook.yaml` (`root`, `structure.readme`,
`structure.summary`, `redirects`), `SUMMARY.md`, and the common tags — `{% hint %}`, `{% tabs %}`, `{% stepper %}`
and friends — are understood when reading. They are read, not written: new content should use the plain Markdown
forms in [FORMAT.md](FORMAT.md#gitbook-compatibility), which also render on GitHub. Tags GitCrook doesn't know
keep their content as visible text and are reported as `GS-203`.

## Security

A repository is **untrusted input**, even your own: it may be edited by a contributor or a compromised account.

- Only the configured branch is read, over HTTPS, to the one host (or hosts) the server's operator listed. The
  repository's owner cannot point the server at another address.
- Every request goes through the same SSRF-checked fetch as the rest of GitCrook, and names that come from the
  repository are validated before they appear in a request path.
- Raw HTML in Markdown is reduced to an allow-list; scripts, event handlers and unsafe URLs are removed.
- Images are checked by content and re-encoded; SVG is sanitised to an allow-list and served with a
  sandboxing `Content-Security-Policy` as well.
- Tokens are encrypted at rest with a key that is not in the database, scrubbed from every log line and stored
  message, and never sent to the browser.
- The webhook trusts nothing it hasn't verified: signature first, over the raw bytes, compared in constant time.
- Pages from a repository can't be edited through the dashboard, API or server actions — the check is on the
  server.

Protect the branch you sync from. Anyone who can push to it can change what your site says.

## Limits

| What | Limit |
| --- | --- |
| Files per source | 5,000 |
| One Markdown file | 1 MB |
| One image or other asset | 20 MB |
| Assets read in one run | 500 MB |
| `gitcrook.yaml` / `SUMMARY.md` | 256 KB |
| Front matter | 32,000 characters |
| One run | 10 minutes |
| Repositories per organization | 20 |
