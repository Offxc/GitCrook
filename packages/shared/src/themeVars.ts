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

  const body = safeFontFamily(theme.fonts.body);
  const heading = safeFontFamily(theme.fonts.heading);
  const mono = safeFontFamily(theme.fonts.mono);
  if (body) shared["--site-font-body"] = fontStack(body, "sans");
  if (heading) shared["--site-font-heading"] = fontStack(heading, "sans");
  if (mono) shared["--site-font-mono"] = fontStack(mono, "mono");

  const semantic = theme.semanticColors;
  const set = (target: Record<string, string>, name: string, color: string | null | undefined) => {
    const safe = safeCssColor(color);
    if (safe) target[name] = safe;
  };
  set(shared, "--site-info", semantic.info);
  set(shared, "--site-success", semantic.success);
  set(shared, "--site-warning", semantic.warning);
  set(shared, "--site-danger", semantic.danger);

  const light: Record<string, string> = { ...shared };
  const dark: Record<string, string> = { ...shared };
  set(light, "--site-primary", theme.primaryColor.light);
  set(dark, "--site-primary", theme.primaryColor.dark);
  set(light, "--site-tint", theme.tintColor.light);
  set(dark, "--site-tint", theme.tintColor.dark);

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

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** `rgb(...)`, `hsl(...)`, `oklch(...)` and friends: a function name and numbers, units, separators — nothing that can reference a resource. */
const COLOR_FUNCTION = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(\s*[0-9a-z.%+\-/,\s]{1,80}\)$/i;
/** `red`, `rebeccapurple`, `transparent`, `currentcolor`. */
const COLOR_KEYWORD = /^[a-z]{3,24}$/i;

/**
 * A colour a theme may set, or null. Themes are free text written by an administrator and pasted into a `<style>`
 * element, so only the forms of colour that cannot do anything else are let through: a value that is not one of them
 * (`url(...)`, `var(...)`, an escape, a comment) is dropped and the default colour shows instead.
 */
export function safeCssColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return HEX.test(v) || COLOR_FUNCTION.test(v) || COLOR_KEYWORD.test(v) ? v : null;
}

/** A font family name that is safe to put between quotes in `font-family` and in a Google Fonts URL, or null. */
export function safeFontFamily(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9 _.+-]{0,63}$/.test(v) ? v : null;
}
