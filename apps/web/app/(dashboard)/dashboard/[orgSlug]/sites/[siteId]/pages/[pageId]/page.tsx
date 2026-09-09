import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@voiddocs/db";
import { canUserDoX } from "@voiddocs/auth";
import { requireSite } from "@/lib/dashboard/site";
import { EditorClientLoader } from "./EditorClientLoader";
import { ExportPdfButton } from "./ExportPdfButton";
import { DeletePageButton } from "./DeletePageButton";

export default async function PageEditorPage({ params }: { params: Promise<{ orgSlug: string; siteId: string; pageId: string }> }) {
  const { orgSlug, siteId, pageId } = await params;
  const { site, organization, userId } = await requireSite(orgSlug, siteId);

  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page || page.siteId !== site.id) notFound();

  const canEdit = await canUserDoX(userId, "content.edit", { type: "page", id: page.id });
  const childCount = await prisma.page.count({ where: { parentId: page.id } });

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <p className="text-sm text-ink-muted">
          <Link href={`/dashboard/${orgSlug}/sites/${siteId}`} className="hover:text-ink">
            ← {site.name}
          </Link>
        </p>
        <p className="text-sm font-medium text-ink">{page.title}</p>
        <div className="flex items-center gap-4">
          <ExportPdfButton pageId={pageId} />
          <Link href={`/dashboard/${orgSlug}/sites/${siteId}/pages/${pageId}/history`} className="text-sm text-ink-muted hover:text-ink">
            History
          </Link>
          {canEdit ? <DeletePageButton orgSlug={orgSlug} siteId={siteId} pageId={pageId} childCount={childCount} /> : null}
        </div>
      </div>
      {canEdit ? (
        <EditorClientLoader pageId={page.id} organizationId={organization.id} siteId={site.id} initialContent={page.content} initialVersion={page.contentVersion} />
      ) : (
        <p className="p-6 text-sm text-ink-muted">You have read-only access to this page.</p>
      )}
    </div>
  );
}
