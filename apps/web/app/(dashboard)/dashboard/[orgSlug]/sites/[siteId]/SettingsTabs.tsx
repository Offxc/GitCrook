"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "theme", label: "Theme" },
  { key: "access", label: "Access" },
  { key: "domain", label: "Domain" },
  { key: "analytics", label: "Analytics" },
  { key: "variants", label: "Variants" },
];

/** Shared across the five settings sub-pages so switching between them doesn't require going back to the site overview each time. */
export function SettingsTabs({ orgSlug, siteId }: { orgSlug: string; siteId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/${orgSlug}/sites/${siteId}`;

  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((tab) => {
        const href = `${base}/${tab.key}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.key}
            href={href}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition ${
              active ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
