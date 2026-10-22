# Migrating from GitBook

> [!WARNING]
>
> Check your **links** after importing.

> [!TIP]
>
> Nested content works too:
>
> - one
> - two

<details>
<summary>npm</summary>

```bash
npm install
```

</details>

<details>
<summary>pnpm</summary>

```bash
pnpm install
```

</details>

```typescript title="config.ts"
export const mode = "git";
```

::::stepper
:::step{title="Connect the repository"}
Paste the URL.
:::

:::step{title="Choose a branch"}
Usually `main`.
:::
::::

::file{src="files/export.zip"}

::embed{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}

::page-link{href="concepts.md" title="Concepts"}

Text after the unknown tag.
