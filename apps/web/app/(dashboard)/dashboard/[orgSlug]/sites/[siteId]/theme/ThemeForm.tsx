"use client";

import { useActionState, useState } from "react";
import { CURATED_BODY_FONTS, CURATED_MONO_FONTS, type ThemeConfig } from "@gitcrook/shared";
import { updateTheme, type ThemeActionState } from "./actions";

type Updater = (patch: (theme: ThemeConfig) => ThemeConfig) => void;

export function ThemeForm({
  orgSlug,
  siteId,
  organizationId,
  initialTheme,
}: {
  orgSlug: string;
  siteId: string;
  organizationId: string;
  initialTheme: ThemeConfig;
}) {
  const [theme, setTheme] = useState<ThemeConfig>(initialTheme);
  const [state, formAction, pending] = useActionState<ThemeActionState, FormData>(updateTheme.bind(null, orgSlug, siteId), {});
  const update: Updater = (patch) => setTheme((prev) => patch(prev));

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="themeJson" value={JSON.stringify(theme)} />

      <Section title="Branding">
        <div className="grid grid-cols-2 gap-4">
          <ImageField
            label="Logo (shown next to the site name)"
            value={theme.branding.logoAssetId}
            organizationId={organizationId}
            siteId={siteId}
            onChange={(assetId) => update((t) => ({ ...t, branding: { ...t.branding, logoAssetId: assetId } }))}
          />
          <ImageField
            label="Favicon (browser tab icon)"
            value={theme.branding.faviconAssetId}
            organizationId={organizationId}
            siteId={siteId}
            onChange={(assetId) => update((t) => ({ ...t, branding: { ...t.branding, faviconAssetId: assetId } }))}
          />
        </div>
      </Section>

      <Section title="Colors">
        <div className="grid grid-cols-2 gap-4">
          <ColorField
            label="Primary (light mode)"
            value={theme.primaryColor.light}
            onChange={(v) => update((t) => ({ ...t, primaryColor: { ...t.primaryColor, light: v ?? t.primaryColor.light } }))}
          />
          <ColorField
            label="Primary (dark mode)"
            value={theme.primaryColor.dark}
            onChange={(v) => update((t) => ({ ...t, primaryColor: { ...t.primaryColor, dark: v ?? t.primaryColor.dark } }))}
          />
          <ColorField
            label="Tint (light mode)"
            value={theme.tintColor.light}
            onChange={(v) => update((t) => ({ ...t, tintColor: { ...t.tintColor, light: v } }))}
            clearable
          />
          <ColorField
            label="Tint (dark mode)"
            value={theme.tintColor.dark}
            onChange={(v) => update((t) => ({ ...t, tintColor: { ...t.tintColor, dark: v } }))}
            clearable
          />
        </div>
        <p className="mt-1 text-xs text-ink-muted">Tint washes the background very subtly — leave blank for a plain canvas.</p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(["info", "success", "warning", "danger"] as const).map((key) => (
            <ColorField
              key={key}
              label={key[0]!.toUpperCase() + key.slice(1)}
              value={theme.semanticColors[key] ?? null}
              onChange={(v) => update((t) => ({ ...t, semanticColors: { ...t.semanticColors, [key]: v ?? undefined } }))}
              clearable
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-ink-muted">Hint-block accent colors — also used by the announcement banner.</p>
      </Section>

      <Section title="Typography">
        <div className="grid grid-cols-3 gap-4">
          <SelectField
            label="Body font"
            value={theme.fonts.body}
            options={CURATED_BODY_FONTS as unknown as string[]}
            onChange={(v) => update((t) => ({ ...t, fonts: { ...t.fonts, body: v } }))}
          />
          <SelectField
            label="Heading font"
            value={theme.fonts.heading ?? ""}
            options={["", ...CURATED_BODY_FONTS]}
            optionLabels={{ "": "Same as body" }}
            onChange={(v) => update((t) => ({ ...t, fonts: { ...t.fonts, heading: v || null } }))}
          />
          <SelectField
            label="Monospace font"
            value={theme.fonts.mono}
            options={CURATED_MONO_FONTS as unknown as string[]}
            onChange={(v) => update((t) => ({ ...t, fonts: { ...t.fonts, mono: v } }))}
          />
        </div>
      </Section>

      <Section title="Layout">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <SelectField
            label="Corners"
            value={theme.cornerStyle}
            options={["rounded", "straight"]}
            onChange={(v) => update((t) => ({ ...t, cornerStyle: v as ThemeConfig["cornerStyle"] }))}
          />
          <SelectField
            label="Depth"
            value={theme.depthStyle}
            options={["subtle", "flat"]}
            onChange={(v) => update((t) => ({ ...t, depthStyle: v as ThemeConfig["depthStyle"] }))}
          />
          <SelectField
            label="Links"
            value={theme.linkStyle}
            options={["default", "accent"]}
            onChange={(v) => update((t) => ({ ...t, linkStyle: v as ThemeConfig["linkStyle"] }))}
          />
          <SelectField
            label="Sidebar background"
            value={theme.sidebarStyle.background}
            options={["default", "filled"]}
            onChange={(v) => update((t) => ({ ...t, sidebarStyle: { ...t.sidebarStyle, background: v as ThemeConfig["sidebarStyle"]["background"] } }))}
          />
          <SelectField
            label="Sidebar list style"
            value={theme.sidebarStyle.listStyle}
            options={["default", "pill", "line"]}
            onChange={(v) => update((t) => ({ ...t, sidebarStyle: { ...t.sidebarStyle, listStyle: v as ThemeConfig["sidebarStyle"]["listStyle"] } }))}
          />
        </div>
      </Section>

      <Section title="Header & navigation">
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Search"
            value={theme.header.searchPosition}
            options={["prominent", "subtle", "hidden"]}
            onChange={(v) => update((t) => ({ ...t, header: { ...t.header, searchPosition: v as ThemeConfig["header"]["searchPosition"] } }))}
          />
          <ToggleField label="Hide header entirely" checked={theme.header.hidden} onChange={(v) => update((t) => ({ ...t, header: { ...t.header, hidden: v } }))} />
        </div>
        <div className="mt-4">
          <LinkListEditor
            label="Nav links"
            links={theme.header.links}
            onChange={(links) => update((t) => ({ ...t, header: { ...t.header, links } }))}
          />
        </div>
      </Section>

      <Section title="Announcement banner">
        <ToggleField label="Show banner" checked={theme.announcement.enabled} onChange={(v) => update((t) => ({ ...t, announcement: { ...t.announcement, enabled: v } }))} />
        {theme.announcement.enabled ? (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <SelectField
                label="Style"
                value={theme.announcement.style}
                options={["info", "success", "warning", "danger"]}
                onChange={(v) => update((t) => ({ ...t, announcement: { ...t.announcement, style: v as ThemeConfig["announcement"]["style"] } }))}
              />
              <TextField
                label="Message"
                value={theme.announcement.message}
                onChange={(v) => update((t) => ({ ...t, announcement: { ...t.announcement, message: v } }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="CTA label (optional)"
                value={theme.announcement.ctaLabel ?? ""}
                onChange={(v) => update((t) => ({ ...t, announcement: { ...t.announcement, ctaLabel: v || undefined } }))}
              />
              <TextField
                label="CTA link (optional)"
                value={theme.announcement.ctaHref ?? ""}
                onChange={(v) => update((t) => ({ ...t, announcement: { ...t.announcement, ctaHref: v || undefined } }))}
                urlLike
              />
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Footer">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <ToggleField label="Show pagination (Previous/Next links)" checked={theme.pagination.enabled} onChange={(v) => update((t) => ({ ...t, pagination: { enabled: v } }))} />
          <ToggleField label="Show page feedback (rating & comments)" checked={theme.pageFeedback.enabled} onChange={(v) => update((t) => ({ ...t, pageFeedback: { enabled: v } }))} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <TextField
            label="Copyright text (optional)"
            value={theme.footer.copyrightText ?? ""}
            onChange={(v) => update((t) => ({ ...t, footer: { ...t.footer, copyrightText: v || null } }))}
          />
          <TextField
            label="Privacy policy link (optional)"
            value={theme.privacyPolicyHref ?? ""}
            onChange={(v) => update((t) => ({ ...t, privacyPolicyHref: v || null }))}
            urlLike
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {(["x", "github", "linkedin", "discord", "bluesky"] as const).map((key) => (
            <TextField
              key={key}
              label={key[0]!.toUpperCase() + key.slice(1)}
              value={theme.socials[key] ?? ""}
              onChange={(v) => update((t) => ({ ...t, socials: { ...t.socials, [key]: v || undefined } }))}
              urlLike
            />
          ))}
        </div>
        <div className="mt-3">
          <ToggleField
            label='Show "Powered by GitCrook" badge'
            checked={theme.showPoweredByBadge}
            onChange={(v) => update((t) => ({ ...t, showPoweredByBadge: v }))}
          />
        </div>
      </Section>

      <Section title="Links & misc">
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Primary link override (optional)"
            value={theme.primaryLinkHref ?? ""}
            onChange={(v) => update((t) => ({ ...t, primaryLinkHref: v || null }))}
            urlLike
          />
          <ToggleField
            label="Open external links in a new tab"
            checked={theme.externalLinksNewTab}
            onChange={(v) => update((t) => ({ ...t, externalLinksNewTab: v }))}
          />
        </div>
        <p className="mt-1 text-xs text-ink-muted">Where the site name in the header links to — defaults to the site's own homepage.</p>
      </Section>

      <div className="flex items-center gap-3 border-t border-border pt-6">
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60">
          {pending ? "Saving..." : "Save theme"}
        </button>
        {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      <div className="rounded-xl border border-border bg-canvas p-5">{children}</div>
    </section>
  );
}

function ColorField({ label, value, onChange, clearable = false }: { label: string; value: string | null; onChange: (v: string | null) => void; clearable?: boolean }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-ink-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value ?? "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 cursor-pointer rounded border border-border bg-canvas p-0.5"
        />
        <input
          type="text"
          value={value ?? ""}
          placeholder={clearable ? "Not set" : undefined}
          onChange={(e) => onChange(e.target.value || (clearable ? null : value))}
          className="w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
        />
        {clearable && value ? (
          <button type="button" onClick={() => onChange(null)} className="shrink-0 text-xs text-ink-muted hover:text-danger">
            Clear
          </button>
        ) : null}
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  optionLabels,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  optionLabels?: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-ink-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-brand"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {optionLabels?.[opt] ?? opt}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Bare domains/handles ("github.com/org") are what people actually type — treat them as shorthand for https:// rather than rejecting them; anything already shaped like a URL, path, or anchor passes through untouched. Only runs on blur, never mid-keystroke. */
function normalizeUrlOnBlur(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function TextField({ label, value, onChange, urlLike = false }: { label: string; value: string; onChange: (v: string) => void; urlLike?: boolean }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-ink-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={urlLike ? (e) => onChange(normalizeUrlOnBlur(e.target.value)) : undefined}
        className="w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-brand"
      />
    </label>
  );
}

function ImageField({
  label,
  value,
  organizationId,
  siteId,
  onChange,
}: {
  label: string;
  value: string | null;
  organizationId: string;
  siteId: string;
  onChange: (assetId: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("organizationId", organizationId);
      form.append("siteId", siteId);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }
      const { assetId } = await res.json();
      onChange(assetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="text-sm">
      <span className="mb-1 block text-ink-muted">{label}</span>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary uploaded image, previewed at a fixed thumbnail size
          <img src={`/api/files/${value}`} alt="" className="h-10 w-10 rounded border border-border object-contain" />
        ) : (
          <div className="h-10 w-10 rounded border border-dashed border-border" />
        )}
        <label className="cursor-pointer rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink transition hover:border-brand">
          {uploading ? "Uploading..." : value ? "Replace" : "Upload"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) handleFile(file);
            }}
          />
        </label>
        {value ? (
          <button type="button" onClick={() => onChange(null)} className="text-xs text-ink-muted hover:text-danger">
            Remove
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-border" />
      {label}
    </label>
  );
}

function LinkListEditor({
  label,
  links,
  onChange,
}: {
  label: string;
  links: ThemeConfig["header"]["links"];
  onChange: (links: ThemeConfig["header"]["links"]) => void;
}) {
  return (
    <div>
      <span className="mb-2 block text-sm text-ink-muted">{label}</span>
      <div className="space-y-2">
        {links.map((link, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={link.label}
              onChange={(e) => onChange(links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))}
              placeholder="Label"
              className="w-32 rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
            />
            <input
              value={link.href}
              onChange={(e) => onChange(links.map((l, j) => (j === i ? { ...l, href: e.target.value } : l)))}
              onBlur={(e) => onChange(links.map((l, j) => (j === i ? { ...l, href: normalizeUrlOnBlur(e.target.value) } : l)))}
              placeholder="https://..."
              className="flex-1 rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
            />
            <select
              value={link.style}
              onChange={(e) => onChange(links.map((l, j) => (j === i ? { ...l, style: e.target.value as (typeof link)["style"] } : l)))}
              className="rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
            >
              <option value="default">Default</option>
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
            </select>
            <button type="button" onClick={() => onChange(links.filter((_, j) => j !== i))} className="shrink-0 text-xs text-ink-muted hover:text-danger">
              Remove
            </button>
          </div>
        ))}
      </div>
      {links.length < 10 ? (
        <button
          type="button"
          onClick={() => onChange([...links, { label: "New link", href: "/", style: "default" }])}
          className="mt-2 text-xs text-brand hover:underline"
        >
          + Add link
        </button>
      ) : null}
    </div>
  );
}
