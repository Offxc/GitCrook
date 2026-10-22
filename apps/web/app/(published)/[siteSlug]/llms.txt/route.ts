import { resolveSiteBySlug } from "@/lib/tenancy/resolveSite";
import { serveSiteText } from "@/lib/tenancy/serveSiteText";

export async function GET(_req: Request, { params }: { params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await params;
  return serveSiteText(await resolveSiteBySlug(siteSlug), "llms");
}
