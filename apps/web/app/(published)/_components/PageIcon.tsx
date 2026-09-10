import { findPageIcon } from "@/lib/editor/pageIcons";

/**
 * Renders whatever's stored in Page.icon — a slug into the flat icon set
 * (see lib/editor/pageIcons.ts).
 *
 * Deliberately not a Client Component and deliberately not using Phosphor's
 * React components: this is plain SVG with no hooks, so it renders inside
 * Server Components (where a read-only visitor gets inline markup and zero
 * icon JavaScript) and inside the editor's Client Components alike. The
 * earlier version had to be "use client" because Phosphor's components read
 * React context internally, which throws when rendered from server code.
 *
 * A value that isn't a known slug renders as literal text rather than being
 * dropped, so an icon picked back when this stored a raw emoji still shows.
 */
export function PageIcon({ icon, className }: { icon: string | null; className?: string }) {
  if (!icon) return null;
  const entry = findPageIcon(icon);
  if (!entry) {
    return (
      <span aria-hidden className={className}>
        {icon}
      </span>
    );
  }

  return (
    <svg viewBox="0 0 256 256" fill="currentColor" className={className} aria-hidden>
      {entry.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
