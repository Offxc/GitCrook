import { Prisma, type PrismaClient } from "@gitcrook/db";
import type { Block, NavNode } from "@gitcrook/markdown";
import type { Move } from "./plan";
import type { SourceMeta } from "./meta";

type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** What to write for one page whose content or remembered metadata changed. Pages with no entry keep their content. */
export interface PageWrite {
  blocks: Block[];
  contentText: string;
  /** The object id of the file the blocks were built from. Null for generated pages. */
  blobSha: string | null;
  meta: SourceMeta | null;
}

export interface ApplyInput {
  source: { id: string; siteId: string; variantId: string };
  /** The whole tree, from `buildNavigation`. */
  tree: NavNode[];
  /** Keyed by node key. */
  writes: ReadonlyMap<string, PageWrite>;
  /** Pages whose file moved: the row of `from` becomes the page at `to`. */
  moves: readonly Move[];
  commitSha: string;
  /** The URL segments in front of this variant's pages (section, space, `~v/slug`). */
  prefix: readonly string[];
  now: Date;
}

export interface ApplyStats {
  added: number;
  updated: number;
  moved: number;
  deleted: number;
  revived: number;
  unchanged: number;
  redirectsAdded: number;
  redirectsRemoved: number;
}

/** Thrown when a variant holds pages that someone else manages: Git Sync will not guess what to do with them. */
export class ForeignPagesError extends Error {
  readonly code = "GS-304";
  constructor(count: number) {
    super(`The target has ${count} page${count === 1 ? "" : "s"} that this source does not manage. Remove them, or connect the source to an empty variant.`);
    this.name = "ForeignPagesError";
  }
}

interface Row {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  description: string | null;
  icon: string | null;
  isGroup: boolean;
  isDraft: boolean;
  isHidden: boolean;
  order: number;
  managedBy: string;
  sourcePath: string | null;
  sourceBlobSha: string | null;
  frontMatterId: string | null;
  deletedAt: Date | null;
  sourceMeta: Prisma.JsonValue | null;
}

interface Flat {
  node: NavNode;
  parentKey: string | null;
  order: number;
}

function flatten(nodes: readonly NavNode[], parentKey: string | null, out: Flat[] = []): Flat[] {
  nodes.forEach((node, order) => {
    out.push({ node, parentKey, order });
    flatten(node.children, node.key, out);
  });
  return out;
}

const join = (segments: readonly string[]) => segments.join("/");
/**
 * JSON with its keys in a fixed order. Postgres stores JSON as `jsonb`, which keeps keys in its own order, so a
 * document read back never stringifies the way it was written; comparing the plain strings would call every page
 * changed on every sync.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
const sameJson = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** Old addresses one source may ask to redirect with `redirect_from`. Every one is a row, and every sync reads them all. */
export const MAX_REDIRECTS_PER_SOURCE = 2_000;

/** A `redirect_from` entry as a site path, or null if it is not one we will write. */
export function cleanRedirectPath(raw: string): string | null {
  const parts = raw.trim().replace(/[?#].*$/, "").split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === ".." || /[\u0000-\u001f\u007f\\]/.test(p))) return null;
  return parts.join("/");
}

/**
 * Brings a variant's page tree to the shape of `tree`, inside the caller's transaction. Identity follows the file:
 * a page keeps its row, id and history when its file is moved; a page whose file is gone is soft-deleted, not
 * removed; slugs may swap places without tripping the unique indexes.
 */
export async function applyTree(tx: Tx, input: ApplyInput): Promise<ApplyStats> {
  const { source, now } = input;
  const stats: ApplyStats = { added: 0, updated: 0, moved: 0, deleted: 0, revived: 0, unchanged: 0, redirectsAdded: 0, redirectsRemoved: 0 };

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${source.id}))`;

  const foreign = await tx.page.count({ where: { variantId: source.variantId, deletedAt: null, OR: [{ sourceId: null }, { sourceId: { not: source.id } }] } });
  if (foreign > 0) throw new ForeignPagesError(foreign);

  const rows: Row[] = await tx.page.findMany({
    where: { sourceId: source.id },
    select: {
      id: true, parentId: true, title: true, slug: true, description: true, icon: true, isGroup: true, isDraft: true, isHidden: true, order: true,
      managedBy: true, sourcePath: true, sourceBlobSha: true, frontMatterId: true, deletedAt: true, sourceMeta: true,
    },
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const rowByPath = new Map(rows.filter((r) => r.sourcePath).map((r) => [r.sourcePath!, r]));

  const flat = flatten(input.tree, null);

  // --- Which row is which page ------------------------------------------------------------------
  const movedFrom = new Map(input.moves.map((m) => [m.to, m.from]));
  const claimed = new Set<string>();
  const rowFor = new Map<string, Row>();
  for (const { node } of flat) {
    const from = movedFrom.get(node.key);
    const row = (from ? rowByPath.get(from) : undefined) ?? rowByPath.get(node.key);
    if (row && !claimed.has(row.id)) {
      claimed.add(row.id);
      rowFor.set(node.key, row);
    }
  }

  // --- Where every page was, and will be --------------------------------------------------------
  const segmentsOfRow = (row: Row): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let r: Row | undefined = row; r && !seen.has(r.id); r = r.parentId ? rowById.get(r.parentId) : undefined) {
      seen.add(r.id);
      out.unshift(r.slug);
    }
    return [...input.prefix, ...out];
  };
  const oldPath = new Map<string, string[]>(); // by row id, for rows that were live
  for (const row of rows) if (!row.deletedAt) oldPath.set(row.id, segmentsOfRow(row));

  const newPath = new Map<string, string[]>(); // by node key
  const walk = (nodes: readonly NavNode[], parent: readonly string[]) => {
    for (const node of nodes) {
      const here = [...parent, node.slug];
      newPath.set(node.key, here);
      walk(node.children, here);
    }
  };
  walk(input.tree, [...input.prefix]);

  // --- Pages whose file is gone ------------------------------------------------------------------
  const keep = new Set([...rowFor.values()].map((r) => r.id));
  const toDelete = rows.filter((r) => !r.deletedAt && !keep.has(r.id));
  if (toDelete.length > 0) {
    await tx.page.updateMany({ where: { id: { in: toDelete.map((r) => r.id) } }, data: { deletedAt: now, isDraft: true } });
    stats.deleted = toDelete.length;
  }

  // --- Get slugs out of the way, so they can change places -------------------------------------
  const parentKeyOfRow = (row: Row) => (row.parentId ? (rowById.get(row.parentId)?.sourcePath ?? null) : null);
  const movers = flat
    .map((f) => ({ f, row: rowFor.get(f.node.key) }))
    .filter(({ f, row }) => row && !row.deletedAt && (row.slug !== f.node.slug || parentKeyOfRow(row) !== f.parentKey))
    .map(({ row }) => row!.id);
  if (movers.length > 0) await tx.$executeRaw`UPDATE "Page" SET slug = '~' || right(id, 12) WHERE id = ANY(${movers}::text[])`;
  const parkedSlug = new Set(movers); // their slug in the database is now a placeholder, whatever the row we read says

  // --- Write the tree, parents first --------------------------------------------------------------
  const idOfKey = new Map<string, string>();
  for (const { node, parentKey, order } of flat) {
    const write = input.writes.get(node.key);
    const existing = rowFor.get(node.key);
    const parentId = parentKey ? (idOfKey.get(parentKey) ?? null) : null;

    const fields = {
      title: node.title,
      slug: node.slug,
      description: node.description,
      icon: node.icon,
      isGroup: node.isGroup,
      isDraft: node.draft,
      isHidden: node.hidden,
      order,
      parentId,
      managedBy: "GIT" as const,
      sourceId: source.id,
      sourcePath: node.key,
      frontMatterId: node.frontMatterId,
      deletedAt: null,
    };

    if (!existing) {
      const created = await tx.page.create({
        data: {
          ...fields,
          variantId: source.variantId,
          siteId: source.siteId,
          content: (write?.blocks ?? []) as unknown as Prisma.InputJsonValue,
          contentText: write?.contentText ?? "",
          sourceBlobSha: write?.blobSha ?? null,
          sourceMeta: (write?.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        select: { id: true },
      });
      idOfKey.set(node.key, created.id);
      if (write) await tx.pageVersion.create({ data: { pageId: created.id, content: write.blocks as unknown as Prisma.InputJsonValue, version: 1, origin: "GIT", commitSha: input.commitSha } });
      stats.added++;
      continue;
    }

    idOfKey.set(node.key, existing.id);
    const wasDeleted = existing.deletedAt !== null;
    const changed: Prisma.PageUncheckedUpdateInput = {};
    if (existing.title !== fields.title) changed.title = fields.title;
    if (existing.slug !== fields.slug || parkedSlug.has(existing.id)) changed.slug = fields.slug;
    if (existing.description !== fields.description) changed.description = fields.description;
    if (existing.icon !== fields.icon) changed.icon = fields.icon;
    if (existing.isGroup !== fields.isGroup) changed.isGroup = fields.isGroup;
    if (existing.isDraft !== fields.isDraft) changed.isDraft = fields.isDraft;
    if (existing.isHidden !== fields.isHidden) changed.isHidden = fields.isHidden;
    if (existing.order !== fields.order) changed.order = fields.order;
    if (existing.parentId !== fields.parentId) changed.parentId = fields.parentId;
    if (existing.managedBy !== "GIT") changed.managedBy = "GIT";
    if (existing.sourcePath !== fields.sourcePath) changed.sourcePath = fields.sourcePath;
    if (existing.frontMatterId !== fields.frontMatterId) changed.frontMatterId = fields.frontMatterId;
    if (wasDeleted) changed.deletedAt = null;
    if (write) {
      if (write.blobSha !== existing.sourceBlobSha) changed.sourceBlobSha = write.blobSha;
      if (write.meta && !sameJson(write.meta, existing.sourceMeta)) changed.sourceMeta = write.meta as unknown as Prisma.InputJsonValue;
    }

    let contentChanged = false;
    if (write) {
      const current = await tx.page.findUnique({ where: { id: existing.id }, select: { content: true } });
      contentChanged = !sameJson(current?.content, write.blocks);
      if (contentChanged) {
        changed.content = write.blocks as unknown as Prisma.InputJsonValue;
        changed.contentText = write.contentText;
        changed.contentVersion = { increment: 1 };
      }
    }

    if (Object.keys(changed).length === 0) {
      stats.unchanged++;
      continue;
    }
    const updated = await tx.page.update({ where: { id: existing.id }, data: changed, select: { contentVersion: true } });
    if (contentChanged && write) {
      await tx.pageVersion.create({ data: { pageId: existing.id, content: write.blocks as unknown as Prisma.InputJsonValue, version: updated.contentVersion, origin: "GIT", commitSha: input.commitSha } });
    }
    if (wasDeleted) stats.revived++;
    else if (movedFrom.has(node.key)) stats.moved++;
    else stats.updated++;
  }

  await reconcileRedirects(tx, input, { flat, rowFor, oldPath, newPath, stats });
  return stats;
}

// -------------------------------------------------------------------------------------------------

async function reconcileRedirects(
  tx: Tx,
  input: ApplyInput,
  ctx: { flat: Flat[]; rowFor: Map<string, Row>; oldPath: Map<string, string[]>; newPath: Map<string, string[]>; stats: ApplyStats },
) {
  const { source } = input;
  const livePaths = new Set([...ctx.newPath.values()].map(join));

  // What each page that was already live moved from and to.
  const moved = new Map<string, string>(); // old path → new path
  for (const { node } of ctx.flat) {
    const row = ctx.rowFor.get(node.key);
    if (!row || row.deletedAt) continue;
    const from = ctx.oldPath.get(row.id);
    const to = ctx.newPath.get(node.key);
    if (from && to && join(from) !== join(to)) moved.set(join(from), join(to));
  }

  // What `redirect_from` asks for.
  const wanted = new Map<string, string>(); // from → to
  for (const { node } of ctx.flat) {
    if (node.draft) continue;
    const to = join(ctx.newPath.get(node.key)!);
    for (const raw of node.redirectFrom) {
      const rel = cleanRedirectPath(raw);
      if (!rel) continue;
      const from = join([...input.prefix, rel]);
      if (from !== to && !livePaths.has(from) && (wanted.has(from) || wanted.size < MAX_REDIRECTS_PER_SOURCE)) wanted.set(from, to);
    }
  }

  const existing = await tx.siteRedirect.findMany({ where: { siteId: source.siteId } });
  const byFrom = new Map(existing.map((r) => [r.fromPath, r]));
  const mine = existing.filter((r) => r.sourceId === source.id);

  // Redirects from before: a chain of moves points at the latest address; one whose target is gone or whose
  // address is a page again is dropped.
  for (const r of mine) {
    if (livePaths.has(r.fromPath)) {
      await tx.siteRedirect.delete({ where: { id: r.id } });
      ctx.stats.redirectsRemoved++;
      continue;
    }
    if (r.origin === "FRONT_MATTER") {
      if (wanted.get(r.fromPath) === r.toPath) wanted.delete(r.fromPath);
      else {
        await tx.siteRedirect.delete({ where: { id: r.id } });
        ctx.stats.redirectsRemoved++;
      }
      continue;
    }
    const target = moved.get(r.toPath) ?? r.toPath;
    if (!livePaths.has(target)) {
      await tx.siteRedirect.delete({ where: { id: r.id } });
      ctx.stats.redirectsRemoved++;
    } else if (target !== r.toPath) {
      await tx.siteRedirect.update({ where: { id: r.id }, data: { toPath: target } });
    }
  }

  const add = async (from: string, to: string, origin: "MOVE" | "FRONT_MATTER") => {
    if (from === to || livePaths.has(from)) return;
    const clash = byFrom.get(from);
    // A redirect someone made by hand is theirs; a sync does not overwrite it.
    if (clash && clash.sourceId !== source.id) return;
    if (clash && mine.some((m) => m.id === clash.id)) {
      // Already handled above (kept or retargeted), unless it was dropped.
      const stillThere = await tx.siteRedirect.findUnique({ where: { id: clash.id } });
      if (stillThere) return;
    }
    await tx.siteRedirect.create({ data: { siteId: source.siteId, fromPath: from, toPath: to, sourceId: source.id, origin } });
    ctx.stats.redirectsAdded++;
  };
  for (const [from, to] of moved) await add(from, to, "MOVE");
  for (const [from, to] of wanted) await add(from, to, "FRONT_MATTER");
}
