import { ThemeConfigSchema, defaultTheme } from "@voiddocs/shared";
import { requireSite } from "@/lib/dashboard/site";
import { SettingsShell } from "../SettingsShell";
import { ThemeForm } from "./ThemeForm";

export default async function ThemePage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site, organization } = await requireSite(orgSlug, siteId);

  const parsed = ThemeConfigSchema.safeParse(site.theme);
  const theme = parsed.success ? parsed.data : defaultTheme();

  return (
    <SettingsShell
      orgSlug={orgSlug}
      siteId={siteId}
      siteName={site.name}
      active="theme"
      title="Theme"
      description={`Customize how ${site.name} looks to visitors. Changes apply the moment you save.`}
    >
      <ThemeForm orgSlug={orgSlug} siteId={siteId} organizationId={organization.id} initialTheme={theme} />
    </SettingsShell>
  );
}
