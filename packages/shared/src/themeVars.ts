import type { ThemeConfig } from "./theme";
import { SYSTEM_LOADED_FONTS } from "./fonts";

export interface SiteCssVars {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/**
 * Maps a Site's ThemeConfig to the --site-* custom properties consumed by
 * globals.css's [data-site-root] rules (renderPublishedSite.tsx injects the
 * result as a scoped inline <style> tag, overriding globals.css's static
 * defaults for that one site). Radius/depth/fonts don't vary by mode, so
 * they're duplicated into both buckets — keeps the consumer to two
 * self-contained declaration blocks instead of three.
 */
export function themeToCssVars(theme: ThemeConfig): SiteCssVars {
  const shared: Record<string, string> = {};

  // "rounded" is the current hardcoded look every component already ships —
  // omit the var entirely so nothing changes for the (default) common case;
  // only "straight" needs to actively flatten anything.
  if (theme.cornerStyle === "straight") shared["--site-radius"] = "0px";
  if (theme.depthStyle === "flat") shared["--site-shadow"] = "none";

  if (theme.fonts.body) shared["--site-font-body"] = fontStack(theme.fonts.body, "sans");
  if (theme.fonts.heading) shared["--site-font-heading"] = fontStack(theme.fonts.heading, "sans");
  if (theme.fonts.mono) shared["--site-font-mono"] = fontStack(theme.fonts.mono, "mono");

  const semantic = theme.semanticColors;
  if (semantic.info) shared["--site-info"] = semantic.info;
  if (semantic.success) shared["--site-success"] = semantic.success;
  if (semantic.warning) shared["--site-warning"] = semantic.warning;
  if (semantic.danger) shared["--site-danger"] = semantic.danger;

  const light: Record<string, string> = { ...shared, "--site-primary": theme.primaryColor.light };
  const dark: Record<string, string> = { ...shared, "--site-primary": theme.primaryColor.dark };

  if (theme.tintColor.light) light["--site-tint"] = theme.tintColor.light;
  if (theme.tintColor.dark) dark["--site-tint"] = theme.tintColor.dark;

  return { light, dark };
}

function fontStack(family: string, kind: "sans" | "mono"): string {
  const fallback = kind === "sans" ? "ui-sans-serif, system-ui, sans-serif" : "ui-monospace, SFMono-Regular, monospace";
  const primary = SYSTEM_LOADED_FONTS[family] ?? `"${family}"`;
  return `${primary}, ${fallback}`;
}

/** Serializes a var map to `--a:b;--c:d` for inlining into a CSS rule body. Strips characters that could break out of the declaration or the surrounding <style> tag — theme values are free-text user input. */
export function cssVarsToDeclarationBlock(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${sanitizeCssValue(value)}`)
    .join(";");
}

function sanitizeCssValue(value: string): string {
  return value.replace(/[;{}<>]/g, "").trim();
}
