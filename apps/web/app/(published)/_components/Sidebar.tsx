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
}: {
  tree: PageTreeNode[];
  paths: Map<string, string[]>;
  baseHref: string;
  activePageId: string;
  siteName: string;
  sidebarStyle: ThemeConfig["sidebarStyle"];
}) {
  return (
    <nav
      data-placement="sidebar"
      className={`w-64 shrink-0 overflow-y-auto border-r border-site-border px-3 py-6 ${sidebarStyle.background === "filled" ? "bg-site-surface" : ""}`}
      aria-label="Table of contents"
    >
      <p className="mb-4 px-2 text-sm font-semibold text-site-ink">{siteName}</p>
      <SidebarList tree={tree} paths={paths} baseHref={baseHref} activePageId={activePageId} depth={0} listStyle={sidebarStyle.listStyle} />
    </nav>
  );
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
        return (
          <li key={node.id}>
            <Link
              href={`${baseHref}/${path.join("/")}`}
              className={`block truncate px-2 py-1.5 text-[13px] leading-5 transition ${listStyle === "pill" ? "rounded-full" : "rounded-md"} ${
                isActive ? activeClass : "text-site-ink-muted hover:bg-site-surface hover:text-site-ink"
              }`}
            >
              {node.title}
            </Link>
            {node.children.length > 0 ? (
              <SidebarList tree={node.children} paths={paths} baseHref={baseHref} activePageId={activePageId} depth={depth + 1} listStyle={listStyle} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
