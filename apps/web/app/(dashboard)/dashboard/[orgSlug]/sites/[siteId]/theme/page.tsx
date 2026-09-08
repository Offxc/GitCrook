import Link from "next/link";
import { ThemeConfigSchema, defaultTheme } from "@voiddocs/shared";
import { requireSite } from "@/lib/dashboard/site";
import { ThemeForm } from "./ThemeForm";

export default async function ThemePage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site } = await requireSite(orgSlug, siteId);

  const parsed = ThemeConfigSchema.safeParse(site.theme);
  const theme = parsed.success ? parsed.data : defaultTheme();

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-sm text-ink-muted">
        <Link href={`/dashboard/${orgSlug}/sites/${siteId}`} className="hover:text-ink">
          ← {site.name}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Theme</h1>
      <p className="mt-1 text-sm text-ink-muted">Customize how {site.name} looks to visitors. Changes apply the moment you save.</p>

      <div className="mt-6">
        <ThemeForm orgSlug={orgSlug} siteId={siteId} initialTheme={theme} />
      </div>
    </div>
  );
}
