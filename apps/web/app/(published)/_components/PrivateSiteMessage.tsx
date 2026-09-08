/** Shown to an anonymous or insufficiently-privileged visitor of a PRIVATE site — deliberately bare (no sidebar/page tree/search), so nothing about the site's actual content structure leaks to someone who isn't allowed to see it. */
export function PrivateSiteMessage({ siteName }: { siteName: string }) {
  return (
    <div data-site-root className="flex min-h-screen flex-col items-center justify-center bg-site-canvas px-6 text-center">
      <h1 className="text-lg font-semibold text-site-ink">{siteName}</h1>
      <p className="mt-1 text-sm text-site-ink-muted">This site is private. Ask its owner for access.</p>
    </div>
  );
}
