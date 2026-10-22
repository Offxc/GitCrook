import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Mandatory chokepoint for any server-initiated fetch of a user-influenced URL
 * (OWASP A10 — SSRF). Nothing in this codebase should call the global `fetch`
 * directly on a URL that came from user input (an embed URL, a Git remote, an
 * asset link, ...) — it must go through this function instead.
 *
 * What it enforces:
 *  - https only, no credentials in the URL, port 443 unless the caller names others;
 *  - private, loopback, link-local, CGNAT, documentation, multicast and other reserved ranges are
 *    refused for both IPv4 and IPv6, including IPv4 hidden inside IPv6 forms;
 *  - **the address that was validated is the address that is connected to.** Validation happens
 *    inside the socket's DNS lookup, so there is no window between "check" and "use" for a DNS
 *    rebinding answer to slip through;
 *  - redirects are followed manually and every hop goes through all of the above;
 *  - the response size cap is enforced while streaming, not only from `Content-Length`;
 *  - one deadline covers connecting, headers and the whole body.
 */

export class SsrfBlockedError extends Error {
  constructor(public readonly reason: string, url: string) {
    super(`Blocked outbound fetch to "${url}": ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

export interface SafeFetchOptions {
  /** If set, only these exact hostnames may be fetched (recommended for every real caller). */
  allowedHosts?: readonly string[];
  /** Ports other than 443 that are acceptable. */
  allowedPorts?: readonly number[];
  /** Deadline for the whole exchange, body included. Default 10 s. */
  timeoutMs?: number;
  /** Largest body that will be delivered. Default 5 MB. */
  maxBytes?: number;
  maxRedirects?: number;
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

// ---------------------------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------------------------

const reserved = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // carrier-grade NAT; also Tailscale and many clouds' internal ranges
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including the 169.254.169.254 metadata address
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including the broadcast address
] as const) {
  reserved.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64: embeds an IPv4 address
  ["100::", 64], // discard-only
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: embeds an IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated, still routable on some networks)
  ["ff00::", 8], // multicast
] as const) {
  reserved.addSubnet(network, prefix, "ipv6");
}

/** True for anything that is not an ordinary public unicast address — and for anything that does not parse. */
export function isPrivateOrReservedIp(address: string): boolean {
  if (address.includes("%")) return true; // a zone id only appears on link-local addresses
  const family = net.isIP(address);
  if (family === 0) return true;
  // BlockList treats IPv4-mapped IPv6 (::ffff:a.b.c.d and ::ffff:aabb:ccdd) as the IPv4 address it wraps.
  return reserved.check(address, family === 4 ? "ipv4" : "ipv6");
}

// ---------------------------------------------------------------------------------------------
// Pinned resolution
// ---------------------------------------------------------------------------------------------

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true });

type LookupCallback = (err: Error | null, address?: string | dns.LookupAddress[], family?: number) => void;

/**
 * A `lookup` for `net.connect` that refuses to hand back any private or reserved address. Because the
 * socket connects to exactly what this returns, validation and use are the same step. If *any* answer
 * is unsafe the whole name is refused: a name that sometimes points inward is not one to talk to.
 */
export function createGuardedLookup(resolve: Resolver = systemResolver) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) return callback(new SsrfBlockedError("hostname did not resolve", hostname));
        for (const { address } of addresses) {
          if (isPrivateOrReservedIp(address)) {
            return callback(new SsrfBlockedError(`resolves to a private or reserved address (${address})`, hostname));
          }
        }
        if (options.all) return callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
        const first = addresses[0]!;
        callback(null, first.address, first.family);
      },
      (error: Error) => callback(error),
    );
  };
}

// ---------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------

type FetchImpl = (url: string, init: Record<string, unknown>) => Promise<Response>;

const sharedAgent = new Agent({ connect: { lookup: createGuardedLookup() as never } });

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Wraps a response so that more than `maxBytes` of body is an error rather than a memory problem. */
function capBody(res: Response, maxBytes: number, url: string): Response {
  if (!res.body) return res;
  let seen = 0;
  const limited = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) controller.error(new SsrfBlockedError(`response exceeds ${maxBytes} byte cap`, url));
        else controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function checkUrl(raw: string, opts: SafeFetchOptions): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SsrfBlockedError("not a valid URL", raw);
  }
  if (parsed.protocol !== "https:") throw new SsrfBlockedError("only https: URLs are allowed", raw);
  if (parsed.username || parsed.password) throw new SsrfBlockedError("URLs with embedded credentials are not allowed", raw);

  const port = parsed.port === "" ? 443 : Number(parsed.port);
  if (port !== 443 && !opts.allowedPorts?.includes(port)) throw new SsrfBlockedError(`port ${port} is not allowed`, raw);

  if (opts.allowedHosts && !opts.allowedHosts.includes(parsed.hostname)) {
    throw new SsrfBlockedError(`host "${parsed.hostname}" is not in the allowlist`, raw);
  }

  // An IP literal never goes through a DNS lookup, so it has to be judged here.
  const literal = parsed.hostname.startsWith("[") ? parsed.hostname.slice(1, -1) : parsed.hostname;
  if (net.isIP(literal) !== 0 && isPrivateOrReservedIp(literal)) {
    throw new SsrfBlockedError(`${literal} is a private or reserved address`, raw);
  }
  return parsed;
}

const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key"]);

function withoutCredentials(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers;
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())));
}

/** `safeFetch` with its network layer injectable, so the rules above can be tested without a network. */
export function createSafeFetch(fetchImpl: FetchImpl) {
  return async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
    const { timeoutMs = 10_000, maxBytes = 5_000_000, maxRedirects = 3, method = "GET", headers, body } = opts;
    const signal = AbortSignal.timeout(timeoutMs);
    let current = url;
    let hopMethod = method;
    let hopBody = body;
    let hopHeaders = headers;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const parsed = checkUrl(current, opts);

      const res = await fetchImpl(parsed.toString(), { method: hopMethod, headers: hopHeaders, body: hopBody, signal, redirect: "manual" });

      if (REDIRECTS.has(res.status)) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location) throw new SsrfBlockedError("redirect with no Location header", current);
        const next = new URL(location, current);
        // Credentials belong to the host they were given for, as in a browser: a redirect elsewhere does not carry them along.
        if (next.host !== new URL(current).host) hopHeaders = withoutCredentials(hopHeaders);
        current = next.toString();
        // 301/302/303 turn a POST into a GET, as browsers do; 307/308 keep the method and body.
        if (res.status !== 307 && res.status !== 308 && hopMethod === "POST") {
          hopMethod = "GET";
          hopBody = undefined;
        }
        continue;
      }

      const contentLength = res.headers.get("content-length");
      if (contentLength && Number(contentLength) > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        throw new SsrfBlockedError(`response exceeds ${maxBytes} byte cap`, current);
      }
      return capBody(res, maxBytes, current);
    }
    throw new SsrfBlockedError("too many redirects", url);
  };
}

export const safeFetch = createSafeFetch(((url: string, init: Record<string, unknown>) =>
  undiciFetch(url, { ...init, dispatcher: sharedAgent } as never)) as unknown as FetchImpl);
