import { codeToHtml } from "shiki";

export interface CodeThemePair {
  light: string;
  dark: string;
}

/**
 * `themes` (plural) + `defaultColor: false` makes Shiki emit BOTH palettes as
 * --shiki-light/--shiki-dark CSS variables on every token, with no baked-in
 * default color — globals.css's .shiki rules pick between them using our own
 * [data-site-mode] convention (same pattern as every other --site-* token),
 * not Shiki's own light/dark CSS, which has no idea that attribute exists.
 */
export async function highlightCode(code: string, language: string, theme: CodeThemePair): Promise<string> {
  const themes = { light: theme.light, dark: theme.dark };
  try {
    return await codeToHtml(code, { lang: language || "text", themes, defaultColor: false });
  } catch {
    // Unrecognized language id (e.g. a stale value from before a schema
    // change) — still render highlighted-but-plain rather than fail the page.
    try {
      return await codeToHtml(code, { lang: "text", themes, defaultColor: false });
    } catch {
      return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
