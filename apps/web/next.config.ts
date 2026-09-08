import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Minimal, traced deployment bundle for the Docker image (see docker/web.Dockerfile).
  output: "standalone",

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
