import { NextResponse, type NextRequest } from "next/server";
import { EMBED_FRAME_SRC_HOSTS, GOOGLE_FONTS_CSS_HOST, GOOGLE_FONTS_STATIC_HOST } from "@voiddocs/shared";

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

  const host = (req.headers.get("host") ?? "").toLowerCase();
  const isRootDomain = host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}`;

  if (!isRootDomain) {
    // Any other Host is a candidate tenant custom domain — rewrite into the
    // dedicated route, which resolves it against verified CustomDomain rows
    // (an unrecognized hostname just 404s there; the Caddy `ask` endpoint is
    // the layer that decides whether such a hostname even gets a TLS cert).
    // NOTE: this segment must NOT start with `_` — Next.js treats a leading
    // underscore as a "private folder" that opts out of routing entirely, so
    // a route nested under one is silently unreachable (found via testing:
    // `_sites/...` 404'd and silently fell through to the [siteSlug] route).
    const url = req.nextUrl.clone();
    url.pathname = `/site-by-domain/${host}${req.nextUrl.pathname}`;
    const res = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    applySecurityHeaders(res, nonce);
    return res;
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(res, nonce);
  return res;
}

function applySecurityHeaders(res: NextResponse, nonce: string) {
  // React's dev mode reconstructs component stacks via eval() for better error
  // overlays — never used in production builds, so 'unsafe-eval' is scoped to
  // development only and never ships in the image actually deployed.
  const scriptSrc =
    process.env.NODE_ENV === "development"
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const csp = [
    "default-src 'self'",
    scriptSrc,
    // 'unsafe-inline' is Tailwind's runtime style injection; the Google Fonts
    // host is for Phase 4 theming's curated-font <link> (only ever the two
    // fixed Google Fonts hosts, never an arbitrary site-supplied URL).
    `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS_HOST}`,
    "img-src 'self' data: blob:",
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
