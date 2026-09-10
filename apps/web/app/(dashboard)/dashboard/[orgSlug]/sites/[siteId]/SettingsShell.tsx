import Link from "next/link";

const SECTIONS = [
  { key: "theme", label: "Theme", hint: "Colours, fonts, layout" },
  { key: "sections", label: "Sections", hint: "Top-level tabs" },
  { key: "access", label: "Visitor access", hint: "Who can read it" },
  { key: "domain", label: "Custom domain", hint: "Your own hostname" },
  { key: "variants", label: "Variants", hint: "Parallel versions" },
  { key: "analytics", label: "Analytics", hint: "Traffic and feedback" },
] as const;

export type SettingsSectionKey = (typeof SECTIONS)[number]["key"];

/**
 * Settings navigation as a left rail rather than a row of tabs above a
 * narrow column — which is how GitBook lays its site settings out, and it
 * scales better than tabs as the number of sections grows (tabs were
 * already overflowing horizontally at five).
 *
 * `active` is passed in by each page instead of read from usePathname, so
 * this stays a Server Component and the settings nav ships no client JS.
 */
export function SettingsShell({
  orgSlug,
  siteId,
  siteName,
  active,
  title,
  description,
  wide = false,
  children,
}: {
  orgSlug: string;
  siteId: string;
  siteName: string;
  active: SettingsSectionKey;
  title: string;
  description?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const base = `/dashboard/${orgSlug}/sites/${siteId}`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 lg:flex-row lg:gap-10">
      <aside className="shrink-0 lg:w-60">
        <Link href={base} className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink">
          <span aria-hidden>←</span>
          <span className="truncate">{siteName}</span>
        </Link>
        <p className="mb-2 mt-6 hidden px-3 text-xs font-semibold uppercase tracking-wider text-ink-muted lg:block">Site settings</p>
        {/* Horizontal scroller below lg, vertical rail above it. */}
        <nav className="-mx-1 mt-4 flex gap-1 overflow-x-auto px-1 lg:mt-0 lg:flex-col lg:overflow-visible">
          {SECTIONS.map((section) => {
            const isActive = section.key === active;
            return (
              <Link
                key={section.key}
                href={`${base}/${section.key}`}
                aria-current={isActive ? "page" : undefined}
                className={`shrink-0 rounded-lg px-3 py-2 text-sm transition lg:shrink ${
                  isActive ? "bg-surface font-medium text-ink" : "text-ink-muted hover:bg-surface/60 hover:text-ink"
                }`}
              >
                <span className="block whitespace-nowrap lg:whitespace-normal">{section.label}</span>
                <span className="hidden text-xs text-ink-muted lg:block">{section.hint}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className={`min-w-0 flex-1 ${wide ? "" : "max-w-3xl"}`}>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1.5 text-sm leading-6 text-ink-muted">{description}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
