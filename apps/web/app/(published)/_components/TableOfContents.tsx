import type { HeadingEntry } from "@/lib/renderer/extractHeadings";

/** No scroll-spy (which heading is "active") for now — a static outline is most of the value with none of the scroll-listener cost for a visitor who never opens it. */
export function TableOfContents({ headings }: { headings: HeadingEntry[] }) {
  if (headings.length === 0) return null;

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-site-ink-muted">On this page</p>
      <ul className="space-y-1.5 border-l border-site-border">
        {headings.map((h) => (
          <li key={h.id} style={{ paddingLeft: `${(h.level - 1) * 0.75 + 0.75}rem` }}>
            <a href={`#${h.id}`} className="block truncate border-l-2 border-transparent py-0.5 -ml-px text-site-ink-muted transition hover:text-site-ink">
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
