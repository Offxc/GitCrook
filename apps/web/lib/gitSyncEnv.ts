import { hostConfigFromEnv, type HostConfig } from "@gitcrook/git-sync";
import { SecretBox } from "@gitcrook/shared/server";

/** What this server is set up for, read from its environment. Nothing here is ever sent to a browser except the booleans. */
export interface GitSyncEnv {
  /** Null when no encryption key is set, or the one set is malformed (then `secretsProblem` says so). */
  secrets: SecretBox | null;
  secretsProblem: string | null;
  host: HostConfig;
  webhookConfigured: boolean;
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
  cached = { secrets, secretsProblem, host: hostConfigFromEnv(), webhookConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET?.trim()) };
  return cached;
}
