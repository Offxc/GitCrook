import { NextRequest } from "next/server";
import { getEnv } from "@voiddocs/shared/server";
import { resolveSiteByHostname } from "@/lib/tenancy/resolveSite";

/**
 * Caddy's `on_demand_tls` `ask` directive calls `GET <this>?domain=<sni-host>`
 * before issuing a certificate for any hostname it doesn't already have
 * config for. Any 2xx authorizes issuance; anything else cancels it. This is
 * the actual anti-abuse gate that stops a stranger from pointing an
 * unverified/unowned domain at the platform and getting a real cert issued —
 * see the domain-verification flow in dashboard/[orgSlug]/sites/[siteId]/domain.
 *
 * Only reachable from Caddy itself in production (the `web` container
 * publishes no host port), but the input is still validated defensively —
 * network isolation is not treated as the only control.
 */
const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(\.(?!-)[a-z0-9-]{1,63})+$/;

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get("domain") ?? "").toLowerCase().trim();
  if (!HOSTNAME_RE.test(domain)) return new Response(null, { status: 400 });

  // TLS SNI (what Caddy actually passes here) never carries a port, but
  // ROOT_DOMAIN may (e.g. "localhost:3000" for local dev's Host-header
  // matching in proxy.ts) — strip it before comparing so the two stay
  // consistent regardless of which context set the value.
  const env = getEnv();
  const rootHost = env.ROOT_DOMAIN.split(":")[0];
  if (domain === rootHost || domain === `www.${rootHost}`) {
    return new Response(null, { status: 200 });
  }

  // Pure DB read, zero outbound network calls of its own — this can never
  // itself become an SSRF vector.
  const site = await resolveSiteByHostname(domain);
  return new Response(null, { status: site ? 200 : 403 });
}
