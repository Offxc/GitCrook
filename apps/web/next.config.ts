import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Minimal, traced deployment bundle for the Docker image (see docker/web.Dockerfile).
  output: "standalone",

  experimental: {
    // proxy.ts clones and buffers every request body so a route can read it again, and
    // stops at 10MB by default — so any upload over 10MB reached /api/upload truncated and
    // failed with a 500, though images are allowed up to 20MB and files up to 100MB. Raise
    // it to cover the largest accepted upload plus multipart framing. The reverse proxy
    // caps every other route far below this (docker/caddy/Caddyfile).
    proxyClientMaxBodySize: "101mb",
  },

  // Deliberately NOT enabling `cacheComponents` yet: this is a multi-tenant,
  // permission-gated app, and the standard (fully dynamic-by-default) rendering
  // model is easier to reason about for authorization correctness than opting
  // into the newer explicit-caching model before the core app is proven out.
  //
  // `URL.pathname` does NOT decode percent-escapes (this path contains a space,
  // which becomes `%20`), so we use fileURLToPath to get a real filesystem path.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
};

export default nextConfig;
