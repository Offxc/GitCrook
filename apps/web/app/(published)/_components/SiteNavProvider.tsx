"use client";

import { createContext, useContext, useMemo } from "react";
import { usePathname } from "next/navigation";
import { deriveLocation, pathsFor, segmentsFromPathname, type ShellSection, type SiteLocation } from "@/lib/tenancy/siteLocation";

interface SiteNav {
  siteId: string;
  /** "" on a custom domain, "/<slug>" on the platform's domain. */
  baseHref: string;
  sections: ShellSection[];
  location: SiteLocation;
  /** Slug path (with section/space/variant prefix) of every node in the active variant. */
  paths: Map<string, string[]>;
}

const SiteNavContext = createContext<SiteNav | null>(null);

/**
 * Lives in the site's layout, so it stays mounted while the reader moves around the site. It holds the
 * structure the layout loaded and works out the active section, variant and page from the URL in the
 * browser; the sidebar, section tabs, variant switcher and mobile menu all read it. Nothing here is
 * rebuilt on a click — that is what stops the sidebar jumping back to the top.
 */
export function SiteNavProvider({
  siteId,
  baseHref,
  sections,
  children,
}: {
  siteId: string;
  baseHref: string;
  sections: ShellSection[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const value = useMemo<SiteNav | null>(() => {
    const location = deriveLocation(sections, segmentsFromPathname(pathname, baseHref));
    if (!location) return null;
    return { siteId, baseHref, sections, location, paths: pathsFor(location) };
  }, [siteId, baseHref, sections, pathname]);

  return <SiteNavContext.Provider value={value}>{children}</SiteNavContext.Provider>;
}

/** The shell's navigation state, or null for a site with nothing in it yet (no section, space or variant). */
export function useSiteNav(): SiteNav | null {
  return useContext(SiteNavContext);
}
