import { PageNotFound } from "@/app/(published)/_components/PageNotFound";

// Rendered inside the site's layout, so the shell stays around a missing page.
export default function SiteNotFound() {
  return <PageNotFound />;
}
