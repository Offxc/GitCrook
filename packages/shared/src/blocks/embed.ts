/**
 * Resolves a pasted URL to a safe iframe embed, without ever fetching the
 * user-supplied URL server-side (the SSRF-prone pattern GitBook itself uses
 * via Iframely). Each provider's regex extracts an id and builds an iframe
 * `src` pointing at a FIXED, hardcoded embed host — the pasted URL's host
 * only ever has to match one of these known patterns, it never becomes the
 * fetch/iframe target directly.
 */
export interface EmbedMatch {
  provider: "youtube" | "vimeo" | "spotify" | "codepen";
  embedUrl: string;
}

const MATCHERS: { provider: EmbedMatch["provider"]; pattern: RegExp; build: (m: RegExpMatchArray) => string }[] = [
  {
    provider: "youtube",
    pattern: /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=([\w-]+)|youtu\.be\/([\w-]+)|youtube\.com\/embed\/([\w-]+))/i,
    build: (m) => `https://www.youtube-nocookie.com/embed/${m[1] ?? m[2] ?? m[3]}`,
  },
  {
    provider: "vimeo",
    pattern: /^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i,
    build: (m) => `https://player.vimeo.com/video/${m[1]}`,
  },
  {
    provider: "spotify",
    pattern: /^https?:\/\/open\.spotify\.com\/(track|album|playlist|episode|show)\/([\w]+)/i,
    build: (m) => `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
  },
  {
    provider: "codepen",
    pattern: /^https?:\/\/codepen\.io\/([\w-]+)\/pen\/([\w-]+)/i,
    build: (m) => `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`,
  },
];

export function resolveEmbed(url: string): EmbedMatch | null {
  for (const { provider, pattern, build } of MATCHERS) {
    const match = url.match(pattern);
    if (match) return { provider, embedUrl: build(match) };
  }
  return null;
}

/**
 * The exact set of hosts `resolveEmbed` can ever produce as an iframe `src`.
 * Single source of truth for the published-site CSP's `frame-src` directive
 * (proxy.ts) — every host here must match a `build()` above exactly, or an
 * embed will render but get silently blocked by the browser's CSP instead
 * (confirmed via testing: "Framing '...' violates ... default-src 'self'").
 */
export const EMBED_FRAME_SRC_HOSTS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com", "https://open.spotify.com", "https://codepen.io"] as const;
