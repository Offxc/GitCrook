# GitCrook — fix and Git Sync plan

Audited 2026-10-22 against `main` at `4a1e81e`. Every number below was measured on a production
build (`next build`, 1400×800 viewport) unless marked otherwise.

**Evidence tags** — `[measured]` reproduced in a real browser or by running the app; `[ran]`
output of a command; `[read]` from reading the code, not exercised; `[docs]` from vendor
documentation.

**Sizes** — S under half a day · M 1–2 days · L 3–5 days · XL over a week. Rough; re-estimate when
picked up.

**Priorities** — P0 broken or misleading now · P1 do next · P2 worthwhile · P3 later.

**Security findings are not in this file.** The repository is public, so the unpatched security
items live in `SECURITY-FINDINGS.md`, kept out of git until the fixes ship. They are scheduled in
Phase 0 below as the "S track". Ask the maintainer for the file; do not commit it.

## Contents

1. [Order of work](#1-order-of-work)
2. [The sidebar scroll bug](#2-the-sidebar-scroll-bug)
3. [Audit findings](#3-audit-findings)
4. [Git Sync](#4-git-sync)
5. [Markdown and blocks: what GitBook does and what we do instead](#5-markdown-and-blocks)
6. [Decisions needed](#6-decisions-needed)
7. [Appendix: reproduction harness](#7-appendix-reproduction-harness)

---

## 1. Order of work

| Phase | Goal | Contents | Rough size |
| --- | --- | --- | --- |
| **0 — Stop the bleeding** | Nothing misleading or broken ships | Sidebar hotfix (A1), broken links (A3, A4), dark-mode persistence (B1), install and docs fixes (G1, G2), dependency refresh (G6), **S track** (private file) | ~1 week |
| **1 — Foundations** | Make changes safe to make | Lint, tests and CI (G3–G5), persistent shell (A2, A5, A6), renderer parity (B4), stable anchors (B5), slug indexes (D2), shared path helpers (D7), reader payload diet (E1, E8) | ~2 weeks |
| **2 — Creator and reader polish** | Remove the daily friction | Creator items (C1–C8), search (B2), share links (B3), SEO (F1), perf (E2–E6) | ~2–3 weeks |
| **3 — Git Sync v1** | Repo → site | GS-01 … GS-22 in [§4.12](#412-task-breakdown). Starts when Phase 1's prerequisites land; the parser package (GS-01…GS-06) can start immediately because it has no dependency on the app | ~4–6 weeks |
| **4 — Git Sync v2** | Write-back via PR, previews, variants, other hosts | GS-23 … GS-26 | later |

**Prerequisites for Git Sync** (it will produce wrong output or unsafe behaviour without them):
A3 canonical page paths · B4 renderer parity · B5 deterministic anchors · D2 slug uniqueness
indexes · D7 shared path/URL helpers · G4 test harness · the hardened outbound fetch (GS-10) · the
S track items that touch webhooks and secrets.

### Progress

**Phase 0 is done** except the leftovers listed below. Everything was verified by running the app: a
production build for the sidebar work, a scratch database for the sign-up logic, and a clean clone
installed with **pnpm 11 under a frozen lockfile** (what CI does) with typecheck, build, all migrations
on an empty database and the seed.

| Item | Result |
| --- | --- |
| A1 sidebar scroll | Six failure modes fixed; regression suite passes on the production build (`3719 → 3719`, `1700 → 1700`, `3600 → 3600`, active item in view on a deep link, hard-load frames at the top `11 → 2`) |
| A3 / A4 links | Sidebar and prev/next carry section, space and `~v` prefixes; prev/next skips groups |
| B1 dark mode | Cookie, rendered on the server; `theme.darkMode` honoured |
| D1 autosave | Compare-and-set: 1 of 20 racing saves wins |
| G1 / G2 | `pnpm install` works on a fresh clone without `.env`; invalid `start` script removed |
| G6 dependencies | `pnpm audit` is clean (production and dev). Dependabot and an audit step in CI are still to do (G5) |
| S track | Done: metadata access, password-session invalidation, sign-up closed by default with invitations, asset cleanup on site deletion, feed caching, rating access, visitor-hash keying, seed guard, domain claims, upload limits, authorisation clean-ups. Open items are listed in the private file |

**Found while fixing, and fixed**

- **Custom domains were broken** (not in the original audit). `proxy.ts` rewrote *every* path on a
  custom host into the page route, `/api/*` included. On a custom domain, search, every uploaded
  image, the feed and the click beacon returned 404, and Caddy's certificate check (`Host: web:3000`)
  did too — so a verified domain could never be issued a certificate. `/api/*` is no longer rewritten.
- **Any upload over 10 MB failed with a 500.** The proxy layer buffers request bodies and stops at
  10 MB by default, so the 20 MB image and 100 MB file limits were unreachable.
  `proxyClientMaxBodySize` is raised, and Caddy caps every other route at 5 MB.
- **Three upload files were committed** under `apps/web/.data/` (an image and two page PDF exports).
  Now untracked and ignored; **they are still in earlier history** (see decision below).
- **A `vite` override broke `pnpm install --frozen-lockfile` under pnpm 11.** Found only by installing a
  clean clone with pnpm 11; add that install to CI (G5) so it cannot recur.

**Still open from Phase 0:** the persistent shell (A2, Phase 1); the hardening items S13–S19 in the
private file; removing the maintainer-specific `dev.voidsmp.com` block from the shipped Caddyfile (G8) —
deliberately not done because the maintainer's own deployment proxies that panel through it.

**Deploying this:** four new migrations run automatically through the `migrate` service. Visitors of
password-protected sites enter the password once more. Sign-up is now **closed** by default: set
`ALLOWED_DISCORD_IDS` to your own ID if you have not already, and `SIGNUP_MODE=open` only if you want the
old behaviour. After deploying, review assets whose site was deleted earlier (the query is in the private
file).

---

## 2. The sidebar scroll bug

**Symptom.** Clicking a page in a long sidebar sends the nav back to (or near) the top, so on a
long wiki you lose your place on every click.

### Root cause `[measured]`

The whole reader shell — header, section tabs, sidebar, footer, the theme `<style>` block, the
dark-mode attribute, `EditModeProvider` — is rendered by the **page** component
(`lib/tenancy/renderPublishedSite.tsx`), not by a layout. When the catch-all `[[...path]]` params
change, Next remounts that page's subtree, so every navigation tears down and rebuilds all of it. A
DOM-marker test confirmed it: after a soft navigation the `<nav>`, `<header>` and `<main>` elements
were all replaced with new nodes (`REMOUNTED`), for readers and creators alike.

Anything held in the DOM or in client state is therefore lost on every click: the sidebar's scroll
offset, which `<details>` groups were open, edit-mode state, the dark-mode attribute.

Commit `4a1e81e` (restore the offset from `sessionStorage`) papers over the first of those only,
and it still fails in six ways:

| # | Scenario | Measured |
| --- | --- | --- |
| 1 | Reader expands several groups, scrolls down, clicks a page | Groups collapse on navigation, the list is 1,536 px shorter, the offset is clamped: **3719 → 2183**, and the clamped value overwrites the stored one |
| 2 | Scroll, then click within 100 ms | The offset is saved on a 100 ms debounce: **1700 → 1500** (200 px lost) |
| 3 | Creator in edit mode, scrolled deep, clicks a page | The restore runs against the read-only list (`EditModeProvider` starts with `editing=false`, so the first render is the collapsed list, height 2918): offset 3600 is clamped to 2240, then the tree swaps in and the browser lands at **4292, the bottom** |
| 4 | Open a page from a search result, a new tab or a shared link | Nothing scrolls the active item into view: **`scrollTop` 0 and the active link is off-screen** |
| 5 | Hard load — reload, or any `window.location.href` flow (create / rename / delete / reorder in edit mode) | The restore only happens after hydration: the sidebar is painted at the top for **11 frames (~570 ms at 4× CPU throttle)**, then jumps |
| 6 | Switch section or variant | One stored offset per site is shared by every section and variant tree, so a shorter tree clamps and overwrites it |
| — | Groups opened by hand | Close on every navigation (open `<details>`: 1 → 0) |

### Fix, step 1 — hotfix (size M, ship first)

All changes are in `app/(published)/_components/`.

1. **`SidebarScrollArea.tsx`**
   - Save the offset synchronously on `pointerdown` inside the container and on `pagehide`, as well
     as on the debounced scroll. (Fixes #2.)
   - Ignore the scroll event caused by our own restore (set a `restoring` flag, compare against the
     expected value) so a clamped restore can never overwrite the stored offset. (Fixes #1.)
   - Key by `siteId:variantId`, not `siteId`. (Fixes #6.)
   - Remember which `<details data-node-id>` groups the reader opened (a `Set` per key in
     `sessionStorage`, updated from `toggle` events), and **apply them before restoring the
     offset**, so heights match. (Fixes #1 and the manual-expand loss.)
   - After restoring, if the active link is outside the visible box, set `scrollTop` so it sits a
     third of the way down. Container maths only — never `scrollIntoView`, which also scrolls the
     page. (Fixes #4.)
2. **`SidebarList.tsx` / `SidebarTree.tsx`** — add `aria-current="page"` and `data-node-id` to the
   active link and each `<details>`. (`aria-current` is also an accessibility fix, F2.)
3. **`EditModeContext.tsx` + `renderPublishedSite.tsx`** — take the initial `editing` value from a
   cookie (`gc-edit-<siteId>`) read on the server and passed as a prop, and write the cookie in
   `setEditing`. The first render is then already the right component: no list→tree swap, no
   clamped restore. (Fixes #3.)
4. **Hard loads** (#5): the restore cannot run before hydration, and the browser only restores the
   window's scroll, never an inner container's. Render a tiny inline script right after the sidebar
   `<div>` (nonce from the `x-nonce` header) that applies the stored offset and open groups
   synchronously during parse. This stays after step 2: a persistent shell does not help a hard load.

**Acceptance.** The harness in [§7](#7-appendix-reproduction-harness) passes scenarios 1–6 within
±2 px and records no console errors.

### Fix, step 2 — persistent shell (size L)

Move the shell into layouts so it survives navigation by construction (this also fixes B1, A6 and
most of C-track's `window.location.href` workarounds).

- `app/(published)/[siteSlug]/layout.tsx` and `site-by-domain/[hostname]/layout.tsx` render: the
  `[data-site-root]` wrapper with the theme `<style>`, announcement banner, header, section tabs,
  sidebar, footer, theme toggle and `EditModeProvider`. The page renders only `<main>` and the right
  rail.
- A layout's `params` hold only its own segment and above (`siteSlug`), **not** `path`, and layouts
  do not re-render on navigation `[docs: layout.md]`. So the layout loads the whole site structure
  once — sections → spaces → variants → page trees — and a client component derives the active
  section, variant and page from `usePathname()` against a `Map<canonicalPath, nodeId>` built from
  the trees. A tree is `{id, title, slug, icon, isGroup, children}`; a 1,000-page site is ~150 KB,
  sent once per session instead of once per click.
- **Access must be enforced in both places.** The layout checks `resolveVisitorAccess` before it
  renders any tree; the page checks it again, because the layout does not re-run on soft
  navigation.
- Split `resolvePublishedPath` into `resolveSiteStructure(site)` (wrapped in React `cache()`, used
  by layout and page) and `resolvePage(structure, segments)`. This also removes the duplicate
  resolution that `generateMetadata` currently does (E2).
- Add `[[...path]]/loading.tsx` so a click shows an instant skeleton in the main column while the
  shell stays put.
- Structure edits already call `router.refresh()` / `revalidatePath(..., "layout")`; both refresh
  layouts, so the tree updates without a remount.
- Delete the per-navigation `sessionStorage` restore from step 1 (the shell no longer remounts).
  Keep the inline script for hard loads and the "scroll the active item into view" behaviour,
  driven by an effect on the active id.
- The sidebar becomes a client component that receives trees as props. Do **not** let it import the
  icon table (see E1): resolve each node's icon path on the server and pass the path string down.

**Alternatives considered.** (a) `cacheComponents` + `<Activity>` (Next keeps up to three routes'
DOM, scroll and `<details>` state alive) `[docs: preserving-ui-state.md]` — rejected for now: it
requires moving every `cookies()` / `headers()` / DB read in this permission-gated multi-tenant app
under `Suspense`, which is a larger migration than the layout move. Revisit later. (b) A parallel
route slot for the sidebar — rejected: slots are keyed by the same params and remount identically.

**Acceptance.** An e2e test marks `nav`, `header` and `main` with a property, performs 20
navigations (including a section switch, a variant switch and edit-mode on/off), and asserts the
markers survive and the sidebar offset never moves except when the active item leaves the viewport.

---

## 3. Audit findings

### Track A — navigation and links

| ID | Pri | Size | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| A1 | P0 | M | Sidebar scroll bug | §2 | §2 step 1 — **done (Phase 0)**; step 2 (A2) pending |
| A2 | P1 | L | Shell remounts on every navigation | §2 | §2 step 2 |
| **A3** | **P0** | S | **Sidebar, prev/next and the variant-aware links drop the section / space / `~v` prefix.** On a two-section site every sidebar link is `/multi-docs/page-1` and 404s (correct: `/multi-docs/guides/page-1`). On `/demo-docs/~v/v2/introduction` the sidebar points at `/demo-docs/introduction`, so one click silently leaves v2 | `[measured]` curl: `/multi-docs/page-1` → 404, `/multi-docs/guides/page-1` → 200; the v2 page's links | `pathsForTree()` returns slug-only paths; `ResolvedPath.pathPrefix` is only passed to `VariantSwitcher`. Build every href from one helper `pagePathFor(node, ctx)` (prefix + `~v` + slugs); `computePagePath` already does this correctly for search and RSS — share it between web and worker (D7) and use it everywhere — **Done (Phase 0).** |
| **A4** | **P0** | S | **"Previous" on the first page of every group links to the page itself.** `flattenPageTree` includes group nodes; a group's URL resolves to its first child. On `G2 Page 1` the Previous link is "← Group 2" → `/long-docs/group-2` → renders `G2 Page 1` | `[measured]` rendered HTML | Build prev/next from navigable (non-group) nodes only, in display order, so Previous of a group's first page is the last page of the previous group — **Done (Phase 0).** |
| A5 | P1 | M | Mobile menu is an in-page `<details>` that closes on every navigation | `[read]` `MobileNav` | Drawer in the persistent shell; scroll the active item into view when opened |
| A6 | P1 | S | Edit mode starts `false` and flips in an effect, so each navigation renders the read-only list, then the tree | `[read]`; consequences in §2 #3 | Cookie-initialised state (§2 step 1.3); gone entirely with A2 |
| A7 | P1 | M | Adding a second section silently changes every existing URL: with one section its slug is implicit, with two it becomes required, so all old links 404 with no redirect. The UI gives no warning | `[read]` `resolvePublishedPath`, `SectionsManager` | **Decided (§6): redirect.** Resolve legacy implicit paths inside the first section and answer `308` with the canonical URL; refuse to add a section whose slug equals a top-level page or group slug of the first section |
| A8 | P2 | S | Renaming a page or group rewrites its slug (and every child's URL for a group) with no redirect | `[read]` `renamePage` | Stable slug by default, an editable slug field, and an automatic `SiteRedirect` whenever a slug changes |
| A9 | P2 | M | `pageLink` block is a free-text path field; breaks on rename | `[read]` | Page picker storing a stable page id, resolved at render (GitBook's `content-ref`) |

### Track B — reader experience

| ID | Pri | Size | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| **B1** | **P0** | S | **Dark/light choice is not applied.** The toggle stores the choice in `localStorage` but only writes `data-site-mode` when you click. After a soft navigation or a reload the attribute is `null` while the toggle still shows "Dark" pressed — the UI says dark, the page is not | `[measured]` attr after click `dark`, after navigation `null`, after reload `null`; `stored: "dark"` | Persist in a cookie, render the attribute server-side in the layout (no flash, no inline script needed). Honour the unused `theme.darkMode.enabled/default`; hide the toggle when disabled — **Done (Phase 0).** |
| B2 | P1 | L | **Search.** Whole-word stems only: `Bod` → 0 results, `Body` → 10 `[measured]`. Snippet is the start of the page, not the match; no loading state, so "No results" flashes while typing; out-of-order responses can show stale results; capped at 10; searches every variant of the site; no dialog semantics or focus trap; text inside cards, callout titles, buttons, step titles, page-link cards is not indexed (`extractPlainText` ignores props); the `english` config is hard-coded | `[measured]` / `[read]` | Prefix queries (`:*`) and `pg_trgm` for typo tolerance; `ts_headline` snippets; `AbortController` + request id; scope to the current variant (toggle for "whole site"); per-block text extractors; site locale → text-search config; ARIA dialog + `aria-activedescendant`; paginate; compute result paths from the preloaded tree instead of N+1 `computePagePath` calls |
| B3 | P1 | M | **Share links work for exactly one page.** The token is read only from the query string of the first request; sidebar links, in-page images (`/api/files/…`), search and RSS all lose it | `[measured]` first page 200, `/private-docs/secret-two` → private | On first valid token, set a signed `HttpOnly` cookie scoped to the site, redirect to the URL without `?token=`, and accept the cookie in `resolveVisitorAccess`, the files route, search and RSS. Also stops the token leaking through `Referer` |
| **B4** | **P0** | L | **Published renderer does not match the editor.** `quote` renders as a plain paragraph; `video` and `audio` render nothing; table `headerRows` is ignored (no `<th>` anywhere); hard line breaks (`\n`) collapse; text colour, background colour and alignment set in the editor vanish; external image URLs are blocked by the CSP (`img-src 'self' data: blob:`) | `[measured]` kitchen-sink page: `blockquote:false, video:false, audio:false, th:0`, `white-space: normal`, CSP console error | Add the missing cases to `blockRenderer.tsx`; honour inline `textColor`/`backgroundColor` and block `textAlignment`; `white-space: pre-line` on inline text; `<thead>` / `<th scope>` from `headerRows`/`headerCols`; decide the external-image policy (import on save, or allow `https:` images). Add a **parity test**: every block in `gitCrookSchema` must have a renderer case and a markdown serializer case, and each has a golden HTML snapshot |
| B5 | P1 | M | Heading anchors are random block ids (`#b9`), unreadable and regenerated on every re-import. The right-rail outline, and the feedback widget living in the same `hidden xl:block` aside, vanish below 1280 px | `[measured]` ids; `[read]` aside | GitHub-compatible slugs via `github-slugger` with de-duplication, a hover "copy link" affordance, a collapsible "On this page" under the title on small screens, and the feedback widget moved below the content |
| B6 | P2 | S | Floating dark-mode pill and creator toolbar sit bottom-right over content and code on phones | `[read]` | Move the theme toggle into the header or footer; collapse the creator toolbar into the header bar |
| B7 | P1 | S | Private-site and password screens are unthemed; the private message has no "Sign in" link, and sign-in always returns to `/dashboard` | `[read]` | Theme the screens, add `Sign in` with `returnTo`, add `noindex` |
| B8 | P2 | M | "Copy / View as Markdown" uses `blocksToMarkdown`, which is lossy (tables export empty; cards, steps and columns flatten) and the markdown string for every page is serialised into every reader's payload | `[read]` | Replace with the new serializer (GS-04), and serve it lazily from `/<page>.md` instead of embedding it |
| B9 | P1 | M | `/api/files/[assetId]` sends `private, no-store` for every site-scoped asset, including images on **public** sites; reads the whole file into memory and copies it; no `Range` support, so video does not seek in Safari | `[read]` | Public sites: `public, max-age`, `ETag`, `304`; stream from disk; implement `Range`; `width`/`height` on images, `loading="lazy"`, WebP/AVIF variants via sharp |
| B10 | P2 | S | No print stylesheet: PDF export and printing include the header, sidebar and floating toggles | `[read]` no `@media print` | Print CSS: hide chrome, expand `<details>`, show link targets |
| B11 | P2 | M | Readers cannot export a PDF (export is only reachable from the dashboard editor page), and export renders the **public URL**, so non-public sites produce a PDF of the gate screen | `[read]` | A signed, short-lived render token the worker passes to a dedicated render route; add "Download PDF" to page actions |
| B12 | P3 | S | `Last updated` shows only relative time | `[read]` | `title` attribute with the absolute time; later, the last-touching commit |

### Track C — creator experience

| ID | Pri | Size | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| C1 | P1 | M | **"Add new" can only create at the root of the first section's default variant.** On a multi-section site it creates in section 1 and then redirects to a URL that 404s; non-default variants cannot receive pages from the UI at all, so the variants feature is half-built. Pages cannot be created inside a group or under another page, although the model supports it | `[read]` `createPage`, `createPageGroup`, `importMarkdownPages` | Pass `{ variantId, parentId }` from context; per-group "+" in the edit-mode tree; indent / outdent to nest a page under a page |
| C2 | P1 | S | "Add new…" sits at the bottom of the scrolling list, so on a long tree you scroll to the end to find it | `[read]` | Pin it outside the scroll container |
| C3 | P1 | S | Delete confirmation, delete errors and rename errors render at the **top** of the sidebar panel, off-screen when you are scrolled down | `[read]` `SidebarTree` | Inline at the row, or a toast |
| C4 | P1 | M | Rename: Escape cancels but `onBlur` can still submit; Enter + blur can double-submit; single click navigates while double click renames (the first click already navigated); groups rename on click but pages need the pencil | `[read]` | One `commit()` guarded by a ref; a consistent rename affordance (F2 / pencil only) |
| C5 | P1 | M | **Title, description and icon cannot be edited in the page itself.** The `<h1>` is static; `Page.description` is rendered and used for `<meta>` but **no UI writes it anywhere** | `[ran]` grep: only readers of `description` | Editable title and description fields at the top of the editor; icon picker beside the title |
| C6 | P1 | M | **Autosave conflicts lose edits.** On a version mismatch the bar says "Edited elsewhere — reload" but offers no action, the editor keeps accepting input, and every later save is rejected. The version check is also not atomic (read then write), so two tabs can both pass it and the last write wins | `[read]` | `updateMany({ where: { id, contentVersion } })` and check the count; banner with Reload / Copy my version / Overwrite; `beforeunload` guard while dirty; "Saved 3 s ago" |
| C7 | P2 | M | Page history shows plain-text excerpts only and snapshots at most every 5 minutes, so a bad edit inside that window cannot be undone | `[read]` | Rendered preview and diff; snapshot before the first edit of a session; named versions; open history from the live toolbar |
| C8 | P1 | M | Page delete is permanent, cascades to children, history and comments, has no undo, and is not audit-logged | `[read]` `deletePage` | Soft delete with a 30-day trash and an undo toast; audit entry |
| C9 | P2 | M | Two editors to maintain: dashboard `EditorClient` and live `InPlaceEditorClient` | `[read]` | Remove the dashboard route or share one component |
| C10 | P1 | M | Settings modal: Esc or a backdrop click discards unsaved Theme edits; no focus trap or focus return; `onChanged` is dead code so lists in the access and variants panels are probably stale after an action; variants cannot be renamed, deleted, reordered or made default; sections have no reorder, icon or slug editing; the domain panel sends you to the dashboard to verify | `[read]` | Dirty-state guard; focus trap; call `load()` after mutations; finish the CRUD |
| C11 | P2 | M | Per-site / section / space / page role overrides are enforced by RBAC and advertised in the README, but **no UI creates them** | `[ran]` grep for `*Permission.create` → none | An "Access" panel per resource, or stop advertising it |
| C12 | P2 | M | No org switcher: a member added to someone else's org has no way to reach its dashboard; invites need an email the person must already have signed in with | `[read]` | Switcher in the dashboard header; invite by link |
| C13 | P2 | M | Markdown import: root level only, front matter is imported as visible text, images are not handled, re-importing duplicates pages (`-1` suffix) | `[read]` | Superseded by Git Sync; meanwhile strip front matter |
| C14 | P3 | S | Editor-menu group is labelled "GitBook blocks"; editor-side block styling is hard-coded light colours (`pageLink`); the BlockNote theme is chosen once at mount; drag handles are pointer-only (add dnd-kit `KeyboardSensor`); the drag drop-strips shift the list while dragging | `[read]` | Rename the group; theme tokens; keyboard sensor; absolutely positioned strips |
| C15 | P2 | M | Login shows a message only for `AccessDenied`; any other OAuth error leaves a silent form | `[read]` | Map Auth.js error codes to messages; link to the README troubleshooting |
| C16 | P2 | M | Analytics counts creators' own views and bots; "Unique visitors" over a multi-day range is really visitor-days (the hash rotates daily); raw events are never pruned and `AnalyticsDailyRollup` is unused; top pages show the slug rather than the path | `[read]` | Exclude signed-in members and known bots; relabel; roll up and prune in the worker; full path |

### Track D — reliability and data integrity

| ID | Pri | Size | Finding | Fix |
| --- | --- | --- | --- | --- |
| D1 | P0 | S | `savePageContent` version check is a read followed by an update (C6) | Conditional `updateMany` — **Done (Phase 0).** |
| D2 | P1 | S | Page slug uniqueness among siblings is checked only in application code (`parentId` is nullable, so a unique index cannot express it) → races produce duplicates; `createSite` has the same race | Two partial unique indexes (`WHERE "parentId" IS NULL` and `IS NOT NULL`); catch `P2002` |
| D3 | P1 | S | Several server actions `throw` on permission failure (`assertCanManage` in access, domain, members) → a generic production error page instead of a message | Return typed errors |
| D4 | P2 | M | Export jobs claimed as `PROCESSING` are never reclaimed if the worker dies; no timeout, retry or retention; no rate limit | `startedAt`, a reaper, `attempts`, a per-user cap |
| D5 | P2 | M | Create / rename / delete / reorder use `window.location.href` full reloads (a documented workaround for a Next transition issue), which resets all client state | Find the root cause (likely `redirect()` inside the action); standardise on `router.push` + `router.refresh()` in `startTransition` |
| D6 | P2 | M | Uploaded assets are never garbage-collected; content-addressed keys but many `Asset` rows; site deletion detaches assets | Decide the lifecycle; refcount and a GC job; per-org storage quota |
| D7 | P1 | S | `computePagePath` is duplicated in `apps/web` and `apps/worker`; the published-URL rule is repeated in four places | One implementation in `packages/shared` / `packages/db` |
| D8 | P2 | S | Maintainer debug scripts committed under `packages/db/prisma/` (`deletePageById.ts` is destructive) | Move to `scripts/dev/` with a production guard, or delete |
| D9 | P2 | M | Legacy "VoidDocs" naming: `vd-pw-*` cookie, `vd-*` CSS classes, `voidsmp.com` in the seed, `.env.example`, Caddyfile and compose | Rename with a cookie shim so existing sessions survive |
| D10 | P2 | M | Dead theme config: `themeStyle`, `iconStyle`, `darkMode`, `localizationOverrides`, `ogImage` and `Site.defaultLocale` are in the schema and read nowhere; `codeTheme`, `pageActions`, `showToolbarForMembers` have no UI. The `Variable` model is unused. `mermaid` was a dependency that nothing imported (removed) | Implement or remove each; add a lazy, client-only Mermaid block back when Git Sync needs ```` ```mermaid ```` |
| D11 | P3 | M | `Page.isDraft` / `publishedAt` exist with no workflow | A per-page "Unpublish" toggle now; change requests later |
| D12 | P3 | S | Rate limiter is in-process and resets on restart | Document; add Caddy-level limits for upload, search and auth |
| D13 | P3 | S | `process.env.ROOT_DOMAIN` is read directly in `proxy.ts` and domain actions | Centralise through `getEnv()` |

### Track E — performance

| ID | Pri | Size | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| **E1** | **P1** | M | **The 1,400-icon path table (601 KB of source, 179 KB gzipped) ships to every reader.** A reader's first load is 1,531 KB of JavaScript uncompressed across 19 requests; the icon chunk is 598 KB of it | `[measured]` chunk list; the chunk contains `clock-counter-clockwise` | Split `findPageIcon` (server) from `searchPageIcons` (picker, `dynamic()`-imported); resolve used icons on the server and pass the SVG path strings as props |
| E2 | P1 | M | Per navigation: `loadSiteTree`, a query per path segment, `getPageTree`, `canUserDoX` twice (each up to six queries), the org slug, plus the same path resolution again in `generateMetadata` — sequential and uncached | `[read]` | `cache()` the structure; `Promise.all` independent reads; cache per site with explicit invalidation on structure edits |
| E3 | P2 | S | `resolveEffectiveRole` is an N+1 walk (chain + up to five lookups) | `[read]` | One joined query; resolve once per request and reuse |
| E4 | P2 | S | RSS reads and walks every page's full JSON on each request, and resolves a path per item | `[read]` | Cache with an `ETag`; compute links from the tree |
| E5 | P2 | S | `/api/files` buffers the whole file | `[read]` | Stream |
| E6 | P3 | S | Search runs `computePagePath` per result | `[read]` | Use the preloaded tree, or materialise `Page.path` |
| E7 | P3 | S | "Unique visitors" groups all hashes in memory | `[read]` | `COUNT(DISTINCT …)` or rollups |
| **E8** | **P1** | S | **Every visitor receives the page JSON twice, plus a third copy as markdown.** `EditableArea` is given `initialContent` and `initialVersion` for all visitors, and `PageActions` is given the page's full markdown string; client-component props are serialised into the payload regardless of `canEdit` | `[read]`; first-page HTML is 254 KB for a trivial page `[measured]` | Pass `initialContent` only when `canEdit`; serve markdown on demand (B8) |

### Track F — SEO, accessibility, i18n

| ID | Pri | Size | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| F1 | P1 | M | **No `robots.txt`, `sitemap.xml`, canonical link, OpenGraph / Twitter tags or `noindex` for non-public sites.** `robots.txt` and `sitemap.xml` are in the reserved-slug list but no route exists | `[measured]` all four URLs → 404; no `og:` / canonical / robots tags in the HTML | Per-host `robots.txt` and `sitemap.xml` route handlers (custom domains need their own); `generateMetadata` with canonical, OG, Twitter, JSON-LD breadcrumbs; `noindex` for non-public; implement `ogImage` |
| F2 | P2 | M | Accessibility: search overlay and modals lack `role="dialog"`, focus trap and focus return; no skip-to-content link; sidebar group headers are `<p>`; active link has no `aria-current`; drag-to-reorder is pointer-only; no `prefers-reduced-motion` handling | `[read]` | Dialog primitives; skip link; `aria-current`; keyboard sensor; reduced-motion |
| F3 | P3 | L | Every reader-facing string is hard-coded English and `<html lang>` is fixed to `en`, though `defaultLocale` and `localizationOverrides` exist | `[read]` | A small message catalogue; set `lang` from the site |
| F4 | P2 | S | The static `/_not-found` page is prerendered, so it cannot carry the per-request CSP nonce (the marketing page's own comment describes the failure) | `[ran]` build output lists `○ /_not-found` | Make it dynamic or give it its own `not-found.tsx` |

### Track G — infrastructure, tooling, documentation

| ID | Pri | Size | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| **G1** | **P0** | S | **A fresh clone could not `pnpm install`**: `prisma generate` runs as a postinstall and `prisma.config.ts` required `DATABASE_URL`, which a new clone does not have. The README linked a `RUNBOOK.md` that was deleted in `3e59113`; `.env.example` and a Dockerfile comment referenced it too | `[measured]` install exited 1 on `PrismaConfigEnvError` | **Done.** `generate` now falls back to a placeholder URL (it never connects); every other command still requires the real value. Dead RUNBOOK references removed |
| G2 | P1 | S | `pnpm --filter @gitcrook/web start` printed "does not work with output: standalone" | `[ran]` | **Done.** Removed the script; production runs the standalone server in Docker |
| G3 | P1 | M | **Lint is not set up.** `pnpm lint` fails (`eslint .` with no config and no ESLint dependency) while the source has `eslint-disable` comments for `@next/next` and `jsx-a11y` rules | `[ran]` exit 2 | ESLint 9 flat config with `eslint-config-next` and `jsx-a11y`; a CI step |
| G4 | P1 | L | **No tests.** `pnpm test` exits 1 ("No test files found") | `[ran]` | Vitest suites first for: RBAC matrix, `resolveVisitorAccess`, path resolution (implicit levels), path building, slug rules, rate limiter, `safeFetch` IP rules, and — new — markdown ↔ blocks round trips. Then a Playwright smoke set including the §7 sidebar scenarios |
| G5 | P1 | M | CI is typecheck + build + migrations only | `[read]` | Add lint, vitest, Playwright against the built app with a Postgres service, `pnpm audit --prod`, CodeQL, Dependabot, a `docker build` job |
| G6 | P0 | M | `pnpm audit` reported advisories against the pinned `next` and `sharp` and some transitive packages, and nothing updated dependencies automatically | `[ran]` | **Done:** `next` 16.3.8, `sharp` 0.35.5, Prisma 7.10.1, vitest 4, `mermaid` removed (unused), workspace `overrides` for three transitive floors; `pnpm audit` is clean. **Still to do:** Dependabot and an audit step in CI (G5) so it stays that way. (The original advisory list is in the private file.) |
| G7 | P2 | S | No `packageManager` field: the Dockerfile's `corepack enable` fetches whichever pnpm is current, CI uses 11, local installs vary | `[read]` | Pin `"packageManager": "pnpm@…"` |
| G8 | P2 | M | Compose / Caddy: the shipped `Caddyfile` contains a maintainer-specific `dev.voidsmp.com` reverse-proxy block and compose maps `host.docker.internal`; `postgres` has no restart policy; no `web` healthcheck; no resource limit on the Chromium worker; no `request_body max_size` for uploads; no backups | `[read]` | Remove the block (or move it to an optional include); add `restart`, healthchecks, `mem_limit`, a body-size cap; ship a documented backup recipe or an opt-in `backup` service |
| G9 | P3 | S | No `/api/health`, no structured logs | `[read]` | Health route that pings the DB; JSON logs |
| G10 | P2 | S | The `searchVector` migration hazard is documented only in a schema comment | `[read]` | A CI check that fails if a migration contains `DROP INDEX "Page_searchVector_idx"` |
| G11 | P3 | S | No `SECURITY.md`, `CONTRIBUTING.md`, issue templates or `CODEOWNERS` (the README says to file a security advisory) | `[read]` | Add them |
| G12 | P3 | M | A first-run checklist in the dashboard (auth configured? domain? backups?) | — | Optional |

---

## 4. Git Sync

### 4.1 Goal and principles

Let a site's content live in a Git repository so that docs stay current when code changes —
including when an AI coding agent changes it — without anyone opening the editor.

1. **Repository is the source of truth** for the pages it manages. v1 is one-way: repo → site.
2. **Lossless or locked.** No feature may silently drop or rewrite content. If a page cannot
   round-trip, it is read-only; it is never "mostly" converted.
3. **Plain Markdown first.** Standard content is CommonMark + GFM. Custom blocks use syntax that
   GitHub and editors can still display sensibly.
4. **Everything is observable.** Each sync leaves a log; each failure names a file and a line.
5. **The repository is untrusted input.** Sanitise, bound, validate, and fetch only from an
   allow-listed host.
6. **Provider-agnostic core, GitHub first.**

### 4.2 User stories

- *Maintainer:* "I merge a PR that renames a CLI flag; the docs page that mentions it updates
  without me touching the site."
- *AI agent:* "Asked to document a new endpoint, I write `docs/api/widgets.md`, run
  `gitcrook-docs check`, commit; the site updates and I can read the published page back as
  Markdown."
- *Docs lead:* "I connect an existing GitBook-synced repository and the site renders without
  rewriting anything."
- *Reader:* "I click **Edit on GitHub** on any page."
- *Site admin:* "A sync failed — I can see which file, which line, and re-run it."

### 4.3 Architecture

```
GitHub ── push ──► POST /api/webhooks/github ──► GitSyncRun(PENDING)   (verify HMAC, dedupe, 202)
                                                        │
worker poll (ETag, every N s) ──────────────────────────┤
dashboard "Sync now" ───────────────────────────────────┘
                                                        ▼
                                  apps/worker: claim run (atomic UPDATE, advisory lock per source)
                                                        │
        packages/git-sync  ── GitHub API (via hardened safeFetch) ──► tree / compare / blobs
                                                        │
        packages/markdown  ── parse files → blocks + diagnostics (no DOM, no network)
                                                        │
                       one DB transaction: upsert pages, nav, redirects, assets, versions
                                                        │
                       revalidatePath(site, "layout") → readers see it
```

New workspace packages:

- `packages/markdown` — pure TypeScript, no DOM, no network: parse, serialise, nav, front matter,
  diagnostics. Used by the worker, the web app (Copy as Markdown, `.md` endpoints) and the CLI.
- `packages/git-sync` — provider interface, GitHub client, sync planner and applier.
- `packages/docs-cli` — `gitcrook-docs check` (and later `migrate-gitbook`).

### 4.4 Data model (draft migration)

```prisma
enum GitProvider      { GITHUB }
enum GitSyncStatus    { IDLE SYNCING ERROR PAUSED }
enum GitSyncTrigger   { WEBHOOK POLL MANUAL FULL }
enum GitSyncRunStatus { PENDING RUNNING SUCCEEDED PARTIAL FAILED CANCELLED }
enum PageManagedBy    { EDITOR GIT }

model GitSource {
  id               String           @id @default(cuid())
  organizationId   String
  siteId           String
  variantId        String           @unique        // v1: one source manages one variant's tree
  provider         GitProvider      @default(GITHUB)
  owner            String
  repo             String
  branch           String
  rootDir          String           @default("")
  credentialId     String?
  status           GitSyncStatus    @default(IDLE)
  lastSyncedSha    String?
  lastSyncedAt     DateTime?
  lastCheckedAt    DateTime?
  lastError        String?
  etag             String?
  pollIntervalSec  Int              @default(300)
  deleteGraceDays  Int              @default(14)
  createdById      String
  createdAt        DateTime         @default(now())
  runs             GitSyncRun[]
  pages            Page[]
}

model GitCredential {                                // never selected by default; never logged
  id               String   @id @default(cuid())
  organizationId   String
  kind             String                            // GITHUB_APP_INSTALLATION | TOKEN
  installationId   String?
  secretCiphertext Bytes?                            // AES-256-GCM
  keyId            String                            // for key rotation
  createdAt        DateTime @default(now())
}

model GitSyncRun {
  id          String           @id @default(cuid())
  sourceId    String
  trigger     GitSyncTrigger
  deliveryId  String?          @unique               // webhook idempotency
  fromSha     String?
  toSha       String
  status      GitSyncRunStatus @default(PENDING)
  startedAt   DateTime?
  finishedAt  DateTime?
  stats       Json?                                   // {added, updated, moved, deleted, unchanged, warnings, errors}
  diagnostics Json?                                   // capped list of {path, line, severity, code, message}
  error       String?
  createdAt   DateTime         @default(now())
  @@index([sourceId, createdAt])
}

// Page:   managedBy PageManagedBy @default(EDITOR); sourceId String?; sourcePath String?;
//         sourceBlobSha String?; frontMatterId String?; deletedAt DateTime?
//         @@unique([sourceId, sourcePath]); @@index([sourceId, frontMatterId])
// Asset:  sourceId String?; sourcePath String?; sourceBlobSha String?
// PageVersion: origin ("EDITOR"|"GIT"|"RESTORE"); commitSha String?
```

Prisma cannot express the partial slug indexes (D2) or the generated `searchVector`; write those as
raw SQL in the migration and follow the `searchVector` caution in `schema.prisma`.

### 4.5 The sync algorithm

Run in `apps/worker`; one run per source at a time (`pg_advisory_xact_lock(hashtext(sourceId))`);
webhook bursts coalesce — the newest SHA wins.

1. **Resolve the target SHA.** From the webhook payload (`after`), or by polling
   `GET /repos/{o}/{r}/branches/{b}` with `If-None-Match`. If `toSha == lastSyncedSha`, finish
   `SUCCEEDED` with no changes.
2. **Plan.** Prefer `GET /compare/{lastSyncedSha}...{toSha}` (added / modified / removed / renamed).
   Fall back to the full tree (`GET /git/trees/{sha}?recursive=1`) on first run, a force-push (base
   unreachable), a truncated tree, or "Full re-sync". Filter by `rootDir`.
3. **Read config first**: `gitcrook.yaml`, `.gitbook.yaml`, `SUMMARY.md`. A config error fails the
   run before anything is touched.
4. **Fetch** changed `.md` / `.mdx` blobs and referenced assets, concurrency 4, honouring
   `Retry-After` and `X-RateLimit-*`. Reject symlinks (mode `120000`), submodules and LFS pointers
   with a diagnostic.
5. **Parse** each file with `packages/markdown`; collect diagnostics; never throw for content.
6. **Build the navigation** (§4.7) from the *full* set of known files, not only the changed ones.
7. **Apply in one transaction**
   - upsert pages by `(sourceId, sourcePath)`; first match `frontMatterId` so an explicit `id:`
     survives moves;
   - **rename detection:** a path that disappeared and a new path with the same blob SHA is a move —
     keep `Page.id` and history, update slug and parent, and insert a `SiteRedirect` from the old
     URL;
   - **deletion:** a file missing from the *full* tree sets `deletedAt` (the page stops being
     served); rows are hard-deleted after `deleteGraceDays`; a bad compare result can therefore
     never delete content;
   - slugs: front-matter `slug` > file name; collisions get a deterministic suffix, never random;
   - increment `contentVersion`, write a `PageVersion` with `origin: GIT` and the commit SHA, refresh
     `contentText` (including per-block text, B2);
   - import assets through the shared upload library (type sniffing, sharp re-encode, size caps,
     content-addressed key).
8. **Finish**: write `stats` and `diagnostics`, set `lastSyncedSha` **only on success**, and
   revalidate the site's layout (`revalidatePath("/<slug>", "layout")`). A failure rolls back and
   leaves the site as it was.

Limits (configurable): 5,000 files per source, 1 MB per Markdown file, 20 MB per image, 500 MB per
run, 10-minute run timeout, block depth 20, 5,000 blocks per page.

### 4.6 Content format — "GitCrook Markdown" (GCM)

Published as `docs/git-sync/FORMAT.md` with a conformance suite (`packages/markdown/fixtures/*.md`
paired with `*.blocks.json`), and a one-page agent cheat-sheet generated from the same schema.

| Block (editor) | In Markdown | Notes |
| --- | --- | --- |
| Paragraph, headings 1–3 | CommonMark | `###` and deeper clamp to 3 in the editor; warn on `####`+ |
| Bold, italic, strike, code, links | CommonMark / GFM | Underline and colours are editor-only → warn on import (`<u>` is accepted) |
| Hard break | trailing backslash or two spaces | |
| Bullet / numbered / task lists | GFM | numbered `start` honoured |
| Quote | `>` | |
| Divider | `---` | |
| Code block | fenced, with `title="…"` in the info string | language ids are Shiki's |
| Table | GFM pipe table; alignment row; first row is the header | Merged cells, block content in cells → HTML `<table>` fallback and the page is marked non-round-trippable |
| Image | `![alt](./path "caption")` | Relative paths are imported as assets |
| Video / audio / file | leaf directives `::video{src="…"}`, `::audio{…}`, `::file{src="…" name="…"}` | |
| **Callout (hint)** | `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` — optional title after the marker: `> [!WARNING] Heads up` | GitHub renders untitled alerts natively; a titled one degrades to a plain quote. `info→NOTE`, `success→TIP`, `warning→WARNING`, `danger→CAUTION`; `IMPORTANT` imports as `info` (one-way, flagged non-round-trippable) |
| Expandable (toggle) | `<details><summary>Title</summary>` … `</details>` | GitHub-native; same as GitBook |
| Tabs | `::::tabs` containing `:::tab{title="npm"}` … `:::` | colon count grows with nesting |
| Stepper | `::::stepper` / `:::step{title="Install"}` | |
| Columns | `::::columns` / `:::column{width=1}` | max 2 in GitBook; we allow up to 4 |
| Cards | `::::cards` / `:::card{title href image}` | |
| Changelog | `::::updates` / `:::update{date="2026-10-01" tags="api,breaking"}` | feeds the existing RSS |
| Button | text directive `:button[Label]{href="…" style="secondary"}` | |
| Embed | leaf directive `::embed{url="https://youtu.be/…"}` | still limited to the CSP-allowed providers |
| Math | `$$ … $$` block, `$…$` inline | KaTeX |
| Page link | `[Title](./other.md)`; alone in a paragraph with `{.card}` renders as a card | resolved to a page id |
| Mermaid | ```` ```mermaid ```` | needs the Mermaid block (D10) |
| Unknown directive | rendered as a visible code block + `GS-203` warning | content is never dropped |

Example:

````md
---
title: Install
description: Get GitCrook running locally.
icon: download
order: 2
redirect_from: [getting-started/setup]
---

> [!WARNING] Node 22 recommended
> Node 20 works but the Docker images use 22.

::::tabs
:::tab{title="pnpm"}
```bash
pnpm install
```
:::
:::tab{title="npm"}
```bash
npm install
```
:::
::::
````

**Front matter**

| Key | Meaning | Default |
| --- | --- | --- |
| `title` | Page title | first `# H1` (removed from the body), else humanised file name |
| `description` | Subtitle and `<meta description>` | none |
| `icon` | An icon slug from the existing set | none |
| `slug` | URL segment | slugified file name |
| `order` | Sort key within its folder | alphabetical |
| `draft` | Do not publish | `false` |
| `hidden` | Published but not in the navigation | `false` |
| `redirect_from` | Old paths that should redirect here | none |
| `id` | Stable identity that survives renames and moves | none |
| `nav_title` | Sidebar label if different from `title` | `title` |

Unknown keys are kept and ignored with an `info` diagnostic. Invalid YAML is a per-file error with
the line number; it fails that file, not the run.

**GitBook compatibility (parse-only).** Accept `{% hint style="…" %}…{% endhint %}`, `{% tabs %}` /
`{% tab title="…" %}`, `{% stepper %}` / `{% step %}`, `{% columns %}`, `{% updates %}`,
`{% file %}`, `{% embed url="…" %}`, `{% include %}` (resolved within the repo), `<table
data-view="cards">`, `<figure>`, `<details>`, `.gitbook.yaml` (`root`, `structure.readme`,
`structure.summary`, `redirects`) and `SUMMARY.md`. The serializer always emits GCM; the CLI's
`migrate-gitbook` rewrites a repository's files to GCM in place.

### 4.7 Navigation

Precedence: **`gitcrook.yaml` `nav`** > **`SUMMARY.md`** > **folder tree**.

- *Folder tree.* A folder's `index.md` (or `README.md`) is that folder's own page and the folder's
  children nest under it. A **top-level** folder with no index becomes a page **group** (the model
  allows groups only at the top). A **deeper** folder with no index becomes a generated container
  page whose body is a `cards` listing of its children. Generated pages have no `sourceBlobSha`
  and are rebuilt from the child list, so they never count as a content change.
- *`SUMMARY.md`.* `##` headings are groups; nested list links are children; each file appears at most
  once; a link title (`[Page](page.md "Label")`) is the sidebar label.
- *Unlisted files* (present in the repo, absent from an explicit nav) are **warnings**
  (`GS-120`), not silent omissions — this is a known GitBook trap.
- *Sections and variants* map to config, not the folder tree (§4.11).

`gitcrook.yaml`:

```yaml
version: 1
root: docs                 # default: repository root
nav:                       # optional
  - README.md
  - group: Guides
    pages: [guides/install.md, guides/configure.md]
redirects:
  old/path: guides/install
```

### 4.8 Authentication and connectivity

| Option | Use | Notes |
| --- | --- | --- |
| **Public repository** | No credential | Unauthenticated API with `ETag` conditional requests; poll every 5 minutes; webhooks optional |
| **GitHub App** *(recommended for private repos)* | Per-organisation installation | Short-lived installation tokens minted from the App's private key; permissions `contents:read`, `metadata:read` (v2 adds `pull_requests:write`, `checks:write`). The dashboard offers a **GitHub App manifest flow** ("Create GitHub App") so self-hosters do not hand-configure anything |
| **Fine-grained token** | Private repo without an App | Read-only `contents`; stored encrypted |
| Deploy key + `git` | GitLab / Gitea / bare Git (v2) | Needs `git` in the worker image and an egress policy; never accept a user-supplied URL for a shell-out |

Secrets are encrypted with AES-256-GCM using `GIT_SYNC_ENCRYPTION_KEY` (32 bytes, base64) and a
`keyId` so keys can rotate; they are never selected by default, never logged, never returned to the
client. Planned configuration: `GIT_SYNC_ENCRYPTION_KEY`, `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GIT_SYNC_POLL_INTERVAL_SECONDS`,
`GIT_SYNC_ALLOWED_HOSTS` (defaults to the GitHub hosts; set it for GitHub Enterprise).

### 4.9 Webhook endpoint

`POST /api/webhooks/github` (Next route handler):

- read the **raw** body (size cap 5 MB), verify `X-Hub-Signature-256` with a timing-safe compare;
- handle `ping`, `push`, later `installation*` and `pull_request`; ignore everything else with 204;
- dedupe on `X-GitHub-Delivery` (`GitSyncRun.deliveryId` is unique);
- map `repository.full_name` + `ref` to sources, enqueue `PENDING` runs, return **202** within a
  second — never sync inline;
- rate limit per source; never echo secrets or bodies into logs.

### 4.10 Security requirements (non-negotiable before launch)

- **Outbound fetch (GS-10).** The current `safeFetch` validates DNS and redirects but does **not**
  pin the connection to the validated address (the code comment says so; the README now says so),
  enforces `maxBytes` only via `Content-Length` (a chunked response is unbounded), has gaps in its
  reserved ranges (CGNAT `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15`, `::`, hex-form
  IPv4-mapped IPv6, `64:ff9b::/96`), and currently has **no callers**. Implement pinning with an
  undici `Agent` whose `connect.lookup` returns the already-validated address, stream with a hard
  byte cap, extend the ranges, and add unit tests for each. All Git traffic goes through it with
  `allowedHosts`.
- **Untrusted content.** Allow-list raw HTML (`details`, `summary`, `kbd`, `sub`, `sup`, `br`,
  `table` family, `figure`, `img`, `video`, `audio`, `u`) through `rehype-sanitize`; never route
  repository HTML to `dangerouslySetInnerHTML` unsanitised; allow-list URL schemes
  (`http`, `https`, `mailto`, relative); validate directive attributes with per-block Zod schemas;
  bound nesting and block count; refuse path traversal in relative references; ignore symlinks,
  submodules, executables and `.js`.
- **Scope.** Only the configured branch and `rootDir` are read; a pull request's content is never
  published until merged; warn when the branch is unprotected.
- **Assets.** Same pipeline as editor uploads (magic-byte typing, sharp re-encode, caps). SVG is
  currently rejected everywhere; docs repositories use it for diagrams, so either add a strict
  sanitiser (decision, §6) or document the limit.
- **Webhooks and tokens** as §4.8–4.9; the endpoint is exempt from CSP/cookie logic and from
  Auth.js.
- **Abuse.** One source per variant, per-organisation caps on sources and sync frequency, a global
  worker concurrency limit.

### 4.11 Product behaviour

- **Granularity.** A `GitSource` manages one **variant's** page tree. Other variants, sections and
  the rest of the site stay editor-managed, so ownership is never partial *within* a tree.
- **Managed pages are read-only in the editor.** The in-place editor is not mounted; the page shows
  "Managed in Git — **Edit on GitHub ↗** (`path@branch`)"; the sidebar tree disables drag, rename,
  icon and delete for managed nodes; "Add new" is hidden in a managed variant. History shows the
  commit SHA and author, linked to GitHub.
- **Dashboard and settings modal → "Git Sync" panel.**
  - *Connect:* repo picker (from the installation, or a public URL), branch, folder; a **dry run**
    shows the detected tree and warnings before anything is imported; the first import is
    confirmed, not automatic.
  - *Status card:* last sync time and commit (linked), duration, result, webhook health ("last
    delivery 2 min ago"), next poll.
  - *Runs:* a table of recent runs; each expands to stats and per-file diagnostics with
    file:line.
  - *Actions:* **Sync now**, **Full re-sync**, **Pause**, **Test connection**, **Disconnect**
    (choose: detach pages to the editor, or delete them).
- **Redirects.** Moves and `redirect_from` become `SiteRedirect` rows automatically.
- **Mixed mode.** An editor-managed section or variant can sit beside a Git-managed one; mixing
  inside one tree is not supported in v1 (decision, §6).
- **Agent surface.** `GET /<page>.md` returns the page as GCM; `GET /llms.txt` and `/llms-full.txt`
  list and concatenate the site; the Git Sync panel has "Copy agent instructions" (the cheat-sheet);
  `gitcrook-docs check` validates a folder offline with the same parser.

### 4.12 Task breakdown

| ID | Size | Task | Depends on |
| --- | --- | --- | --- |
| GS-01 | M | Write `docs/git-sync/FORMAT.md` and the fixtures directory | — |
| GS-02 | L | `packages/markdown`: unified pipeline (`remark-parse`, `remark-gfm`, `remark-directive`, `remark-math`, `remark-frontmatter`), mdast → block JSON for core blocks | GS-01 |
| GS-03 | L | Directive mappers (callout, tabs, steps, columns, cards, updates, button, embed, file, video, audio), HTML allow-list, GitBook compatibility parse | GS-02 |
| GS-04 | L | Serializer blocks → GCM; round-trip property tests; replace `blocksToMarkdown` | GS-02 |
| GS-05 | S | Deterministic block ids (hash of path + index + type) and `github-slugger` anchors | GS-02, B5 |
| GS-06 | M | Front-matter and config schemas (Zod), diagnostics catalogue | GS-01 |
| GS-07 | M | Navigation builder (folders, index, `SUMMARY.md`, `gitcrook.yaml`, `.gitbook.yaml`) | GS-06 |
| GS-08 | M | Prisma migration (models above, partial slug indexes) | D2 |
| GS-09 | S | AES-256-GCM secret helper with key ids | — |
| GS-10 | M | Harden `safeFetch` (pinning, streaming caps, ranges) + tests | — |
| GS-11 | L | `packages/git-sync`: GitHub client (trees, compare, blobs, ETag, rate limits, App auth) | GS-09, GS-10 |
| GS-12 | XL | Sync engine: planner and transactional applier, rename detection, soft delete, redirects | GS-02…GS-08, GS-11 |
| GS-13 | M | Worker: run queue, advisory lock, poll scheduler, timeouts, stuck-run reaper | GS-08 |
| GS-14 | M | Webhook route: raw body, HMAC, dedupe, enqueue | GS-08 |
| GS-15 | M | Extract the upload pipeline from `/api/upload` into a library function; decide SVG | — |
| GS-16 | M | Managed-page UX: read-only editor, banner, Edit on GitHub, sidebar locks | GS-08, A2 |
| GS-17 | L | Dashboard and modal panel: connect, dry run, status, runs, actions | GS-12, GS-16 |
| GS-18 | M | GitHub App manifest flow | GS-11 |
| GS-19 | M | `packages/docs-cli` (`check`), JSON Schemas, cheat-sheet generator | GS-06 |
| GS-20 | S | `/<page>.md`, `/llms.txt`, `/llms-full.txt` | GS-04 |
| GS-21 | L | Test harness: fake GitHub API over a local bare repo; failure injection (truncated tree, force-push, rate limit, 5k files, bad YAML, symlink, traversal, cycles, duplicate slugs, missing README, case-colliding paths, LFS pointer) | GS-12 |
| GS-22 | M | Docs: README setup, FORMAT.md, agent guide, GitBook migration guide | all |
| GS-23 | L | *(v2)* Write-back as a pull request when the page round-trips losslessly (serialise → parse → equal), else keep it locked | GS-04, GS-18 |
| GS-24 | L | *(v2)* PR preview deployments and a GitHub check run / comment with the preview link | GS-12 |
| GS-25 | M | *(v2)* Variants from refs and sections from directories via `gitcrook.yaml` | GS-12 |
| GS-26 | L | *(v2)* Other providers behind the `GitProvider` interface | GS-11 |

**Diagnostics catalogue (starter):** `GS-101` invalid front matter · `GS-102` unknown front-matter key
· `GS-110` duplicate slug (suffix applied) · `GS-120` file not in explicit nav · `GS-130` broken
internal link · `GS-131` missing image · `GS-140` unsupported file type · `GS-150` file too large ·
`GS-160` symlink / submodule skipped · `GS-201` unsupported inline style · `GS-202` heading depth
clamped · `GS-203` unknown directive · `GS-204` HTML stripped · `GS-301` rate limited, retrying ·
`GS-302` branch unreachable · `GS-303` auth failed.

**Risk register.** GitHub rate limits (5,000/h per installation) → compare API + conditional
requests; huge or truncated trees → full-tree fallback and file caps; force-pushes → full re-sync;
case-insensitive or Unicode-colliding paths → normalise and diagnose; webhook storms → coalesce;
partial failure → single transaction, `lastSyncedSha` only on success; secrets in logs → redaction
test; reader-visible regressions → feature-flag per source.

**Testing.** Unit tests for parser, serializer, nav, rename detection and config; fixtures taken from
a GitBook-synced repo, a Docusaurus site and an MkDocs site; property test
`parse(serialize(parse(x))) == parse(x)`; integration tests against the fake GitHub API; e2e: push →
page visible; rename → redirect; delete → grace; bad YAML → run `PARTIAL` with a visible diagnostic.

---

## 5. Markdown and blocks

### 5.1 The problem in this codebase

Pages are stored as BlockNote JSON. Two converters exist and neither can carry a sync:

- **Blocks → Markdown** (`lib/renderer/toMarkdown.ts`) is lossy, and in places wrong `[ran]`. Fed a
  callout, a 2×2 table, a card, a coloured/underlined paragraph and a page link, it returned only
  `> **Heads up**` / `> careful`, `**Card one**` and `red under`: **the table is absent entirely**
  (the `table` case emits `children`, but rows live in `content`), the callout loses its style, the
  card loses its link and description, colour and underline are dropped, and **the page link
  vanishes** (the serializer reads `props.label`; the block's prop is `title`).
- **Markdown → blocks** (`ImportMarkdownForm`) calls BlockNote's `tryParseMarkdownToBlocks`, which
  needs an editor instance and a DOM, so it only runs in the browser and cannot run in a worker.
  Its server counterpart, `@blocknote/server-util`, pulls in `jsdom`, `yjs`, `@tiptap/pm` and
  `@blocknote/react` `[ran: npm view]` and still knows nothing about the custom blocks.

### 5.2 How GitBook solves it `[docs]`

- **A proprietary superset.** Ordinary blocks are Markdown; GitBook's own blocks are written as
  Liquid-style tags — `{% hint style="info" %}…{% endhint %}`, `{% tabs %}` / `{% tab title="…" %}`,
  `{% stepper %}` / `{% step %}`, `{% columns %}`, `{% updates %}`, `{% file %}`, `{% include %}` —
  plus HTML for the rest (`<details>`, `<table data-view="cards">`, `<a class="button">`,
  `<code class="expression">`, `<figure>`). GitBook is the serializer in both directions, so the
  round trip is lossless *because it owns the grammar*.
- **Configuration files.** `.gitbook.yaml` (`root`, `structure.readme`, `structure.summary`,
  `redirects`); `SUMMARY.md` for navigation (headings = groups, nested lists = children, each file
  once, link title = label); `gitbook-docs.yaml` with stable `key`s so content survives renames of
  a space.
- **A single writer at a time.** While Git Sync is on, live editing is disabled; changes go through
  change requests or Git. This is how they avoid conflicts rather than resolving them.
- **Stated limits.** Pull requests are not mapped to change requests; files absent from
  `SUMMARY.md` do not appear *even though the sync reports success*; editing from GitBook may
  create new Markdown files rather than reuse existing ones; "unsafe" files such as `.js` block the
  sync; 100 MB per file; the documented recovery for a failed sync is "make a small change and merge
  it to retrigger".

### 5.3 What we do better, and why

| GitBook | GitCrook | Why it matters |
| --- | --- | --- |
| Liquid-style tags, unreadable in GitHub and most editors | **GitHub alerts, `<details>`, `:::` directives** | GitHub's preview, Obsidian and editors still show something sensible; the parser is the standard unified/remark stack, not a one-off |
| Grammar is an implementation detail | **A published spec with a conformance suite** | Agents and third parties can generate valid files; regressions are caught by CI |
| Round trip is trusted | **Lossless-or-locked**: a page may be written back only if serialise → parse reproduces the original blocks | Never silently rewrites or drops content |
| Files missing from `SUMMARY.md` vanish silently | **Unlisted files are warnings** | The failure that surprises people most becomes visible |
| Renames duplicate pages | **Rename detection by blob SHA + stable `id` + automatic redirects** | Links, history and search rankings survive refactors |
| "Make a small change and merge again" | **Run log with file:line diagnostics, Sync now, Full re-sync, dry run** | Self-service debugging |
| No PR ↔ change-request mapping | **Write-back as a PR** (v2) and **PR previews** | Human review stays in Git |
| Needs a special "skill" file for AI | **`gitcrook-docs check`, a generated cheat-sheet, `.md` / `llms.txt` endpoints** | The agent workflow is first-class |
| Proprietary migration path | **Reads GitBook repositories as they are** and offers `migrate-gitbook` | A direct on-ramp for the product this replaces |

### 5.4 Alternatives rejected

- **Markdoc** (`@markdoc/markdoc`) — validated tags and a formatter, but its `{% %}` syntax is not
  renderable by GitHub.
- **MDX** — executes JavaScript; unacceptable for untrusted repositories.
- **BlockNote's own converters** — need a DOM, ignore custom blocks.
- **Storing the Markdown and rendering from it** — would discard the block editor and the existing
  renderer; instead the block JSON stays canonical and Markdown is a lossless interchange format.

---

## 6. Decisions needed

**Decided** rows are settled; the rest are recommendations awaiting a call.

| # | Decision | Status | Outcome / recommendation |
| --- | --- | --- | --- |
| 1 | Sync-target granularity | Recommended | One **variant** per source (§4.11) |
| 2 | Block syntax | Recommended | GitHub alerts + `<details>` + `:::` directives (§4.6), GitBook tags parse-only |
| 3 | Deleted files | Recommended | Soft delete with a 14-day grace |
| 4 | SVG in assets | **Decided** | **Allow, sanitised.** Strip scripts, event handlers and external references with an allow-list (svgo + a strict profile) on import and on upload; serve with `Content-Security-Policy: sandbox; default-src 'none'` and `nosniff`; render only through `<img>`. Do not rasterise untrusted SVG with sharp (its SVG renderer has a published advisory) |
| 5 | First auth path | Recommended | Public repo + fine-grained token first, GitHub App second (Phase 3 task order) |
| 6 | Adding a second section | **Decided** | **Redirect legacy URLs** (A7). A path whose first segment is not a section is resolved inside the first section and answered with a `308` to the canonical URL. Adding a section whose slug equals a top-level page or group slug of the first section is refused with an explanation |
| 7 | Keep the dashboard editor (C9)? | Recommended | Remove; one editor |
| 8 | Mixed ownership inside one tree | Recommended | Not in v1 |
| 9 | Sign-up policy default | **Decided** | **Closed by default.** The first sign-in on an empty database becomes the owner; after that only allow-listed Discord IDs and people holding an email invitation can create an account; `SIGNUP_MODE=open` opts in. Invitations are what keep "add a member" working with sign-up closed |
| 10 | External images (B4) | Recommended | Import at save/sync time; keep the CSP strict |

---

## 7. Appendix: reproduction harness

Used for every `[measured]` item. Recreate it as the first Playwright suite (G4).

**Environment.** Postgres, `.env` with `DATABASE_URL`, `AUTH_SECRET` (≥ 32 chars), `ROOT_DOMAIN=localhost:3000`;
`pnpm db:deploy && pnpm db:seed`; `pnpm build` and run the standalone server on port **3000** (the
host header must equal `ROOT_DOMAIN`, otherwise `proxy.ts` treats the request as a custom domain).
Chromium from `/opt/pw-browsers`; `playwright-core`.

**Fixtures.**

- `long-docs` — one section; 4 groups × 20 pages; every 5th page has 3 children (≈132 rows
  expanded, ≈97 collapsed). Sidebar scroll height collapsed 2861 px, all expanded 4970 px.
- `multi-docs` — two sections (`guides`, `api`), three pages each.
- `private-docs` — `PRIVATE`, with a share link `?token=sharetoken123`.
- `demo-docs` (from the seed) — default variant plus `v2`, and a "kitchen sink" page with `quote`,
  `video`, `audio`, a table with `headerRows: 1`, text containing `\n`, coloured text, a centred
  paragraph, an external image, two identical headings.
- A creator session: the seed prints a dev session token; set it as the `authjs.session-token`
  cookie.

**Scenarios** (selector: `nav[data-placement="sidebar"] div.overflow-y-auto`).

1. Expand every collapsed parent, scroll to the bottom, click a visible link → offset unchanged.
2. Scroll and click within 100 ms → offset unchanged.
3. Creator: switch edit mode on, scroll to 3600, click a link → offset unchanged, no
   list → tree swap.
4. Load a deep page in a new context → the active link is inside the visible box.
5. Reload with `Emulation.setCPUThrottlingRate` 4 → no frame painted at 0 when a stored offset
   exists.
6. Switch section / variant and back → each tree keeps its own offset.
7. Shell identity: tag `nav`, `header`, `main` with a JS property, click a link, assert the
   property survives.
8. Dark mode: click Dark, navigate, reload → `data-site-mode="dark"` on the root and the toggle
   agrees.
9. Links: every `href` in the sidebar on `multi-docs` returns 200; Previous/Next on `long-docs`
   never point at the current page.
10. Share link: open with `?token=`, follow a sidebar link and load an image → both succeed.

Per-frame tracing: install an `addInitScript` that records `scrollTop`, `scrollHeight` and whether
the tree or the list is mounted on every `requestAnimationFrame`, and wrap `scrollTop`'s setter to
log the stack of any code that moves the container.
