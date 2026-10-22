/**
 * What changed between the files a source last synced and the files the branch has now.
 *
 * The comparison is against the database, not against the previous commit: every sync reads the whole tree and
 * compares object ids with what each page remembers. A force-push, a branch reset or a missed webhook therefore
 * cannot leave the site wrong, and a file missing from the full listing is the only thing that deletes a page.
 */

export interface KnownFile {
  path: string;
  /** The object id the page was last built from. */
  sha: string | null;
  /** Soft-deleted: the file went away earlier and the row is waiting out its grace period. */
  deleted: boolean;
  frontMatterId?: string | null;
}

export interface CurrentFile {
  path: string;
  sha: string;
}

export interface Move {
  from: string;
  to: string;
  /** Why the two were matched. */
  by: "content" | "id";
}

export interface Plan {
  /** In the repository now, never seen before. */
  added: string[];
  /** In both, with different content. */
  modified: string[];
  /** In both, with the same content. */
  unchanged: string[];
  /** Previously deleted, in the repository again. `modified` says whether the content differs. */
  revived: { path: string; modified: boolean }[];
  /** Gone from the repository. */
  removed: string[];
  /** The same file under a new name. */
  moves: Move[];
}

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function planChanges(known: readonly KnownFile[], current: readonly CurrentFile[]): Plan {
  const knownByPath = new Map(known.map((k) => [k.path, k]));
  const currentPaths = new Set(current.map((c) => c.path));

  const plan: Plan = { added: [], modified: [], unchanged: [], revived: [], removed: [], moves: [] };

  for (const file of [...current].sort((a, b) => cmp(a.path, b.path))) {
    const before = knownByPath.get(file.path);
    if (!before) plan.added.push(file.path);
    else if (before.deleted) plan.revived.push({ path: file.path, modified: before.sha !== file.sha });
    else if (before.sha === file.sha) plan.unchanged.push(file.path);
    else plan.modified.push(file.path);
  }
  for (const k of [...known].sort((a, b) => cmp(a.path, b.path))) {
    if (!k.deleted && !currentPaths.has(k.path)) plan.removed.push(k.path);
  }

  // A file that disappeared and a file with identical content that appeared are one file that moved.
  const shaOf = new Map(current.map((c) => [c.path, c.sha]));
  const removedBySha = new Map<string, string[]>();
  for (const path of plan.removed) {
    const sha = knownByPath.get(path)!.sha;
    if (sha) removedBySha.set(sha, [...(removedBySha.get(sha) ?? []), path]);
  }
  const addedBySha = new Map<string, string[]>();
  for (const path of plan.added) addedBySha.set(shaOf.get(path)!, [...(addedBySha.get(shaOf.get(path)!) ?? []), path]);

  const movedFrom = new Set<string>();
  const movedTo = new Set<string>();
  for (const [sha, from] of removedBySha) {
    const to = [...(addedBySha.get(sha) ?? [])];
    if (to.length === 0) continue;
    // With several identical files (empty pages, say) prefer pairs that kept their file name, then go in path order.
    const remainingFrom = [...from];
    for (const f of [...remainingFrom]) {
      const i = to.findIndex((t) => basename(t) === basename(f));
      if (i !== -1) {
        plan.moves.push({ from: f, to: to[i]!, by: "content" });
        movedFrom.add(f);
        movedTo.add(to[i]!);
        to.splice(i, 1);
        remainingFrom.splice(remainingFrom.indexOf(f), 1);
      }
    }
    while (remainingFrom.length > 0 && to.length > 0) {
      const f = remainingFrom.shift()!;
      const t = to.shift()!;
      plan.moves.push({ from: f, to: t, by: "content" });
      movedFrom.add(f);
      movedTo.add(t);
    }
  }
  plan.added = plan.added.filter((p) => !movedTo.has(p));
  plan.removed = plan.removed.filter((p) => !movedFrom.has(p));
  plan.moves.sort((a, b) => cmp(a.to, b.to));
  return plan;
}

/**
 * Once the added files are parsed, a file whose front matter `id` is that of a page whose file is gone is that
 * page, moved and edited. This is what `id:` is for: an identity that survives a rename with changes.
 */
export function matchMovesById(plan: Plan, known: readonly KnownFile[], idOf: (addedPath: string) => string | null): Plan {
  const removedById = new Map<string, string>();
  for (const path of plan.removed) {
    const id = known.find((k) => k.path === path)?.frontMatterId;
    if (id) removedById.set(id, path);
  }
  if (removedById.size === 0) return plan;

  const moves = [...plan.moves];
  const added: string[] = [];
  const removed = new Set(plan.removed);
  for (const path of plan.added) {
    const id = idOf(path);
    const from = id ? removedById.get(id) : undefined;
    if (from && removed.has(from)) {
      moves.push({ from, to: path, by: "id" });
      removed.delete(from);
    } else added.push(path);
  }
  moves.sort((a, b) => cmp(a.to, b.to));
  return { ...plan, added, moves, removed: plan.removed.filter((p) => removed.has(p)) };
}
