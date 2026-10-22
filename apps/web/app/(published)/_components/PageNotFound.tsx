"use client";

import Link from "next/link";
import { useSiteNav } from "./SiteNavProvider";

/** A page that doesn't exist, shown inside the site's own shell (header, sidebar) rather than on a bare screen. */
export function PageNotFound() {
  const home = useSiteNav()?.baseHref || "/";
  return (
    <main className="min-w-0 flex-1 px-6 py-16 lg:px-10">
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-sm font-medium text-site-primary">404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-site-ink">This page doesn&apos;t exist</h1>
        <p className="mt-3 text-site-ink-muted">It may have been moved or removed. Try the search, or pick a page from the menu.</p>
        <Link href={home} className="mt-6 inline-block rounded-md bg-site-primary px-4 py-2 text-sm font-medium text-white no-underline">
          Back to the start
        </Link>
      </div>
    </main>
  );
}
