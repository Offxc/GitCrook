/** Shown to an anonymous or insufficiently-privileged visitor of a PRIVATE site — deliberately bare (no sidebar/page tree/search), so nothing about the site's actual content structure leaks to someone who isn't allowed to see it. */
export function PrivateSiteMessage({ siteName }: { siteName: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-lg font-semibold text-site-ink">{siteName}</h1>
      <p className="mt-1 text-sm text-site-ink-muted">This site is private. Ask its owner for access.</p>
    </div>
  );
}
