import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { requireSite, publishedUrlFor } from "@/lib/dashboard/site";
import { gitSyncEnv } from "@/lib/gitSyncEnv";
import { SettingsShell } from "../SettingsShell";
import { ConnectForm } from "./ConnectForm";
import { SourceActions } from "./SourceActions";
import { SourceSettings } from "./SourceSettings";

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const show = (d: Date | null) => (d ? `${when.format(d)} UTC` : "never");

interface Diag {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
  line?: number;
}

/** A run's stored diagnostics are JSON from our own writer, but this is rendered, so it is read defensively. */
function diagnosticsOf(value: unknown): Diag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((d): Diag[] => {
    if (typeof d !== "object" || d === null) return [];
    const x = d as Record<string, unknown>;
    if (typeof x.code !== "string" || typeof x.message !== "string") return [];
    const severity = x.severity === "error" || x.severity === "warning" ? x.severity : "info";
    return [{ code: x.code, severity, message: x.message, ...(typeof x.path === "string" ? { path: x.path } : {}), ...(typeof x.line === "number" ? { line: x.line } : {}) }];
  });
}

const STATUS_STYLE = {
  ok: "bg-success/10 text-success",
  busy: "bg-brand/10 text-brand",
  warn: "bg-danger/10 text-danger",
  idle: "bg-surface text-ink-muted",
} as const;

function Badge({ tone, children }: { tone: keyof typeof STATUS_STYLE; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[tone]}`}>{children}</span>;
}

export default async function GitSyncPage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site, userId } = await requireSite(orgSlug, siteId);
  const canManage = await canUserDoX(userId, "site.manageSettings", { type: "site", id: site.id });
  const env = gitSyncEnv();

  const variants = await prisma.variant.findMany({
    where: { space: { section: { siteId: site.id } } },
    orderBy: [{ space: { section: { order: "asc" } } }, { space: { order: "asc" } }, { order: "asc" }],
    select: {
      id: true,
      name: true,
      isDefault: true,
      space: { select: { title: true, section: { select: { title: true, siteId: true, spaces: { select: { id: true } } } } } },
      gitSource: true,
      _count: { select: { pages: { where: { deletedAt: null } } } },
    },
  });
  const sectionCount = await prisma.section.count({ where: { siteId: site.id } });

  const labelOf = (v: (typeof variants)[number]) => [sectionCount > 1 ? v.space.section.title : null, v.space.section.spaces.length > 1 ? v.space.title : null, v.name].filter(Boolean).join(" · ");
  const sources = variants.flatMap((v) => (v.gitSource ? [{ source: v.gitSource, variant: v }] : []));
  const free = variants.filter((v) => !v.gitSource).map((v) => ({ id: v.id, label: labelOf(v), pageCount: v._count.pages }));

  const runs = sources.length
    ? await prisma.gitSyncRun.findMany({ where: { sourceId: { in: sources.map((s) => s.source.id) } }, orderBy: { createdAt: "desc" }, take: 60 })
    : [];
  const credentials = new Set(
    (await prisma.gitCredential.findMany({ where: { id: { in: sources.flatMap((s) => (s.source.credentialId ? [s.source.credentialId] : [])) } }, select: { id: true } })).map((c) => c.id),
  );

  const webhookUrl = `${process.env.ROOT_PROTOCOL ?? "http"}://${process.env.ROOT_DOMAIN ?? "localhost:3000"}/api/webhooks/github`;
  const webHost = new URL(env.host.webBase).hostname;

  return (
    <SettingsShell
      orgSlug={orgSlug}
      siteId={siteId}
      siteName={site.name}
      publishedUrl={publishedUrlFor(site)}
      active="git"
      title="Git Sync"
      description="Keep a version of this site in a Git repository. The pages are Markdown files; a push to the branch updates the site, and the pages are read-only here."
      wide
    >
      {!canManage ? <p className="mb-6 rounded-lg border border-border bg-surface p-4 text-sm text-ink-muted">Only people who manage this site can change its Git settings. You can see how the syncs are going.</p> : null}

      <div className="space-y-6">
        {sources.map(({ source, variant }) => {
          const sourceRuns = runs.filter((r) => r.sourceId === source.id).slice(0, 8);
          const active = sourceRuns.find((r) => r.status === "PENDING" || r.status === "RUNNING");
          const tone = source.status === "PAUSED" ? "idle" : source.status === "ERROR" ? "warn" : active || source.status === "SYNCING" ? "busy" : source.lastSyncedAt ? "ok" : "idle";
          const label = source.status === "PAUSED" ? "Paused" : source.status === "ERROR" ? "Needs attention" : active ? (active.status === "RUNNING" ? "Syncing…" : "Waiting to sync") : source.lastSyncedAt ? "Up to date" : "Waiting for the first sync";
          const repoUrl = `${env.host.webBase}/${source.owner}/${source.repo}`;

          return (
            <section key={source.id} className="rounded-xl border border-border bg-canvas p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <a href={repoUrl} target="_blank" rel="noreferrer" className="break-all text-base font-medium text-ink hover:underline">
                    {source.owner}/{source.repo} <span aria-hidden>↗</span>
                  </a>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    branch <code className="text-ink">{source.branch}</code>
                    {source.rootDir ? (
                      <>
                        {" "}
                        · folder <code className="text-ink">{source.rootDir}</code>
                      </>
                    ) : null}{" "}
                    · fills “{labelOf(variant)}” · {variant._count.pages} page{variant._count.pages === 1 ? "" : "s"}
                  </p>
                </div>
                <Badge tone={tone}>{label}</Badge>
              </div>

              <dl className="mt-4 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-ink-muted">Last synced</dt>
                  <dd className="text-ink">
                    {show(source.lastSyncedAt)}
                    {source.lastSyncedSha ? (
                      <>
                        {" "}
                        <a href={`${repoUrl}/commit/${source.lastSyncedSha}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-brand hover:underline">
                          {source.lastSyncedSha.slice(0, 7)}
                        </a>
                      </>
                    ) : null}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-ink-muted">Last checked</dt>
                  <dd className="text-ink">{show(source.lastCheckedAt)}</dd>
                </div>
              </dl>

              {source.lastError ? <p className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{source.lastError}</p> : null}

              {canManage ? (
                <div className="mt-4 space-y-4">
                  <SourceActions orgSlug={orgSlug} siteId={siteId} sourceId={source.id} paused={source.status === "PAUSED"} />
                  <SourceSettings
                    orgSlug={orgSlug}
                    siteId={siteId}
                    sourceId={source.id}
                    branch={source.branch}
                    rootDir={source.rootDir}
                    pollIntervalSec={source.pollIntervalSec}
                    deleteGraceDays={source.deleteGraceDays}
                    hasToken={source.credentialId !== null && credentials.has(source.credentialId)}
                    canSaveToken={env.secrets !== null}
                  />
                </div>
              ) : null}

              <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-ink-muted">Recent syncs</h3>
              {sourceRuns.length === 0 ? (
                <p className="text-sm text-ink-muted">None yet.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {sourceRuns.map((run) => {
                    const diags = diagnosticsOf(run.diagnostics);
                    const worst = diags.find((d) => d.severity === "error") ?? diags.find((d) => d.severity === "warning");
                    const stats = (run.stats ?? {}) as Record<string, number | undefined>;
                    const summary = [
                      stats.added ? `${stats.added} added` : null,
                      stats.updated ? `${stats.updated} updated` : null,
                      stats.moved ? `${stats.moved} moved` : null,
                      stats.deleted ? `${stats.deleted} removed` : null,
                      stats.revived ? `${stats.revived} restored` : null,
                    ].filter(Boolean);
                    return (
                      <li key={run.id}>
                        <details>
                          <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-surface">
                            <Badge tone={run.status === "SUCCEEDED" ? "ok" : run.status === "FAILED" ? "warn" : run.status === "PARTIAL" ? "warn" : "busy"}>
                              {run.status === "SUCCEEDED" ? "Succeeded" : run.status === "FAILED" ? "Failed" : run.status === "PARTIAL" ? "Partly" : run.status === "RUNNING" ? "Running" : run.status === "PENDING" ? "Waiting" : "Cancelled"}
                            </Badge>
                            <span className="text-ink-muted">{show(run.createdAt)}</span>
                            <span className="text-ink-muted">{run.trigger.toLowerCase()}</span>
                            {run.toSha ? <span className="font-mono text-xs text-ink-muted">{run.toSha.slice(0, 7)}</span> : null}
                            <span className="text-ink">{summary.length ? summary.join(", ") : run.status === "SUCCEEDED" ? "no changes" : ""}</span>
                            {worst ? <span className="text-xs text-ink-muted">· {diags.filter((d) => d.severity !== "info").length} to look at</span> : null}
                          </summary>
                          <div className="space-y-2 border-t border-border bg-surface px-3 py-3 text-sm">
                            {run.error ? <p className="text-danger">{run.error}</p> : null}
                            {diags.length === 0 && !run.error ? <p className="text-ink-muted">Nothing to report.</p> : null}
                            <ul className="space-y-1.5">
                              {diags.slice(0, 50).map((d, i) => (
                                <li key={i} className="flex gap-2">
                                  <span className={`shrink-0 font-mono text-xs ${d.severity === "error" ? "text-danger" : d.severity === "warning" ? "text-ink" : "text-ink-muted"}`}>{d.code}</span>
                                  <span className="min-w-0 text-ink-muted">
                                    {d.path ? (
                                      <code className="text-ink">
                                        {d.path}
                                        {d.line ? `:${d.line}` : ""}
                                      </code>
                                    ) : null}{" "}
                                    {d.message}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {diags.length > 50 ? <p className="text-xs text-ink-muted">{diags.length - 50} more not shown here.</p> : null}
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        {canManage ? (
          free.length > 0 ? (
            <section className="rounded-xl border border-border bg-canvas p-5">
              <h2 className="text-sm font-medium text-ink">{sources.length === 0 ? "Connect a repository" : "Connect another repository"}</h2>
              <p className="mb-4 mt-1 text-sm text-ink-muted">
                Markdown files in the repository become pages, in the same folders. Read the{" "}
                <a href="https://github.com/Offxc/GitCrook/blob/main/docs/git-sync/FORMAT.md" target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  format guide
                </a>{" "}
                to see what a page can contain.
              </p>
              <ConnectForm orgSlug={orgSlug} siteId={siteId} variants={free} canSaveToken={env.secrets !== null} tokenProblem={env.secretsProblem} host={webHost} />
            </section>
          ) : (
            <p className="text-sm text-ink-muted">Every version of this site is connected to a repository. Create another version under Variants to connect one more.</p>
          )
        ) : null}

        <section className="rounded-xl border border-border bg-surface p-5 text-sm">
          <h2 className="font-medium text-ink">Updating the site when you push</h2>
          {env.webhookConfigured ? (
            <>
              <p className="mt-1 text-ink-muted">Add a webhook to the repository (Settings → Webhooks → Add webhook) so a push updates the site within seconds instead of at the next check:</p>
              <dl className="mt-3 space-y-1 font-mono text-xs">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-ink-muted">Payload URL</dt>
                  <dd className="break-all text-ink">{webhookUrl}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-ink-muted">Content type</dt>
                  <dd className="text-ink">application/json</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-ink-muted">Secret</dt>
                  <dd className="text-ink">the value of GITHUB_WEBHOOK_SECRET on this server</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-ink-muted">Events</dt>
                  <dd className="text-ink">Just the push event</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="mt-1 text-ink-muted">
              Webhooks are not set up on this server, so each repository is checked on a timer instead (every few minutes by default). To get pushes picked up immediately, whoever runs the server sets
              <code className="mx-1 text-ink">GITHUB_WEBHOOK_SECRET</code>and adds a webhook pointing at <code className="text-ink">{webhookUrl}</code>.
            </p>
          )}
        </section>
      </div>
    </SettingsShell>
  );
}
