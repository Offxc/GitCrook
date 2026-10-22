import { hostConfigFromEnv, webhookSecretFor, webhookSecretIsUsable, type HostConfig } from "@gitcrook/git-sync";
import { SecretBox } from "@gitcrook/shared/server";

/** What this server is set up for, read from its environment. Nothing here reaches a browser except what a page chooses to render. */
export interface GitSyncEnv {
  /** Null when no encryption key is set, or the one set is malformed (then `secretsProblem` says so). */
  secrets: SecretBox | null;
  secretsProblem: string | null;
  host: HostConfig;
  webhookConfigured: boolean;
  /** Set when `GITHUB_WEBHOOK_SECRET` is present but cannot be used (too short). */
  webhookProblem: string | null;
}

/** Where GitHub should send a repository's pushes, and the secret it signs them with. For people who manage the site only. */
export function webhookFor(sourceId: string): { url: string; secret: string } | null {
  const master = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecretIsUsable(master)) return null;
  return { url: `${process.env.ROOT_PROTOCOL ?? "http"}://${process.env.ROOT_DOMAIN ?? "localhost:3000"}/api/webhooks/github/${sourceId}`, secret: webhookSecretFor(master, sourceId) };
}

let cached: GitSyncEnv | null = null;

export function gitSyncEnv(): GitSyncEnv {
  if (cached) return cached;
  let secrets: SecretBox | null = null;
  let secretsProblem: string | null = null;
  try {
    secrets = SecretBox.fromEnv();
  } catch (error) {
    secretsProblem = error instanceof Error ? error.message : "GIT_SYNC_ENCRYPTION_KEY is not valid.";
  }
  const webhook = process.env.GITHUB_WEBHOOK_SECRET;
  cached = {
    secrets,
    secretsProblem,
    host: hostConfigFromEnv(),
    webhookConfigured: webhookSecretIsUsable(webhook),
    webhookProblem: webhook && !webhookSecretIsUsable(webhook) ? "GITHUB_WEBHOOK_SECRET is shorter than 32 characters, so webhooks are switched off." : null,
  };
  return cached;
}
