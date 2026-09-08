import Link from "next/link";
import { requireSite } from "@/lib/dashboard/site";
import { SettingsTabs } from "../SettingsTabs";
import { AddDomainForm } from "./AddDomainForm";
import { VerifyButton, RemoveDomainButton } from "./DomainActions";
import { VERIFICATION_PREFIX } from "./shared";

export default async function DomainPage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site } = await requireSite(orgSlug, siteId);
  const domain = site.customDomain;

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-sm text-ink-muted">
        <Link href={`/dashboard/${orgSlug}/sites/${siteId}`} className="hover:text-ink">
          ← {site.name}
        </Link>
      </p>
      <SettingsTabs orgSlug={orgSlug} siteId={siteId} />
      <h1 className="text-2xl font-semibold text-ink">Custom domain</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Point a domain you own at this site. HTTPS is issued automatically once it's verified.
      </p>

      <div className="mt-6 rounded-xl border border-border bg-canvas p-5">
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
                    <dd className="text-ink">voiddocs-verify={domain.verificationToken}</dd>
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
    </div>
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
