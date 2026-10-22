import { headers } from "next/headers";

export interface RequestMeta {
  ip: string;
  userAgent: string;
  acceptLanguage: string | null;
  referrer: string | null;
  country: string | null;
}

/**
 * Reads request headers for analytics — must be called during a Server
 * Component's render (or a Route Handler), never inside `after()` itself
 * (Server Components can't call headers()/cookies() in that callback; see
 * lib/analytics/track.ts). `country` only ever comes from a header a
 * reverse proxy sets (e.g. Cloudflare's cf-ipcountry) — no GeoIP lookup of
 * our own, so this stays null on a plain Caddy deployment until one is added.
 */
export async function readRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";

  return {
    ip,
    userAgent: h.get("user-agent") ?? "unknown",
    acceptLanguage: h.get("accept-language"),
    referrer: h.get("referer"),
    country: h.get("cf-ipcountry"),
  };
}
