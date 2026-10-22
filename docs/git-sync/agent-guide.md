# Writing documentation for GitCrook: a guide for coding agents

Paste the section below into the instruction file your agent reads (`AGENTS.md` or an equivalent) in a repository whose
`docs/` folder is published with GitCrook Git Sync. It is written to be copied as it stands; the full format is in
[FORMAT.md](FORMAT.md).

---

## Documentation

The `docs/` folder is published as a website by GitCrook. Every push to the default branch republishes it. Edit the
Markdown here; never edit the website.

**When you change behaviour, change the page that describes it, in the same commit.** Look for the page by searching
`docs/` for the name of the command, option, setting or endpoint you changed.

### Layout

- One page per `.md` file. `README.md` or `index.md` in a folder is that folder's own page.
- A page's address comes from its path: `docs/guides/install.md` is `/guides/install`. Do not rename or move a file
  unless you mean to change its address; if you must, the site redirects the old address by itself, and any
  `redirect_from` entry you add redirects an older one too.
- Images go next to the page that uses them or in `docs/images/`, referenced by a relative path:
  `![The dashboard](./images/dashboard.png)`.

### Front matter (all optional)

```md
---
title: Install            # default: the first "# Heading", else the file name
description: One sentence. # shown under the title and in search results
order: 2                  # position among siblings; default: alphabetical
icon: download
draft: false              # true = not published yet
hidden: false             # true = published, but not in the sidebar
redirect_from: [/old/path]
---
```

Do not put the title in a `# Heading` as well when it is in the front matter. A page needs only one of them.

### Markdown

Ordinary Markdown works, including tables, task lists and fenced code with a language. For anything else use these;
each reads fine on GitHub too.

````md
> [!NOTE]
> Also `[!TIP]`, `[!WARNING]` and `[!CAUTION]`. A title may follow the marker on the first line. Use sparingly.

<details>
<summary>Click to expand</summary>

Hidden until opened.

</details>

::::columns
:::column
Left
:::

:::column
Right
:::
::::

::::stepper
:::step{title="Install"}
Run `npm install`.
:::
:::step{title="Configure"}
Create `config.yaml`.
:::
::::
````

A container needs more colons than anything inside it (`::::` around `:::`). Attribute values are quoted.

Links between pages are relative file links: `[Configure](./configure.md)` or `[Install](../guides/install.md#linux)`.
Never link to the published URL of another page of the same site.

### Do not

- Do not rely on raw HTML. A few tags are understood (`<details>`, `<img>`, `<kbd>`, tables, `<br>`), the rest is
  dropped, and scripts, iframes, styles and event handlers are always removed. Use Markdown.
- Do not use GitBook tags (`{% hint %}`, `{% tabs %}`); they are read for old content but new content should use the
  forms above.
- Do not add a page without making it reachable: with a `gitcrook.yaml` `nav:` or a `SUMMARY.md`, a file that is not
  listed is not published.

### Check your work

```sh
node tools/gitcrook-docs.mjs check            # exits 1 on errors; add --strict to fail on warnings too
node tools/gitcrook-docs.mjs tree             # the pages and addresses the site will have
```

It reads the folder exactly as the server will, so a clean check means a clean sync. Messages are
`file:line  GS-code  explanation`; the codes are listed in `docs/git-sync/README.md#troubleshooting`. Fix every
warning that is about something you changed: a link to a page that does not exist (`GS-130`) or an image that is not
in the repository (`GS-131`) is almost always a typo or a file that was not added.

### Reading the published docs

Add `.md` to the address of any page to get it as Markdown, or fetch `/llms.txt` for a list of every page.
