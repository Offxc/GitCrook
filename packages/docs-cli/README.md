# gitcrook-docs

Checks a documentation repository the way GitCrook's Git Sync will read it, so a mistake is found on your machine or in a
pull request instead of in a failed sync. It uses the same parser, navigation rules, link checks and messages as the
server, and a test fails if the two ever disagree about the same repository.

```sh
gitcrook-docs check [path]     # report problems; exit 1 on errors
gitcrook-docs tree  [path]     # the pages the site would have, with their addresses
```

| Option | |
| --- | --- |
| `--dir <folder>` | The docs folder, as set on the Git Sync page. Without it, `gitcrook.yaml` / `.gitbook.yaml` decide. |
| `--strict` | Warnings fail the check too. |
| `--verbose` | Show informational notes as well. |
| `--format text\|json\|github` | Plain text (default), JSON, or GitHub Actions annotations that appear on the pull request. |

What is checked is what Git would commit: tracked files plus new ones that are not ignored. Outside a Git work tree,
every file except `.git` and `node_modules`.

Messages carry the same `GS-…` codes as the Git Sync page; [docs/git-sync/README.md](../../docs/git-sync/README.md#troubleshooting)
says what each means.

## Getting it

It is a single file with no dependencies, for Node 20 or newer. From a checkout of GitCrook:

```sh
pnpm install
pnpm --filter @gitcrook/docs-cli build      # → packages/docs-cli/dist/gitcrook-docs.mjs
```

Copy that file into the documentation repository (for example `tools/gitcrook-docs.mjs`) and run it with `node`. Nothing
here is published to a package registry yet; when it is, `npx gitcrook-docs check` will do the same.

### In CI

```yaml
# .github/workflows/docs.yml
name: Docs
on:
  pull_request:
    paths: ["docs/**", "gitcrook.yaml", "tools/gitcrook-docs.mjs"]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - run: node tools/gitcrook-docs.mjs check --dir docs --format github --strict
```

Findings then show up as annotations on the files in the pull request.

## Editor support

JSON Schemas for page front matter and `gitcrook.yaml` are in [docs/git-sync/schemas](../../docs/git-sync/schemas). With
the YAML extension for VS Code, for example, `gitcrook.yaml` gets completion and validation from:

```json
{ "yaml.schemas": { "https://raw.githubusercontent.com/Offxc/GitCrook/main/docs/git-sync/schemas/gitcrook.schema.json": "gitcrook.yaml" } }
```

## Development

`pnpm --filter @gitcrook/docs-cli check -- <path>` runs it from source. The analysis itself lives in
`packages/git-sync/src/analyze.ts`, which has no database or network dependency; this package is the folder reader, the
command line and the reporting.
