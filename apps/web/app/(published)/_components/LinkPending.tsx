"use client";

import { useLinkStatus } from "next/link";

/**
 * A pulsing dot inside a <Link> while its navigation is in flight. Pages are rendered on demand, so
 * there is a moment between the click and the new page arriving; with the shell persistent the rest of
 * the screen stays put, and this is the only sign that the click registered. (A route-level
 * loading.tsx would show a skeleton instead, but streaming turns a missing page into a 200 and a
 * redirect rule into a client-side hop, which is a worse trade for a documentation site.)
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <span aria-hidden className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-site-primary" /> : null;
}
