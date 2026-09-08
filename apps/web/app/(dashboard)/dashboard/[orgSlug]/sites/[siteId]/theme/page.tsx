import Link from "next/link";
import { ThemeConfigSchema, defaultTheme } from "@voiddocs/shared";
import { requireSite } from "@/lib/dashboard/site";
import { SettingsTabs } from "../SettingsTabs";
import { ThemeForm } from "./ThemeForm";

export default async function ThemePage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site, organization } = await requireSite(orgSlug, siteId);

  const parsed = ThemeConfigSchema.safeParse(site.theme);
  const theme = parsed.success ? parsed.data : defaultTheme();

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-sm text-ink-muted">
        <Link href={`/dashboard/${orgSlug}/sites/${siteId}`} className="hover:text-ink">
          ← {site.name}
        </Link>
      </p>
      <SettingsTabs orgSlug={orgSlug} siteId={siteId} />
      <h1 className="text-2xl font-semibold text-ink">Theme</h1>
      <p className="mt-1 text-sm text-ink-muted">Customize how {site.name} looks to visitors. Changes apply the moment you save.</p>

      <div className="mt-6">
        <ThemeForm orgSlug={orgSlug} siteId={siteId} organizationId={organization.id} initialTheme={theme} />
      </div>
    </div>
  );
}
