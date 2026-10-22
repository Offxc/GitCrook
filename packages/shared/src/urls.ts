/**
 * URLs that come out of documents (link targets, button and card hrefs, image and media sources) are
 * written by people and, with Git Sync, by whatever is in a repository. Only a few schemes are safe to
 * put in an `href` or `src`; `javascript:` and `data:` are the ones that matter.
 */

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * The URL if it is safe to navigate to, otherwise "". Relative URLs (`/x`, `./x`, `../x`, `x/y`, `?q`, `#h`)
 * are fine; absolute ones must use an allowed protocol. Leading whitespace and control characters
 * (which browsers strip, and attackers use to smuggle a scheme past a naive check) are rejected outright.
 */
export function safeHref(url: unknown): string {
  if (typeof url !== "string") return "";
  const value = url.trim();
  if (value === "") return "";
  // eslint-disable-next-line no-control-regex -- the point is to catch control characters
  if (/[\u0000-\u001f\u007f]/.test(value)) return "";
  if (value.startsWith("//")) return value; // protocol-relative: inherits the page's https
  // A scheme is letters/digits/+-. up to the first ":" - but only if that ":" comes before any "/", "?" or "#".
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!scheme) return value;
  return SAFE_PROTOCOLS.has(`${scheme[1]!.toLowerCase()}:`) ? value : "";
}

/** For media (`src`): like `safeHref`, but mail and phone links make no sense there. */
export function safeMediaUrl(url: unknown): string {
  const value = safeHref(url);
  if (/^(mailto|tel):/i.test(value)) return "";
  return value;
}
