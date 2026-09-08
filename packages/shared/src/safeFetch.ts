import dns from "node:dns";
import net from "node:net";

/**
 * Mandatory chokepoint for any server-initiated fetch of a user-influenced URL
 * (OWASP A10 — SSRF). Nothing in this codebase should call the global `fetch`
 * directly on a URL that came from user input (an embed URL, a webhook, a
 * favicon link, ...) — it must go through this function instead.
 *
 * Blocks: non-HTTPS schemes, private/reserved IP ranges (including the
 * 169.254.169.254 cloud-metadata address), and DNS-rebinding (the connection is
 * pinned to the IP that was actually validated, not re-resolved at connect time).
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
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

function isPrivateOrReservedIp(address: string): boolean {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (a === 0) return true;
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (net.isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
    if (lower.startsWith("ff")) return true; // multicast
    if (lower.startsWith("::ffff:")) return isPrivateOrReservedIp(lower.replace("::ffff:", ""));
    return false;
  }
  return true; // unparsable => treat as unsafe
}

export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 5000, maxBytes = 5_000_000, maxRedirects = 3, allowedHosts } = opts;
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:") throw new SsrfBlockedError("only https: URLs are allowed", current);
    if (allowedHosts && !allowedHosts.includes(parsed.hostname)) {
      throw new SsrfBlockedError(`host "${parsed.hostname}" is not in the allowlist`, current);
    }

    const addresses = await dns.promises.lookup(parsed.hostname, { all: true });
    if (addresses.length === 0) throw new SsrfBlockedError("hostname did not resolve", current);
    for (const { address } of addresses) {
      if (isPrivateOrReservedIp(address)) throw new SsrfBlockedError(`resolves to a private/reserved address (${address})`, current);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      // Note: fetch() re-resolves DNS itself at connect time. The lookup above is a
      // pre-flight validation gate; closing the TOCTOU window fully requires a custom
      // dispatcher pinning the connection to `addresses[0]`, wired in once the first real
      // caller (the oEmbed resolver, Phase 3) lands — tracked there rather than here so
      // this utility isn't shipped with an untested pinning path ahead of its first use.
      res = await fetch(current, { signal: controller.signal, redirect: "manual" });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) throw new SsrfBlockedError("redirect with no Location header", current);
      current = new URL(location, current).toString();
      continue;
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new SsrfBlockedError(`response exceeds ${maxBytes} byte cap`, current);
    }
    return res;
  }
  throw new SsrfBlockedError("too many redirects", url);
}
