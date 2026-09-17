import type { ThemeConfig } from "@gitcrook/shared";

/** Site-wide banner, ThemeConfig.announcement — reuses the hint block's accent-color CSS (globals.css's .hint-* rules) so this and the Hint block always agree on what "info/success/warning/danger" look like. */
export function AnnouncementBanner({ announcement }: { announcement: ThemeConfig["announcement"] }) {
  if (!announcement.enabled || !announcement.message.trim()) return null;

  return (
    <div className={`hint-block hint-${announcement.style} flex items-center justify-center gap-3 border-b px-4 py-2 text-sm`}>
      <p className="hint-text">{announcement.message}</p>
      {announcement.ctaLabel && announcement.ctaHref ? (
        <a href={announcement.ctaHref} className="hint-text shrink-0 font-medium underline underline-offset-2">
          {announcement.ctaLabel}
        </a>
      ) : null}
    </div>
  );
}
