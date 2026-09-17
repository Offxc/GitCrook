import { GitCrookMark } from "@/app/_components/GitCrookMark";
import Link from "next/link";

/**
 * Rendered per request, not prerendered, so proxy.ts's per-request CSP nonce
 * can actually reach the script tags. A statically prerendered page is built
 * before any request exists, so Next has no nonce to stamp on its scripts —
 * and with `strict-dynamic` in the policy, unnonced scripts are refused, so
 * the page shipped HTML that never hydrated. Caching in front of the origin
 * makes that unfixable for a static page on principle: the cached HTML's
 * nonce can't match a header minted later.
 *
 * Found on the live site, where every script on this page was CSP-blocked
 * while /login (dynamic) nonced all eleven of its own correctly.
 */
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <GitCrookMark className="h-10 w-auto text-brand" />
      <h1 className="text-3xl font-semibold text-ink">GitCrook</h1>
      <p className="max-w-md text-ink-muted">Publish beautiful documentation on your own domain.</p>
      <Link
        href="/login"
        className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-brand-ink transition hover:opacity-90"
      >
        Sign in
      </Link>
    </div>
  );
}
