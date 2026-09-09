import Link from "next/link";
import type { PageTreeNode } from "@/lib/tenancy/getPageTree";
import type { ThemeConfig } from "@voiddocs/shared";

export function Sidebar({
  tree,
  paths,
  baseHref,
  activePageId,
  siteName,
  sidebarStyle,
  showPoweredByBadge,
}: {
  tree: PageTreeNode[];
  paths: Map<string, string[]>;
  baseHref: string;
  activePageId: string;
  siteName: string;
  sidebarStyle: ThemeConfig["sidebarStyle"];
  showPoweredByBadge: boolean;
}) {
  return (
    <nav
      data-placement="sidebar"
      // sticky + a viewport-relative height (not just flex-stretching to match
      // the main column) — otherwise on any page taller than the viewport,
      // this whole column stretches to match it, and the "Powered by" badge
      // at the bottom ends up wherever the *content* column happens to end,
      // not pinned to the visible bottom of the screen the way it needs to be.
      className={`sticky top-14 flex h-[calc(100vh-3.5rem)] w-64 shrink-0 flex-col border-r border-site-border ${sidebarStyle.background === "filled" ? "bg-site-surface" : ""}`}
      aria-label="Table of contents"
    >
      <div className="flex-1 overflow-y-auto px-3 py-6">
        <p className="mb-4 px-2 text-sm font-semibold text-site-ink">{siteName}</p>
        <SidebarList tree={tree} paths={paths} baseHref={baseHref} activePageId={activePageId} depth={0} listStyle={sidebarStyle.listStyle} />
      </div>
      {showPoweredByBadge ? (
        <div className="shrink-0 border-t border-site-border p-3">
          <span className="block rounded-lg px-2 py-1.5 text-center text-xs text-site-ink-muted">Powered by VoidDocs</span>
        </div>
      ) : null}
    </nav>
  );
}

function containsActive(node: PageTreeNode, activePageId: string): boolean {
  return node.id === activePageId || node.children.some((c) => containsActive(c, activePageId));
}

function SidebarList({
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
      ? "bg-site-primary text-white font-medium"
      : listStyle === "line"
        ? "border-l-2 border-site-primary font-medium text-site-primary"
        : "bg-site-primary/10 font-medium text-site-primary";

  return (
    <ul className={depth > 0 ? "ml-3 border-l border-site-border pl-3" : undefined}>
      {tree.map((node) => {
        const isActive = node.id === activePageId;
        const path = paths.get(node.id) ?? [node.slug];
        const href = `${baseHref}/${path.join("/")}`;
        const linkClass = `flex min-w-0 flex-1 items-center gap-1.5 truncate px-2 py-1.5 text-[13px] leading-5 transition ${listStyle === "pill" ? "rounded-full" : "rounded-md"} ${
          isActive ? activeClass : "text-site-ink-muted hover:bg-site-surface hover:text-site-ink"
        }`;
        const label = (
          <Link href={href} className={linkClass}>
            {node.icon ? <span aria-hidden>{node.icon}</span> : null}
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
                <span className="mr-1 shrink-0 text-site-ink-muted transition group-open:rotate-90">
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

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}
