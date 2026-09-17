import { requireSite } from "@/lib/dashboard/site";
import { SettingsShell } from "../SettingsShell";
import { AddDomainForm } from "./AddDomainForm";
import { VerifyButton, RemoveDomainButton } from "./DomainActions";
import { VERIFICATION_PREFIX } from "./shared";

export default async function DomainPage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site } = await requireSite(orgSlug, siteId);
  const domain = site.customDomain;

  return (
    <SettingsShell
      orgSlug={orgSlug}
      siteId={siteId}
      siteName={site.name}
      active="domain"
      title="Custom domain"
      description="Point a domain you own at this site. HTTPS is issued automatically once it's verified."
    >
      <div className="rounded-xl border border-border bg-canvas p-5">
        {!domain ? (
          <AddDomainForm orgSlug={orgSlug} siteId={siteId} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{domain.hostname}</p>
                <StatusBadge status={domain.status} />
              </div>
              <RemoveDomainButton orgSlug={orgSlug} siteId={siteId} />
            </div>

            {domain.status !== "ACTIVE" ? (
              <div className="rounded-lg border border-border bg-surface p-4 text-sm">
                <p className="text-ink-muted">Add this TXT record at your DNS provider, then verify:</p>
                <dl className="mt-3 space-y-2 font-mono text-xs">
                  <div>
                    <dt className="text-ink-muted">Name</dt>
                    <dd className="text-ink">
                      {VERIFICATION_PREFIX}.{domain.hostname}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Value</dt>
                    <dd className="text-ink">gitcrook-verify={domain.verificationToken}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-ink-muted">
                  Also point an A/CNAME record for {domain.hostname} at this platform's server so traffic actually
                  reaches it — the TXT record only proves ownership.
                </p>
                <div className="mt-4">
                  <VerifyButton orgSlug={orgSlug} siteId={siteId} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Verified {domain.verifiedAt?.toLocaleString()}.</p>
            )}
          </div>
        )}
      </div>
    </SettingsShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: "text-ink-muted",
    ACTIVE: "text-brand",
    NEEDS_REVERIFICATION: "text-danger",
    REVOKED: "text-danger",
  };
  return <p className={`text-xs ${styles[status] ?? "text-ink-muted"}`}>{status.replace("_", " ").toLowerCase()}</p>;
}
