import { z } from "zod";

/**
 * Every process (web, worker) validates its environment at boot through this
 * schema and crashes immediately on a missing/malformed value (OWASP A05 —
 * fail fast rather than limp along with an undefined secret).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // "pglite:./packages/db/.pglite/data" for local dev (no server needed),
  // "postgresql://user:pass@postgres:5432/gitcrook" in Docker/production.
  DATABASE_URL: z.string().min(1),

  // Optional in development (rate limiting / BullMQ jobs no-op without it until Phase 5+).
  REDIS_URL: z.string().optional(),

  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)"),
  // Empty string (not just absent) counts as "not configured yet" — the
  // .env.example ships these blank until a Discord Application exists.
  AUTH_DISCORD_ID: z.string().optional().transform((v) => (v ? v : undefined)),
  AUTH_DISCORD_SECRET: z.string().optional().transform((v) => (v ? v : undefined)),

  // Who may create a NEW account. "closed" (the default) admits only: a Discord ID in
  // ALLOWED_DISCORD_IDS, someone holding a pending email invitation (their Discord email
  // must be verified), and the very first sign-in on an empty database, which becomes the
  // instance owner. "open" lets any Discord account create its own organization — only
  // choose that on a deployment you are happy to host strangers' content on. People who
  // already have an account can always sign in, whatever this is set to.
  SIGNUP_MODE: z.enum(["closed", "open"]).default("closed"),

  // Comma-separated Discord user IDs (snowflakes) that may create an account in "closed"
  // mode. When this is set the first-sign-in-becomes-owner rule is switched off: the owner
  // is whoever you listed, so a stranger can't win a race to a freshly deployed instance.
  ALLOWED_DISCORD_IDS: z.string().optional().transform((v) => (v ? v : undefined)),

  // The platform's own root domain, e.g. "docs.voidsmp.com". Requests for any other
  // Host are treated as candidate tenant custom domains (see apps/web/middleware.ts).
  ROOT_DOMAIN: z.string().min(1).default("localhost:3000"),
  ROOT_PROTOCOL: z.enum(["http", "https"]).default("http"),

  STORAGE_DIR: z.string().default("./.data/uploads"),

  // apps/worker only (PDF export). The production worker.Dockerfile installs
  // a system Chromium and points this at it — playwright-core (no bundled
  // browser download) rather than full `playwright`, so the image only ships
  // one Chromium instead of two. Unset in local dev: falls back to whatever
  // playwright-core finds on its own (see apps/worker/src/browser.ts).
  CHROMIUM_EXECUTABLE_PATH: z.string().optional().transform((v) => (v ? v : undefined)),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Lazily validated so a single bad var fails loudly, once, with a clear message. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
