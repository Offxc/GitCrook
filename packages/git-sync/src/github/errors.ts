/**
 * What can go wrong talking to a Git host, in terms the sync engine can act on. Messages are written for the
 * person reading a run's log: they name what happened and never include a token.
 */

export class GitHostError extends Error {
  constructor(
    message: string,
    /** The diagnostic code a run records for this (see docs/git-sync/FORMAT.md). */
    readonly code: "GS-151" | "GS-301" | "GS-302" | "GS-303",
    /** True when trying again later may work (the engine reschedules instead of marking the source broken). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The repository or branch does not exist, or the credential cannot see it (GitHub answers 404 for both). */
export class NotFoundError extends GitHostError {
  constructor(what: string) {
    super(`${what} was not found, or the credential cannot see it.`, "GS-302", false);
  }
}

/** The credential was refused or lacks permission. */
export class AuthError extends GitHostError {
  constructor(message = "GitHub refused the credential (it may be expired, revoked, or lack read access to the repository).") {
    super(message, "GS-303", false);
  }
}

/** Out of request budget. `resetAt` says when to try again. */
export class RateLimitError extends GitHostError {
  constructor(readonly resetAt: Date) {
    super(`GitHub's rate limit was reached; it resets at ${resetAt.toISOString()}.`, "GS-301", true);
  }
}

/** A 5xx, a timeout or a dropped connection that did not clear up after retries. */
export class UnavailableError extends GitHostError {
  constructor(message: string) {
    super(message, "GS-302", true);
  }
}

/** The host sent something unexpected: not JSON, missing fields, a body too large. Not worth retrying blindly. */
export class ProtocolError extends GitHostError {
  constructor(message: string) {
    super(message, "GS-302", false);
  }
}
