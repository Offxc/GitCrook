import Link from "next/link";
import { prisma } from "@voiddocs/db";
import { getEnv } from "@voiddocs/shared/server";
import { requireSite } from "@/lib/dashboard/site";
import { SettingsTabs } from "../SettingsTabs";
import { AudienceForm } from "./AudienceForm";
import { PasswordForm } from "./PasswordForm";
import { ShareLinksSection } from "./ShareLinksSection";

export default async function AccessPage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site } = await requireSite(orgSlug, siteId);
  const env = getEnv();

  const [hasPassword, shareLinks] = await Promise.all([
    prisma.sitePassword.findUnique({ where: { siteId: site.id } }),
    prisma.shareLink.findMany({ where: { siteId: site.id }, orderBy: { createdAt: "desc" } }),
  ]);

  const publishedBase = site.customDomain?.status === "ACTIVE" ? `https://${site.customDomain.hostname}` : `${env.ROOT_PROTOCOL}://${env.ROOT_DOMAIN}/${site.slug}`;

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-sm text-ink-muted">
        <Link href={`/dashboard/${orgSlug}/sites/${siteId}`} className="hover:text-ink">
          ← {site.name}
        </Link>
      </p>
      <SettingsTabs orgSlug={orgSlug} siteId={siteId} />
      <h1 className="text-2xl font-semibold text-ink">Visitor access</h1>
      <p className="mt-1 text-sm text-ink-muted">Control who can view {site.name}.</p>

      <div className="mt-6 space-y-6">
        <section className="rounded-xl border border-border bg-canvas p-5">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">Password</h2>
            {hasPassword ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                <CheckIcon />
                Set
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">Not set</span>
            )}
          </div>
          <p className="mb-3 text-xs text-ink-muted">
            {hasPassword
              ? "Switch Audience to “Password-protected” above to actually require it. Passwords are hashed — there's no way to view the current one, only replace it below."
              : "Set one here first, then switch Audience above to “Password-protected” to require it."}
          </p>
          <PasswordForm orgSlug={orgSlug} siteId={siteId} />
        </section>

        <section className="rounded-xl border border-border bg-canvas p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Audience</h2>
          <AudienceForm orgSlug={orgSlug} siteId={siteId} currentMode={site.audienceMode} hasPassword={Boolean(hasPassword)} />
        </section>

        <section className="rounded-xl border border-border bg-canvas p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Share links</h2>
          <p className="mb-3 text-xs text-ink-muted">Bypass Private/Password for anyone with the link, even without an account. Revoke anytime.</p>
          <ShareLinksSection orgSlug={orgSlug} siteId={siteId} links={shareLinks} publishedBase={publishedBase} />
        </section>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
