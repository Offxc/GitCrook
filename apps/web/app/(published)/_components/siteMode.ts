/**
 * The reader's light/dark/system choice. It lives in a cookie rather than
 * localStorage so the server can render `data-site-mode` straight into the
 * page: the choice then survives every navigation and reload with no flash and
 * no script, because the attribute is part of the HTML that arrives. (The shell
 * is rebuilt on each navigation, so an attribute set only from the browser was
 * lost on the next click while the toggle still claimed the old choice.)
 */
export const SITE_MODE_COOKIE = "gc-site-mode";

export type SiteMode = "light" | "system" | "dark";

export function isSiteMode(value: unknown): value is SiteMode {
  return value === "light" || value === "system" || value === "dark";
}

/** The `data-site-mode` attribute value for a mode: "system" is expressed by having no attribute at all. */
export function siteModeAttribute(mode: SiteMode): "light" | "dark" | undefined {
  return mode === "system" ? undefined : mode;
}
