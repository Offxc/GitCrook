import Link from "next/link";
import { PageIcon } from "./PageIcon";

/**
 * The row of section tabs GitBook puts directly under the header
 * ("Documentation | Developers | Resources" on their own docs). Renders
 * nothing for a single-section site, which is also exactly when
 * resolvePublishedPath stops consuming a section segment from the URL — so
 * the tabs appear precisely when section slugs become addressable.
 */
export function SectionTabs({
  sections,
  activeSectionId,
  baseHref,
}: {
  sections: { id: string; title: string; slug: string; icon: string | null }[];
  activeSectionId: string;
  baseHref: string;
}) {
  if (sections.length <= 1) return null;

  return (
    <nav aria-label="Sections" className="sticky top-16 z-20 border-b border-site-border bg-site-canvas/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1600px] gap-1 overflow-x-auto px-5">
        {sections.map((section) => {
          const isActive = section.id === activeSectionId;
          return (
            <Link
              key={section.id}
              href={`${baseHref}/${section.slug}`}
              aria-current={isActive ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition ${
                isActive ? "border-site-primary font-medium text-site-primary" : "border-transparent text-site-ink-muted hover:text-site-ink"
              }`}
            >
              <PageIcon icon={section.icon} className="h-4 w-4 shrink-0" />
              {section.title}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
