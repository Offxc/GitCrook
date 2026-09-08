/**
 * Curated font list for ThemeConfig.fonts (theme.ts) — GitBook's own "curated
 * list + custom upload" model. "Inter" and "JetBrains Mono" are the schema
 * defaults and are already loaded via next/font in apps/web/app/layout.tsx
 * (bound to --font-inter/--font-jetbrains-mono), so those two need no
 * external request; every other entry here is fetched on demand via
 * googleFontsStylesheetUrl() only when a site actually picks it.
 */
export const CURATED_BODY_FONTS = ["Inter", "Roboto", "Lora", "Merriweather", "Source Sans 3", "IBM Plex Sans", "Space Grotesk"] as const;
export const CURATED_MONO_FONTS = ["JetBrains Mono", "Fira Code", "IBM Plex Mono", "Source Code Pro"] as const;

/** Font names already loaded app-wide via next/font — map to that font's CSS variable instead of a bare (unloaded) family-name string. */
export const SYSTEM_LOADED_FONTS: Record<string, string> = {
  Inter: "var(--font-inter)",
  "JetBrains Mono": "var(--font-jetbrains-mono)",
};

export const GOOGLE_FONTS_CSS_HOST = "https://fonts.googleapis.com";
export const GOOGLE_FONTS_STATIC_HOST = "https://fonts.gstatic.com";

/** One combined Google Fonts stylesheet URL for whichever curated families a theme needs beyond the pre-loaded defaults; null when nothing extra is needed. */
export function googleFontsStylesheetUrl(families: (string | null | undefined)[]): string | null {
  const provided = families.filter((f): f is string => Boolean(f));
  const needed = [...new Set(provided.filter((f) => !SYSTEM_LOADED_FONTS[f]))];
  if (needed.length === 0) return null;
  const params = needed.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700`).join("&");
  return `${GOOGLE_FONTS_CSS_HOST}/css2?${params}&display=swap`;
}
