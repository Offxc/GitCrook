import Link from "next/link";
import type { VariantOption } from "@/lib/tenancy/resolvePublishedPath";

/**
 * GitBook's "version" dropdown. A plain <details>/<summary> — no client JS
 * needed for a list of links. Each option links to the same page-slug path
 * resolved against that variant (VariantOption.pagePath), falling back to
 * that variant's root page when no equivalent page exists there.
 */
export function VariantSwitcher({
  current,
  options,
  baseHref,
  pathPrefix,
}: {
  current: { id: string; name: string };
  options: VariantOption[];
  baseHref: string;
  pathPrefix: string[];
}) {
  if (options.length <= 1) return null;

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-site-border px-2.5 py-1 text-xs font-medium text-site-ink-muted transition hover:text-site-ink [&::-webkit-details-marker]:hidden">
        {current.name}
        <ChevronIcon />
      </summary>
      <nav className="absolute right-0 z-10 mt-1 min-w-[10rem] rounded-md border border-site-border bg-site-canvas py-1 shadow-lg">
        {options.map(({ variant, pagePath }) => {
          const segs = [...pathPrefix, "~v", variant.slug, ...(pagePath ?? [])];
          const isActive = variant.id === current.id;
          return (
            <Link
              key={variant.id}
              href={`${baseHref}/${segs.join("/")}`}
              className={`block px-3 py-1.5 text-sm transition hover:bg-site-surface ${isActive ? "font-semibold text-site-primary" : "text-site-ink"}`}
            >
              {variant.name}
            </Link>
          );
        })}
      </nav>
    </details>
  );
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden className="transition group-open:rotate-180">
      <path d="M3.5 6l4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
