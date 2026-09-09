"use client";

import dynamic from "next/dynamic";

// Same reasoning as the dashboard's EditorClientLoader: useCreateBlockNote
// touches `window` unconditionally, so it can't go through SSR at all, not
// even a Client Component's initial render — has to be dynamic(ssr:false).
// This also keeps the editor bundle out of every anonymous visitor's page
// weight: it only loads once someone with edit rights actually clicks Edit.
const InPlaceEditorClient = dynamic(() => import("./InPlaceEditorClient").then((m) => m.InPlaceEditorClient), {
  ssr: false,
  loading: () => <p className="text-sm text-site-ink-muted">Loading editor…</p>,
});

export { InPlaceEditorClient as InPlaceEditorLoader };
