import Link from "next/link";

export interface AdjacentPage {
  title: string;
  path: string[];
}

export function PageNav({ baseHref, prev, next }: { baseHref: string; prev: AdjacentPage | null; next: AdjacentPage | null }) {
  if (!prev && !next) return null;
  return (
    <nav className="mt-10 flex items-center justify-between border-t border-site-border pt-6">
      {prev ? (
        <Link href={`${baseHref}/${prev.path.join("/")}`} className="group flex flex-col text-sm">
          <span className="text-xs text-site-ink-muted">Previous</span>
          <span className="text-site-ink group-hover:text-site-primary">← {prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={`${baseHref}/${next.path.join("/")}`} className="group flex flex-col text-right text-sm">
          <span className="text-xs text-site-ink-muted">Next</span>
          <span className="text-site-ink group-hover:text-site-primary">{next.title} →</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
