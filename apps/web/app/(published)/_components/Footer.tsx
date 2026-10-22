import Link from "next/link";
import type { ThemeConfig } from "@gitcrook/shared";

const SOCIAL_LABELS: Record<string, string> = {
  x: "X (Twitter)",
  github: "GitHub",
  linkedin: "LinkedIn",
  discord: "Discord",
  bluesky: "Bluesky",
};

export function Footer({
  siteName,
  footer,
  socials,
  privacyPolicyHref,
}: {
  siteName: string;
  footer: ThemeConfig["footer"];
  socials: ThemeConfig["socials"];
  privacyPolicyHref: string | null;
}) {
  const socialEntries = Object.entries(socials).filter(([, href]) => Boolean(href)) as [string, string][];
  const hasContent = footer.logoAssetId || footer.copyrightText || footer.columns.length > 0 || socialEntries.length > 0;
  if (!hasContent) return null;

  return (
    <footer data-placement="footer" className="border-t border-site-border px-8 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        {footer.columns.length > 0 ? (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {footer.columns.map((col, i) => (
              <div key={i}>
                <p className="text-xs font-semibold text-site-ink">{col.title}</p>
                <ul className="mt-2 space-y-1.5">
                  {col.links.map((link, j) => (
                    <li key={j}>
                      <a href={link.href} className="text-xs text-site-ink-muted hover:text-site-ink">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-site-ink-muted">
          <div className="flex items-center gap-3">
            {footer.logoAssetId ? (
              // eslint-disable-next-line @next/next/no-img-element -- site-owner-configured logo, arbitrary dimensions
              <img src={`/api/files/${footer.logoAssetId}`} alt={siteName} className="h-5 w-auto" />
            ) : null}
            {footer.copyrightText ? <span>{footer.copyrightText}</span> : null}
            {privacyPolicyHref ? (
              <Link href={privacyPolicyHref} className="hover:text-site-ink">
                Privacy policy
              </Link>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {socialEntries.map(([key, href]) => (
              <a key={key} href={href} target="_blank" rel="noreferrer" className="hover:text-site-ink" aria-label={SOCIAL_LABELS[key] ?? key}>
                {SOCIAL_LABELS[key] ?? key}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
