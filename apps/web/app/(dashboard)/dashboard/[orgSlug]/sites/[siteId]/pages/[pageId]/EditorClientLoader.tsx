"use client";

import dynamic from "next/dynamic";

// BlockNote's useCreateBlockNote touches `window` unconditionally, so it
// cannot go through Next's server-side render pass at all (not even the
// client-boundary's initial SSR html) — discovered via a real "window is not
// defined" runtime error. `next/dynamic(..., { ssr: false })` can only be
// called from a Client Component, hence this one-line wrapper: the page.tsx
// Server Component renders this instead of EditorClient directly.
const EditorClient = dynamic(() => import("./EditorClient").then((m) => m.EditorClient), { ssr: false });

export { EditorClient as EditorClientLoader };
