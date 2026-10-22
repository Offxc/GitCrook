/**
 * Share links arrive as `?token=…` on the first request. That URL is shared, pasted into chats and
 * sent in `Referer` headers, and the token only worked for the one page it was on: every other link,
 * image, search and feed request lost it.
 *
 * Instead the first request trades the token for a cookie and is redirected to the same URL without
 * it. The cookie carries the token on every later request to the site. The cookie is not trusted: a
 * token in it is checked against the database exactly like one in a URL, so a revoked or expired
 * link stops working immediately. It holds a short list, newest first, so a reader with links to
 * several sites keeps all of them.
 */

export const SHARE_COOKIE = "gc-share";
export const SHARE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_TOKENS = 5;
/** Share tokens are 128 random bits, url-safe base64: this rejects anything that could not be one. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

export function parseShareCookie(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").filter(isShareToken).slice(0, MAX_TOKENS);
}

/** The cookie value after adding `token`: it moves to the front, duplicates collapse, the oldest fall off. */
export function addShareToken(current: string | undefined, token: string): string {
  const rest = parseShareCookie(current).filter((t) => t !== token);
  return [token, ...rest].slice(0, MAX_TOKENS).join(",");
}
