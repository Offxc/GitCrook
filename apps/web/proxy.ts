import { NextResponse, type NextRequest } from "next/server";
import {
  EMBED_FRAME_SRC_HOSTS,
  GOOGLE_FONTS_CSS_HOST,
  GOOGLE_FONTS_STATIC_HOST,
  SHARE_COOKIE,
  SHARE_COOKIE_MAX_AGE_SECONDS,
  addShareToken,
  isReservedSlug,
  isShareToken,
} from "@gitcrook/shared";

/**
 * Runs on every request (Node.js runtime — this is Next.js 16's renamed
 * `middleware.ts`). Two jobs, kept deliberately minimal:
 *
 *  1. Security headers baseline (OWASP A05) on every response.
 *  2. Host-header inspection for multi-tenant routing.
 *
 * Non-root hosts are rewritten into `/(published)/site-by-domain/[hostname]/
 * ...`, which resolves them against verified CustomDomain rows.
 *
 * No DB access happens here on purpose: middleware/proxy runs on the hot path
 * for every request, and an unknown Host should be able to fall through to a
 * normal 404 render rather than pay for a lookup on every single request.
 */

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "localhost:3000";

export default function proxy(req: NextRequest) {
  const nonce = crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  // A share link arrives as ?token=… on a page URL. Trade it for a cookie and redirect to the clean URL:
  // the token then travels with every later request (links, images, search, feeds) instead of dying
  // after the first page, and it stops sitting in the address bar, history and Referer headers.
  const shareRedirect = exchangeShareToken(req, nonce);
  if (shareRedirect) return shareRedirect;

  const host = (req.headers.get("host") ?? "").toLowerCase();
  const isRootDomain = host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`;

  // /api/* is the platform's own API surface, not site content, and it has to answer on
  // every host: a published page links its images as /api/files/<id> and its search
  // box calls /api/sites/<id>/search, both relative to whatever host the reader is on,
  // and Caddy's certificate check (/api/internal/certs/ask) arrives with Host: web:3000.
  // Rewriting those into the custom-domain page route made them all 404 — so a verified
  // domain showed no images and no search, and could never be issued a certificate.
  const isApi = req.nextUrl.pathname.startsWith("/api/");

  if (!isRootDomain && !isApi) {
    // Any other Host is a candidate tenant custom domain — rewrite into the
    // dedicated route, which resolves it against verified CustomDomain rows
    // (an unrecognized hostname just 404s there; the Caddy `ask` endpoint is
    // the layer that decides whether such a hostname even gets a TLS cert).
    // NOTE: this segment must NOT start with `_` — Next.js treats a leading
    // underscore as a "private folder" that opts out of routing entirely, so
    // a route nested under one is silently unreachable (found via testing:
    // `_sites/...` 404'd and silently fell through to the [siteSlug] route).
    // Custom domains are stored as bare hostnames, so a port on the Host header (a dev or test setup on
    // a non-standard port) must not become part of the name being looked up.
    const hostname = host.replace(/:\d+$/, "");
    const url = req.nextUrl.clone();
    url.pathname = `/site-by-domain/${hostname}${req.nextUrl.pathname}`;
    const res = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    applySecurityHeaders(res, nonce);
    return res;
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(res, nonce);
  return res;
}

function exchangeShareToken(req: NextRequest, nonce: string): NextResponse | null {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || !isShareToken(token) || req.method !== "GET") return null;

  // Only published-site pages: not the platform's own routes, and not the marketing root.
  const pathname = req.nextUrl.pathname;
  const first = pathname.split("/")[1] ?? "";
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) return null; // it goes into a Location header
  const isRootDomain = host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`;
  if (pathname === "/" && isRootDomain) return null;
  if (isRootDomain && isReservedSlug(first)) return null;
  if (!isRootDomain && pathname.startsWith("/api/")) return null;

  const clean = new URLSearchParams(req.nextUrl.searchParams);
  clean.delete("token");
  const query = clean.toString();

  // The redirect has to carry an absolute URL (the proxy layer rejects a relative Location), built from
  // the host and scheme the visitor actually used. Behind a reverse proxy the request URL is the internal
  // one, so those come from the Host and X-Forwarded-Proto headers.
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(/:$/, "");
  const location = `${proto}://${host}${pathname}${query ? `?${query}` : ""}`;
  const res = new NextResponse(null, { status: 307, headers: { Location: location } });
  res.cookies.set(SHARE_COOKIE, addShareToken(req.cookies.get(SHARE_COOKIE)?.value, token), {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    maxAge: SHARE_COOKIE_MAX_AGE_SECONDS,
  });
  res.headers.set("Cache-Control", "private, no-store");
  applySecurityHeaders(res, nonce);
  return res;
}

function applySecurityHeaders(res: NextResponse, nonce: string) {
  // Wrong assumption originally, found via a real CSP violation in production:
  // "unsafe-eval" isn't just React dev-mode's error-overlay stack traces —
  // something in the editor's own dependency chain (BlockNote/Mantine/
  // ProseMirror) genuinely calls eval()/Function() at runtime, in production
  // too, and without this the editor silently fails to mount at all (the
  // page is left showing the server-rendered read-only content underneath,
  // with no visible error unless you check the console). strict-dynamic +
  // per-request nonces still block the far more common inline/injected-
  // script XSS vector; this narrows that, specifically for a script an
  // attacker would first need to get eval'd, not remove it.
  const scriptSrc = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`;

  const csp = [
    "default-src 'self'",
    scriptSrc,
    // 'unsafe-inline' is Tailwind's runtime style injection; the Google Fonts
    // host is for Phase 4 theming's curated-font <link> (only ever the two
    // fixed Google Fonts hosts, never an arbitrary site-supplied URL).
    `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS_HOST}`,
    // Any https: image and media source. Docs routinely embed badges, screenshots and diagrams hosted
    // elsewhere (and Markdown pulled from a repository does so constantly); blocking them left broken
    // images that only the browser console explained. The trade-off is that a reader's browser contacts
    // the host the author chose, which authors — members of the organisation — already control. Scripts,
    // styles, frames and connections stay locked down.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    `font-src 'self' data: ${GOOGLE_FONTS_STATIC_HOST}`,
    "connect-src 'self'",
    // Without this, `default-src 'self'` silently blocks the Embed block's
    // iframes (confirmed via testing: "Framing '...' violates ... default-src
    // 'self'"). Exactly the hosts resolveEmbed() can ever produce — nothing
    // wider, since this list is what actually enforces the embed allowlist at
    // the browser level, not just resolveEmbed()'s own regex matching.
    `frame-src ${EMBED_FRAME_SRC_HOSTS.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  res.headers.set("X-Frame-Options", "DENY");
}

export const config = {
  matcher: [
    // Skip static assets and Next internals; run on everything else.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
