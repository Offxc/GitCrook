"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadSettingsPanel, type SettingsPanelData, type SettingsPanelKey } from "./settingsPanelActions";
import { ThemeForm } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/theme/ThemeForm";
import { SectionsManager } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/sections/SectionsManager";
import { AudienceForm } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/access/AudienceForm";
import { PasswordForm } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/access/PasswordForm";
import { ShareLinksSection } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/access/ShareLinksSection";
import { AddDomainForm } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/domain/AddDomainForm";
import { CreateVariantForm } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/variants/CreateVariantForm";

const PANELS: { key: SettingsPanelKey; label: string; hint: string }[] = [
  { key: "theme", label: "Theme", hint: "Colours, fonts, layout" },
  { key: "sections", label: "Sections", hint: "Top-level tabs" },
  { key: "access", label: "Visitor access", hint: "Who can read it" },
  { key: "domain", label: "Custom domain", hint: "Your own hostname" },
  { key: "variants", label: "Variants", hint: "Parallel versions" },
];

/**
 * Site settings as an overlay on the site itself, rather than a trip to the
 * dashboard and back. Each panel's data is fetched when you open it (see
 * settingsPanelActions) and handed to the same form components the dashboard
 * settings routes use — those routes still exist and still work, this is a
 * second door onto them, not a fork.
 *
 * Analytics deliberately isn't here: it's a reporting screen, not a setting,
 * and it wants the full width of a page.
 */
export function SiteSettingsModal({
  orgSlug,
  siteId,
  siteName,
  open,
  onClose,
}: {
  orgSlug: string;
  siteId: string;
  siteName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<SettingsPanelKey>("theme");
  const [data, setData] = useState<SettingsPanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const load = useCallback(
    async (key: SettingsPanelKey) => {
      setLoading(true);
      setError(null);
      setData(null);
      const result = await loadSettingsPanel(orgSlug, siteId, key);
      if (result.error) setError(result.error);
      else setData(result.data ?? null);
      setLoading(false);
    },
    [orgSlug, siteId],
  );

  useEffect(() => {
    if (open) void load(panel);
  }, [open, panel, load]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function close() {
    // Theme/section changes alter what's on screen behind the modal, so pull
    // the fresh server render on the way out.
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${siteName} settings`}
        className="flex h-full max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-canvas text-ink shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border p-3 sm:flex">
          <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">Site settings</p>
          <nav className="flex flex-col gap-0.5">
            {PANELS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setPanel(item.key)}
                aria-current={item.key === panel ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-left text-sm transition ${
                  item.key === panel ? "bg-surface font-medium text-ink" : "text-ink-muted hover:bg-surface/60 hover:text-ink"
                }`}
              >
                <span className="block">{item.label}</span>
                <span className="block text-xs text-ink-muted">{item.hint}</span>
              </button>
            ))}
          </nav>
          <Link
            href={`/dashboard/${orgSlug}/sites/${siteId}/analytics`}
            className="mt-auto rounded-lg px-3 py-2 text-sm text-ink-muted transition hover:bg-surface/60 hover:text-ink"
          >
            Analytics ↗
          </Link>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{siteName}</p>
              <p className="text-xs text-ink-muted sm:hidden">{PANELS.find((p) => p.key === panel)?.label}</p>
            </div>
            {/* The rail is hidden on small screens, so panels need a picker there. */}
            <select
              value={panel}
              onChange={(e) => setPanel(e.target.value as SettingsPanelKey)}
              className="rounded-lg border border-border bg-canvas px-2 py-1.5 text-sm text-ink sm:hidden"
            >
              {PANELS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={close} aria-label="Close settings" className="shrink-0 rounded-lg px-2 py-1 text-sm text-ink-muted transition hover:text-ink">
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {loading ? <p className="text-sm text-ink-muted">Loading…</p> : null}
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {data ? <PanelBody orgSlug={orgSlug} siteId={siteId} data={data} onChanged={() => void load(panel)} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelBody({ orgSlug, siteId, data, onChanged }: { orgSlug: string; siteId: string; data: SettingsPanelData; onChanged: () => void }) {
  switch (data.panel) {
    case "theme":
      return <ThemeForm orgSlug={orgSlug} siteId={siteId} organizationId={data.organizationId} initialTheme={data.theme} />;
    case "sections":
      return <SectionsManager orgSlug={orgSlug} siteId={siteId} sections={data.sections} />;
    case "access":
      return (
        <div className="space-y-6">
          <Section title="Password">
            <PasswordForm orgSlug={orgSlug} siteId={siteId} />
          </Section>
          <Section title="Audience">
            <AudienceForm orgSlug={orgSlug} siteId={siteId} currentMode={data.audienceMode} hasPassword={data.hasPassword} />
          </Section>
          <Section title="Share links">
            <ShareLinksSection orgSlug={orgSlug} siteId={siteId} links={data.shareLinks} publishedBase={data.publishedBase} />
          </Section>
        </div>
      );
    case "domain":
      return (
        <Section title="Custom domain">
          {data.domain ? (
            <div className="space-y-2 text-sm">
              <p className="text-ink">{data.domain.hostname}</p>
              <p className="text-xs text-ink-muted">Status: {data.domain.status.replace("_", " ").toLowerCase()}</p>
              <Link href={`/dashboard/${orgSlug}/sites/${siteId}/domain`} className="inline-block text-xs text-brand hover:underline">
                Manage verification ↗
              </Link>
            </div>
          ) : (
            <AddDomainForm orgSlug={orgSlug} siteId={siteId} />
          )}
        </Section>
      );
    case "variants":
      return (
        <div className="space-y-6">
          <Section title="Variants">
            <ul className="space-y-2 text-sm">
              {data.variants.map((variant) => (
                <li key={variant.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <span className="text-ink">
                    {variant.name}
                    {variant.isDefault ? <span className="ml-2 text-xs text-ink-muted">default</span> : null}
                  </span>
                  <span className="font-mono text-xs text-ink-muted">~v/{variant.slug}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="New variant">
            <CreateVariantForm orgSlug={orgSlug} siteId={siteId} />
          </Section>
        </div>
      );
    default: {
      // Exhaustiveness: a new panel key has to be handled here.
      const _never: never = data;
      void _never;
      void onChanged;
      return null;
    }
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}
