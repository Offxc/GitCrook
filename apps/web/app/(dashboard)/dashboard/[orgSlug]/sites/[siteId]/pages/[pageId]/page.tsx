import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { editUrl } from "@gitcrook/git-sync";
import { gitSyncEnv } from "@/lib/gitSyncEnv";
import { requireSite } from "@/lib/dashboard/site";
import { EditorClientLoader } from "./EditorClientLoader";
import { ExportPdfButton } from "./ExportPdfButton";
import { DeletePageButton } from "./DeletePageButton";
import { PageIconPicker } from "./PageIconPicker";
import { PageIcon } from "@/app/(published)/_components/PageIcon";

export default async function PageEditorPage({ params }: { params: Promise<{ orgSlug: string; siteId: string; pageId: string }> }) {
  const { orgSlug, siteId, pageId } = await params;
  const { site, organization, userId } = await requireSite(orgSlug, siteId);

  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page || page.siteId !== site.id) notFound();

  const canEditContent = await canUserDoX(userId, "content.edit", { type: "page", id: page.id });
  const childCount = await prisma.page.count({ where: { parentId: page.id } });

  // A page a repository manages is read-only here: the next sync would overwrite any change. The server refuses
  // the edits as well; this is what the person sees.
  const managed = page.managedBy === "GIT" && page.sourceId !== null;
  const canEdit = canEditContent && !managed;
  const source = managed ? await prisma.gitSource.findUnique({ where: { id: page.sourceId! }, select: { owner: true, repo: true, branch: true, rootDir: true, lastSyncedAt: true } }) : null;
  const lastSync = managed ? await prisma.pageVersion.findFirst({ where: { pageId: page.id, origin: "GIT" }, orderBy: { createdAt: "desc" }, select: { commitSha: true, createdAt: true } }) : null;
  const githubUrl = source && page.sourcePath && !page.isGroup && !/^(dir|group):/.test(page.sourcePath) ? editUrl(gitSyncEnv().host.webBase, source, page.sourcePath) : null;

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <p className="text-sm text-ink-muted">
          <Link href={`/dashboard/${orgSlug}/sites/${siteId}`} className="hover:text-ink">
            ← {site.name}
          </Link>
        </p>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <PageIconPicker orgSlug={orgSlug} siteId={siteId} pageId={pageId} initialIcon={page.icon} />
          ) : (
            <PageIcon icon={page.icon} className="h-4 w-4 shrink-0" />
          )}
          <p className="text-sm font-medium text-ink">{page.title}</p>
        </div>
        <div className="flex items-center gap-4">
          <ExportPdfButton pageId={pageId} />
          <Link href={`/dashboard/${orgSlug}/sites/${siteId}/pages/${pageId}/history`} className="text-sm text-ink-muted hover:text-ink">
            History
          </Link>
          {canEdit ? <DeletePageButton orgSlug={orgSlug} siteId={siteId} pageId={pageId} childCount={childCount} /> : null}
        </div>
      </div>
      {managed ? (
        <div className="mx-auto w-full max-w-2xl space-y-4 px-5 py-10">
          <h1 className="text-xl font-semibold text-ink">{page.title}</h1>
          <div className="rounded-xl border border-border bg-surface p-5 text-sm">
            <p className="font-medium text-ink">This page comes from a Git repository.</p>
            <p className="mt-1 text-ink-muted">
              {page.isGroup || /^(dir|group):/.test(page.sourcePath ?? "")
                ? "It is a heading or folder made from the repository's structure, so there is nothing to edit here."
                : "To change it, edit the file in the repository; the site updates when you push. Changes made here would be overwritten by the next sync, so editing is turned off."}
            </p>
            {source && page.sourcePath && !/^(dir|group):/.test(page.sourcePath) ? (
              <p className="mt-3 text-ink-muted">
                <code className="text-ink">{[source.rootDir, page.sourcePath].filter(Boolean).join("/")}</code> on <code className="text-ink">{source.branch}</code>
                {lastSync?.commitSha ? <> · last changed by commit <code className="text-ink">{lastSync.commitSha.slice(0, 7)}</code></> : null}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              {githubUrl ? (
                <a href={githubUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink transition hover:opacity-90">
                  Edit on GitHub ↗
                </a>
              ) : null}
              <Link href={`/dashboard/${orgSlug}/sites/${siteId}/git`} className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm text-ink transition hover:bg-surface">
                Git settings
              </Link>
            </div>
          </div>
        </div>
      ) : canEdit ? (
        <EditorClientLoader pageId={page.id} organizationId={organization.id} siteId={site.id} initialContent={page.content} initialVersion={page.contentVersion} />
      ) : (
        <p className="p-6 text-sm text-ink-muted">You have read-only access to this page.</p>
      )}
    </div>
  );
}
