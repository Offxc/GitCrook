import "katex/dist/katex.min.css";

// Kept minimal on purpose: the actual reader shell (header, sidebar, search,
// dark mode) lives in lib/tenancy/renderPublishedSite.tsx via the
// [data-site-root] wrapper, shared by both entry points. This layout only
// exists so a published site's route tree is independent of the dashboard's,
// and to host the KaTeX stylesheet the Math block's server-rendered HTML
// depends on (the editor imports its own copy directly in math.tsx).
export default function PublishedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
