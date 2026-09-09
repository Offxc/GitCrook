import Link from "next/link";
import { SearchTrigger } from "./SearchTrigger";
import { VariantSwitcher } from "./VariantSwitcher";
import type { VariantOption } from "@/lib/tenancy/resolvePublishedPath";
import type { ThemeConfig } from "@voiddocs/shared";

export function SiteHeader({
  siteName,
  baseHref,
  siteId,
  variant,
  variantOptions,
  variantPathPrefix,
  header,
  primaryLinkHref,
  externalLinksNewTab,
  logoAssetId,
}: {
  siteName: string;
  baseHref: string;
  siteId: string;
  variant?: { id: string; name: string };
  variantOptions?: VariantOption[];
  variantPathPrefix?: string[];
  header: ThemeConfig["header"];
  primaryLinkHref: string | null;
  externalLinksNewTab: boolean;
  logoAssetId: string | null;
}) {
  if (header.hidden) return null;

  return (
    <header data-placement="header" className="flex h-14 items-center justify-between gap-4 border-b border-site-border px-5">
      <div className="flex min-w-0 items-center gap-6">
        <Link href={primaryLinkHref ?? baseHref} className="flex shrink-0 items-center gap-2 text-sm font-semibold text-site-ink">
          {logoAssetId ? (
            // eslint-disable-next-line @next/next/no-img-element -- site-owner-configured logo, arbitrary dimensions
            <img src={`/api/files/${logoAssetId}`} alt="" className="h-6 w-6 rounded object-contain" />
          ) : null}
          {siteName}
        </Link>
        {header.links.length > 0 ? (
          <nav className="hidden items-center gap-1 sm:flex">
            {header.links.map((link, i) => (
              <HeaderLink key={i} link={link} externalLinksNewTab={externalLinksNewTab} />
            ))}
          </nav>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {variant && variantOptions ? (
          <VariantSwitcher current={variant} options={variantOptions} baseHref={baseHref} pathPrefix={variantPathPrefix ?? []} />
        ) : null}
        {header.searchPosition !== "hidden" ? <SearchTrigger siteId={siteId} baseHref={baseHref} compact={header.searchPosition === "subtle"} /> : null}
      </div>
    </header>
  );
}

function HeaderLink({ link, externalLinksNewTab }: { link: ThemeConfig["header"]["links"][number]; externalLinksNewTab: boolean }) {
  const linkClass = `rounded-md px-2 py-1.5 text-sm transition ${
    link.style === "primary"
      ? "bg-site-primary text-white hover:opacity-90"
      : link.style === "secondary"
        ? "border border-site-border text-site-ink hover:bg-site-surface"
        : "text-site-ink-muted hover:text-site-ink"
  }`;

  if (!link.children?.length) {
    return (
      <a href={link.href} className={linkClass} target={externalLinksNewTab ? "_blank" : undefined} rel={externalLinksNewTab ? "noreferrer" : undefined}>
        {link.label}
      </a>
    );
  }

  return (
    <details className="group relative">
      <summary className={`cursor-pointer list-none ${linkClass} [&::-webkit-details-marker]:hidden`}>{link.label}</summary>
      <nav className="absolute left-0 z-10 mt-1 min-w-[10rem] rounded-md border border-site-border bg-site-canvas py-1 shadow-lg">
        {link.children.map((child, i) => (
          <a
            key={i}
            href={child.href}
            className="block px-3 py-1.5 text-sm text-site-ink transition hover:bg-site-surface"
            target={externalLinksNewTab ? "_blank" : undefined}
            rel={externalLinksNewTab ? "noreferrer" : undefined}
          >
            {child.label}
          </a>
        ))}
      </nav>
    </details>
  );
}
