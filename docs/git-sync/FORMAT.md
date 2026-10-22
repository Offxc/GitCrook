# GitCrook Markdown (GCM)

The Markdown dialect GitCrook reads from a repository and writes back. It is CommonMark and GitHub-flavoured
Markdown, plus a small number of [directives](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444)
for the blocks Markdown has no word for (columns, cards, steppers and so on).

Two rules shape everything below:

1. **Anything GitHub renders sensibly, a GitCrook file also renders sensibly.** Callouts are GitHub alerts,
   expandable sections are `<details>`, tables are pipe tables. A page that uses only those reads fine in the
   repository's own file view.
2. **Nothing is lost silently.** Whatever GitCrook cannot represent is either kept as visible text or reported
   with a [diagnostic](#diagnostics). A file that cannot be written back without losing something is marked and
   left alone, never rewritten.

The implementation is `packages/markdown`. The files in [`packages/markdown/fixtures`](../../packages/markdown/fixtures)
are the conformance suite: each `name.md` has the blocks it must parse to (`name.expected.json`) and the
canonical text it must serialize to (`name.canonical.md`). A reimplementation that reproduces those files agrees
with this document.

## A page

```md
---
title: Install
description: Get GitCrook running locally.
icon: download
order: 2
---

# Install

Some text with **bold**, *italic*, ~~strike~~, `code` and a [link](./configure.md).
```

The title is the front-matter `title`, or else a leading `# Heading`. When a leading `# Heading` supplies the
title (or repeats it) it is removed from the body, because the site prints the title itself.

## Front matter

A block of YAML between `---` lines at the very top of the file. Every key is optional.

| Key | Type | Meaning |
| --- | --- | --- |
| `title` | string, 1–200 characters | Page title. Default: the leading `# H1`, else the file name. |
| `description` | string, up to 500 | Subtitle and `<meta description>`. |
| `icon` | string | An icon name from the editor's set. |
| `slug` | lowercase letters, numbers, hyphens | The URL segment. Default: the file name. Reserved words are refused. |
| `order` | number | Sort key among siblings. Default: alphabetical. |
| `draft` | boolean | Do not publish. Default `false`. |
| `hidden` | boolean | Published, but left out of the sidebar. Default `false`. |
| `redirect_from` | string or list of strings | Old paths that should redirect to this page. |
| `id` | string | An identity that survives renames and moves. |
| `nav_title` | string | Sidebar label when it should differ from the title. |

A key with the wrong type is ignored with `GS-103`; the other keys still apply. An unknown key is kept and
ignored (`GS-102`, informational). Invalid YAML is `GS-101` with the line number, and the page is still read
without its front matter. YAML aliases are limited so a small file cannot expand into a huge one.

A file that merely *begins with* a divider (`---`) and has no closing fence is not front matter.

## Text

| You write | You get |
| --- | --- |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` | the same styles |
| `<u>underline</u>` | underline (Markdown has none) |
| `[text](url)`, `[text][ref]` with `[ref]: url` | a link |
| `https://example.com`, `a@b.co` | autolinks, as on GitHub |
| a backslash or `<br>` at the end of a line | a line break |
| a plain line break | a space (as in HTML) |
| `![alt](src)` inside a sentence | its alt text (an image alone in a paragraph is a block) |

Headings `#` to `######` are all kept.

Links may only be `https:`, `http:`, `mailto:`, `tel:`, relative, or an anchor. Anything else
(`javascript:`, `data:` and so on) is reduced to its text with `GS-132`.

## Lists and quotes

`-`, `1.` and `- [ ]` / `- [x]` lists, nested by indentation. A numbered list that starts at another number
keeps its start. Paragraphs, code and sub-lists indented under an item belong to that item.

`>` is a quote.

## Callouts

GitHub's alerts:

```md
> [!WARNING] Before you start
> Back up your data.
>
> - Export the database
```

| Marker | GitCrook style |
| --- | --- |
| `[!NOTE]` | info |
| `[!TIP]` | success |
| `[!WARNING]` | warning |
| `[!CAUTION]` | danger |
| `[!IMPORTANT]` | info (`GS-206`: GitCrook has no separate style, so this one does not round-trip) |

A title may follow the marker on the same line. GitHub shows an untitled alert natively; a titled one shows the
title as the first line of the text. Anything after the first paragraph (more paragraphs, lists, code) is the
callout's body.

## Code and math

````md
```bash title="install.sh"
pnpm install
```
````

The info string is the language, optionally followed by `title="…"`. Common aliases are normalised
(`ts` → `typescript`, `sh` → `bash`, `yml` → `yaml`, `py` → `python`). No language means plain text.
A fence is always longer than any run of backticks inside the code.

`$$` on its own lines is a display equation (KaTeX). A single `$` is **not** math, so prices are safe.

## Tables

GFM pipe tables. The first row is the header; the delimiter row sets each column's alignment.
HTML `<table>` is read too (with `<thead>`, `colspan`/`rowspan` and `align`), but is only ever *written* as a
pipe table, which cannot hold merged cells or cell colours; those are reported as lossy.

## Images, media and files

```md
![Alt text](./images/dashboard.png "Caption")

::video{src="./media/demo.mp4" caption="A short demo" width="480"}

::audio{src="./media/theme.mp3"}

::file{src="./files/spec.pdf" name="Specification"}
```

A relative path is resolved against the file and imported as an asset when the page is synced.
`src` must be an `https:` URL, a relative path or a site-root path.

## Expandable sections

```md
<details>
<summary>Frequently asked</summary>

Anything can go here, **including Markdown**.

</details>
```

The blank lines around the body matter: they are what makes the content Markdown rather than HTML.
Sections nest.

## Directives

A directive starts with colons. Containers (`:::name … :::`) hold blocks; **a container needs more colons than
anything inside it**, so nesting adds colons (`::::` around `:::`). Leaf directives (`::name{…}`) stand alone
on a line. Attribute values are quoted: `{title="Install"}`.

### Columns

```md
::::columns
:::column{width=2}
The wide column.
:::

:::column
A narrow one.
:::
::::
```

Up to four columns; `width` is a relative weight (default 1).

### Cards

```md
:::cards{size="large"}
::card{title="Quickstart" description="Up and running" href="./quickstart.md" image="./cover.png"}
::card{title="Concepts" href="./concepts.md"}
:::
```

`size` is `medium` (default) or `large`. A card needs at least a title, link or image.

### Stepper

```md
::::stepper
:::step{title="Create a site"}
Open the dashboard and choose **New site**.
:::
:::step{title="Add a page"}
Pages live in the sidebar.
:::
::::
```

Steps are numbered in order. A step with no `title` takes it from a leading heading inside it (GitBook's
shape); `title=""` says there is no title.

### Updates (changelog)

```md
::::updates
:::update{title="Git Sync" date="2026-10-01" tags="new,api"}
Pages can now be kept in a repository.
:::
::::
```

The same title rule as steps applies. Updates feed the site's RSS.

### Buttons, embeds and page links

```md
:button[Get started]{href="./quickstart.md"}

:button[Source]{href="https://github.com/example/repo" style="secondary"}

::embed{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}

::page-link{href="./concepts.md" title="Concepts" description="How the pieces fit"}
```

`style` is `primary` (default) or `secondary`. An embed must come from a supported provider; any other URL
becomes a plain link with `GS-205`.

### Tabs

```md
::::tabs
:::tab{title="npm"}
npm install
:::
:::tab{title="pnpm"}
pnpm install
:::
::::
```

The editor has no tabs block yet, so each tab is shown as an expandable section (`GS-210`) and is written back
as one. Nothing in a tab is lost.

### Unknown directives

A directive GitCrook does not know is shown exactly as written, in a code block, with `GS-203`. An unknown
*inline* directive (`:kbd[Ctrl]`) stays in the text as written.

## HTML

Raw HTML in a repository is untrusted, so it is never passed through. A small set of tags is mapped to the
blocks they mean, and the rest is dropped:

- **Kept as blocks:** `<details>`/`<summary>`, `<img>`, `<figure>`, `<video>`, `<audio>`, `<h1>`–`<h6>`, `<hr>`,
  `<pre><code>`, `<blockquote>`, `<ul>`/`<ol>`, `<table>`, and GitBook's `<table data-view="cards">`.
- **Kept as text styles:** `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<s>`, `<del>`, `<code>`, `<kbd>`, `<br>`, `<a href>`.
- **Looked through:** `<div>`, `<span>`, `<p>`, `<center>`, `<section>` and similar wrappers.
- **Removed with their content:** `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`,
  `<svg>`, `<math>` and other active or embedding elements (`GS-204`).
- **Never kept:** every attribute except the few a kept tag needs (`href`, `src`, `alt`, `title`, `colspan`,
  `rowspan`, `align`). Event handlers and `style` never get through.

HTML comments are ignored.

## GitBook compatibility

Repositories exported from GitBook are read as they are. These tags are rewritten to the forms above before the
file is parsed, and GitCrook **never writes them**: the first time a page is saved from GitCrook it is written in
GCM.

| GitBook | Becomes |
| --- | --- |
| `{% hint style="info" %}` … `{% endhint %}` | a callout (`info`, `success`, `warning`, `danger`) |
| `{% tabs %}` / `{% tab title="…" %}` | tabs |
| `{% stepper %}` / `{% step %}` | a stepper |
| `{% columns %}` / `{% column %}`, `{% updates %}` / `{% update %}` | the same blocks |
| `{% code title="…" %}` around a fence | the fence's `title` |
| `{% file src="…" %}` | `::file` |
| `{% embed url="…" %}` | `::embed` |
| `{% content-ref url="…" %}` | `::page-link` |
| `{% include "path" %}` | the file's content, when includes are allowed and the file exists (`GS-131` otherwise) |

Tags inside code fences are left alone. A tag that is never closed is closed for you (`GS-204`); a closing
tag with no opener is removed (`GS-204`); a tag GitCrook does not know is removed (`GS-203`). Line numbers in
diagnostics still point at the original file.

## Limits

A page of more than 5,000 blocks, or nested more than 20 levels deep, is cut off at the limit with `GS-207`.
Both are configurable by the caller. Parsing never throws: bad input produces diagnostics, not exceptions.

## Block ids

Each block gets an id from where it is: the file, the block's position in the tree, and its type. Parsing the
same file always gives the same ids, so anchors and diffs do not churn when a page is synced again, and editing
the text of a block does not change its id. Moving or inserting a block does.

## Diagnostics

Every message has a stable code. Severities are `error` (the file or run failed), `warning` (something was
changed or skipped) and `info`.

| Code | Severity | Meaning |
| --- | --- | --- |
| `GS-101` | error | Front matter is not valid YAML |
| `GS-102` | info | Unknown front-matter key |
| `GS-103` | warning | Front-matter value has the wrong type |
| `GS-110` | warning | Two pages share a URL; a suffix was added |
| `GS-120` | warning | File is not listed in the explicit navigation |
| `GS-121` | error | Navigation refers to a file that does not exist |
| `GS-122` | warning | File appears more than once in the navigation |
| `GS-130` | warning | Link to a page that does not exist |
| `GS-131` | warning | Image, file or include that does not exist |
| `GS-132` | warning | Link with an unsafe or unsupported URL |
| `GS-140` | info | File type is not imported |
| `GS-150` | error | File is too large |
| `GS-160` | warning | Symlink, submodule or LFS pointer skipped |
| `GS-170` | error | Path leaves the repository |
| `GS-201` | info | Formatting the editor cannot represent was simplified |
| `GS-203` | warning | Unknown directive or tag; its content is shown as text, or removed if it has none |
| `GS-204` | info | HTML that is not allowed was removed, or a tag was unbalanced |
| `GS-205` | warning | Directive has missing or invalid attributes |
| `GS-206` | info | Construct is converted to the nearest equivalent |
| `GS-207` | warning | Document is too deeply nested or too large |
| `GS-210` | info | Tabs are shown as expandable sections |
| `GS-301` | warning | Rate limited, retrying |
| `GS-302` | error | Branch or repository is not reachable |
| `GS-303` | error | Authentication failed |

## What does not round-trip

Writing a page back must produce a file that reads as the same page. When it cannot, `serializeBlocks` says what
would be lost (`lossy`), and the caller must not overwrite the file. The things Markdown cannot hold:

- text and background colours, and text alignment;
- merged table cells, header columns, and cell colours;
- more than one table header row (it is written with one);
- bold, italic or links inside a step, update or tab **title** (titles are plain text attributes);
- blocks nested under a paragraph (they are flattened);
- `[!IMPORTANT]` callouts, which read as notes.

Everything else (every block type the editor offers, nested lists, callouts with lists and code inside, nested
containers) is covered by a property-based test that generates random documents, writes them, reads them back
and requires the same blocks.
