import { resolveSiteByHostname } from "@/lib/tenancy/resolveSite";
import { serveSiteText } from "@/lib/tenancy/serveSiteText";

export async function GET(_req: Request, { params }: { params: Promise<{ hostname: string; path: string[] }> }) {
  const { hostname, path } = await params;
  return serveSiteText(await resolveSiteByHostname(hostname), "page", path);
}
