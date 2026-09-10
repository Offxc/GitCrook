import Link from "next/link";
import type { PageTreeNode } from "@/lib/tenancy/getPageTree";
import type { ThemeConfig } from "@voiddocs/shared";
import { PageIcon } from "./PageIcon";

/**
 * Read-only sidebar nav — zero client JS, used for every visitor who isn't
 * actively reordering (see SidebarBody for the editable swap-in).
 *
 * Metrics are taken from a real GitBook site rather than guessed: 14px/400
 * links, 12px/600 group headers, 12px gap between icon and label, and an
 * active state that's a 2px accent bar down the left with the row rounded
 * only on its right end.
 */
export function SidebarList({
  tree,
  paths,
  baseHref,
  activePageId,
  depth,
  listStyle,
}: {
  tree: PageTreeNode[];
  paths: Map<string, string[]>;
  baseHref: string;
  activePageId: string;
  depth: number;
  listStyle: ThemeConfig["sidebarStyle"]["listStyle"];
}) {
  const activeClass =
    listStyle === "pill"
      ? "bg-site-primary text-white font-semibold rounded-full"
      : listStyle === "line"
        ? "border-l-2 border-site-primary font-semibold text-site-primary rounded-r-2xl"
        : "bg-site-primary/10 font-semibold text-site-primary rounded-r-2xl";

  return (
    <ul className={depth > 0 ? "ml-3 border-l border-site-border pl-2" : undefined}>
      {tree.map((node) => {
        // A page group: title/icon only, not a link, not itself part of the
        // tree's indentation — GitBook's own page groups are a sidebar
        // header, not a real nesting level, so children render at the same
        // depth they'd be at without the group.
        if (node.isGroup) {
          return (
            <li key={node.id} className={depth === 0 ? "mt-6 border-t border-site-border pt-4 first:mt-1 first:border-t-0 first:pt-0" : undefined}>
              <p className="mb-1 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wider text-site-ink-muted">
                <PageIcon icon={node.icon} className="h-3.5 w-3.5 shrink-0" />
                {node.title}
              </p>
              {node.children.length > 0 ? (
                <SidebarList tree={node.children} paths={paths} baseHref={baseHref} activePageId={activePageId} depth={depth} listStyle={listStyle} />
              ) : null}
            </li>
          );
        }

        const isActive = node.id === activePageId;
        const path = paths.get(node.id) ?? [node.slug];
        const href = `${baseHref}/${path.join("/")}`;
        const linkClass = `flex min-w-0 flex-1 items-center gap-3 truncate py-1.5 pl-3 pr-2 text-sm leading-5 transition ${
          isActive ? activeClass : "rounded-r-2xl text-site-ink-muted hover:bg-site-surface hover:text-site-ink"
        }`;
        const label = (
          <Link href={href} className={linkClass}>
            <PageIcon icon={node.icon} className="h-4 w-4 shrink-0" />
            <span className="truncate">{node.title}</span>
          </Link>
        );

        if (node.children.length === 0) {
          return <li key={node.id}>{label}</li>;
        }

        return (
          <li key={node.id}>
            <details open={containsActive(node, activePageId)} className="group">
              <summary className="flex list-none items-center [&::-webkit-details-marker]:hidden">
                {label}
                <span className="ml-auto mr-1 shrink-0 rounded p-1 text-site-ink-muted transition group-open:rotate-90 hover:text-site-ink">
                  <ChevronIcon />
                </span>
              </summary>
              <SidebarList tree={node.children} paths={paths} baseHref={baseHref} activePageId={activePageId} depth={depth + 1} listStyle={listStyle} />
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function containsActive(node: PageTreeNode, activePageId: string): boolean {
  return node.id === activePageId || node.children.some((c) => containsActive(c, activePageId));
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}
