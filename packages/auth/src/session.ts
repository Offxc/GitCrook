import { auth } from "./auth";

/** Server Component / Route Handler helper: the current session's user id, or null. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
