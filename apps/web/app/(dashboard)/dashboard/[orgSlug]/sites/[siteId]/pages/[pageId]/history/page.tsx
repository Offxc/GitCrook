import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { requireSite } from "@/lib/dashboard/site";
import { extractPlainText } from "@/lib/editor/extractText";
import { RestoreButton } from "./RestoreButton";

export default async function PageHistoryPage({ params }: { params: Promise<{ orgSlug: string; siteId: string; pageId: string }> }) {
  const { orgSlug, siteId, pageId } = await params;
  const { site, userId } = await requireSite(orgSlug, siteId);

  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page || page.siteId !== site.id) notFound();

  const canEdit = await canUserDoX(userId, "content.edit", { type: "page", id: page.id });
  if (!canEdit) notFound();

  const versions = await prisma.pageVersion.findMany({
    where: { pageId },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true, email: true } } },
  });

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-sm text-ink-muted">
        <Link href={`/dashboard/${orgSlug}/sites/${siteId}/pages/${pageId}`} className="hover:text-ink">
          ← {page.title}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Page history</h1>
      <p className="mt-1 text-sm text-ink-muted">
        A checkpoint is saved roughly every 5 minutes of active editing. Restoring saves the current content as a new checkpoint first, so it's never a dead end.
      </p>

      <div className="mt-6 space-y-3">
        <div className="rounded-xl border border-border bg-canvas p-4">
          <p className="text-sm font-medium text-ink">Current</p>
          <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{extractPlainText(page.content).slice(0, 200) || "(empty)"}</p>
        </div>

        {versions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
            No checkpoints yet — keep editing for a few minutes and one will appear here.
          </p>
        ) : (
          versions.map((v) => (
            <div key={v.id} className="rounded-xl border border-border bg-canvas p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-ink">{v.createdAt.toLocaleString()}</p>
                  <p className="text-xs text-ink-muted">{v.createdBy?.name ?? v.createdBy?.email ?? "Unknown"}</p>
                </div>
                <RestoreButton orgSlug={orgSlug} siteId={siteId} pageId={pageId} versionId={v.id} />
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-ink-muted">{extractPlainText(v.content).slice(0, 200) || "(empty)"}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
