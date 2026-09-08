import { z } from "zod";

/**
 * Every href in ThemeConfig renders as a real `<a href>` on the published
 * site (SiteHeader/Footer/AnnouncementBanner) — validating the scheme here,
 * at the save boundary, is what stops a `javascript:`/`data:` URI from ever
 * reaching a visitor's click, not any escaping on the render side (React
 * does not sanitize href values — only text content).
 */
function isSafeHref(value: string): boolean {
  if (value.startsWith("/") || value.startsWith("#")) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
const hrefSchema = (max: number) => z.string().min(1).max(max).refine(isSafeHref, "Enter a valid http(s)/mailto URL or a relative path");

const LinkSchema = z.object({
  label: z.string().min(1).max(60),
  href: hrefSchema(2048),
  style: z.enum(["default", "primary", "secondary"]).default("default"),
  children: z.array(z.object({ label: z.string().min(1).max(60), href: hrefSchema(2048) })).max(10).optional(),
});

export const ThemeConfigSchema = z.object({
  themeStyle: z.enum(["clean", "muted", "bold", "gradient"]).default("clean"),
  primaryColor: z
    .object({ light: z.string().default("#4f46e5"), dark: z.string().default("#818cf8") })
    .prefault({}),
  tintColor: z
    .object({ light: z.string().nullable().default(null), dark: z.string().nullable().default(null) })
    .prefault({}),
  semanticColors: z
    .object({
      info: z.string().optional(),
      success: z.string().optional(),
      warning: z.string().optional(),
      danger: z.string().optional(),
    })
    .prefault({}),
  codeTheme: z
    .object({
      mode: z.enum(["adaptive", "custom"]).default("adaptive"),
      light: z.string().default("github-light"),
      dark: z.string().default("github-dark"),
    })
    .prefault({}),
  darkMode: z
    .object({
      enabled: z.boolean().default(true),
      default: z.enum(["light", "dark", "system"]).default("system"),
    })
    .prefault({}),
  fonts: z
    .object({
      body: z.string().default("Inter"),
      heading: z.string().nullable().default(null),
      mono: z.string().default("JetBrains Mono"),
      customFontAssetId: z.string().nullable().default(null),
    })
    .prefault({}),
  iconStyle: z.enum(["regular", "bold", "duotone"]).default("regular"),
  cornerStyle: z.enum(["rounded", "straight"]).default("rounded"),
  depthStyle: z.enum(["subtle", "flat"]).default("subtle"),
  linkStyle: z.enum(["default", "accent"]).default("default"),
  sidebarStyle: z
    .object({
      background: z.enum(["default", "filled"]).default("default"),
      listStyle: z.enum(["default", "pill", "line"]).default("default"),
    })
    .prefault({}),
  header: z
    .object({
      searchPosition: z.enum(["prominent", "subtle", "hidden"]).default("prominent"),
      hidden: z.boolean().default(false),
      links: z.array(LinkSchema).max(10).default([]),
    })
    .prefault({}),
  announcement: z
    .object({
      enabled: z.boolean().default(false),
      style: z.enum(["info", "success", "warning", "danger"]).default("info"),
      message: z.string().max(280).default(""),
      ctaLabel: z.string().max(60).optional(),
      ctaHref: hrefSchema(2048).optional(),
    })
    .prefault({}),
  pagination: z.object({ enabled: z.boolean().default(true) }).prefault({}),
  footer: z
    .object({
      logoAssetId: z.string().nullable().default(null),
      copyrightText: z.string().max(280).nullable().default(null),
      columns: z
        .array(z.object({ title: z.string().max(60), links: z.array(z.object({ label: z.string().max(60), href: hrefSchema(2048) })).max(10) }))
        .max(6)
        .default([]),
    })
    .prefault({}),
  socials: z
    .object({
      x: hrefSchema(2048).optional(),
      github: hrefSchema(2048).optional(),
      linkedin: hrefSchema(2048).optional(),
      discord: hrefSchema(2048).optional(),
      bluesky: hrefSchema(2048).optional(),
    })
    .prefault({}),
  ogImage: z
    .object({ mode: z.enum(["auto", "custom"]).default("auto"), assetId: z.string().nullable().default(null) })
    .prefault({}),
  localizationOverrides: z.record(z.string(), z.string()).prefault({}),
  primaryLinkHref: hrefSchema(2048).nullable().default(null),
  externalLinksNewTab: z.boolean().default(true),
  privacyPolicyHref: hrefSchema(2048).nullable().default(null),
  pageActions: z
    .object({
      copyAsMarkdown: z.boolean().default(true),
      viewAsMarkdown: z.boolean().default(true),
    })
    .prefault({}),
  showToolbarForMembers: z.boolean().default(true),
  showPoweredByBadge: z.boolean().default(true),
});

export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;

export function defaultTheme(): ThemeConfig {
  return ThemeConfigSchema.parse({});
}
