/**
 * An icon from SVG path data the server already resolved. Unlike PageIcon it has no way to look an
 * icon up by name, which is the point: a client component can render it without bundling the whole
 * icon table. A value that isn't a known icon (an emoji picked before icons were slugs) renders as text.
 */
export function NodeIcon({ icon, paths, className }: { icon: string | null; paths: string[] | null; className?: string }) {
  if (paths && paths.length > 0) {
    return (
      <svg viewBox="0 0 256 256" fill="currentColor" className={className} aria-hidden>
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    );
  }
  if (icon) {
    return (
      <span aria-hidden className={className}>
        {icon}
      </span>
    );
  }
  return null;
}
