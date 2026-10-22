import { resolveSiteByHostname } from "@/lib/tenancy/resolveSite";
import { serveSiteText } from "@/lib/tenancy/serveSiteText";

export async function GET(_req: Request, { params }: { params: Promise<{ hostname: string }> }) {
  const { hostname } = await params;
  return serveSiteText(await resolveSiteByHostname(hostname), "llms");
}
