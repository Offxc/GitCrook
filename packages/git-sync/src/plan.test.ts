import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { matchMovesById, planChanges, type CurrentFile, type KnownFile } from "./plan";

const known = (path: string, sha: string | null, extra: Partial<KnownFile> = {}): KnownFile => ({ path, sha, deleted: false, ...extra });
const now = (path: string, sha: string): CurrentFile => ({ path, sha });

describe("planChanges", () => {
  it("sorts every file into one bucket", () => {
    const plan = planChanges(
      [known("same.md", "s1"), known("edited.md", "e1"), known("gone.md", "g1"), known("back.md", "b1", { deleted: true }), known("back2.md", "b2", { deleted: true })],
      [now("same.md", "s1"), now("edited.md", "e2"), now("new.md", "n1"), now("back.md", "b1"), now("back2.md", "b2x")],
    );
    expect(plan).toEqual({
      added: ["new.md"],
      modified: ["edited.md"],
      unchanged: ["same.md"],
      revived: [
        { path: "back.md", modified: false },
        { path: "back2.md", modified: true },
      ],
      removed: ["gone.md"],
      moves: [],
    });
  });

  it("does nothing when nothing changed", () => {
    const plan = planChanges([known("a.md", "1"), known("b.md", "2")], [now("a.md", "1"), now("b.md", "2")]);
    expect(plan).toMatchObject({ added: [], modified: [], removed: [], moves: [], revived: [], unchanged: ["a.md", "b.md"] });
  });

  it("treats a file that came back with the same content under a new name as a move", () => {
    const plan = planChanges([known("old/page.md", "x")], [now("guides/page.md", "x")]);
    expect(plan.moves).toEqual([{ from: "old/page.md", to: "guides/page.md", by: "content" }]);
    expect(plan.added).toEqual([]);
    expect(plan.removed).toEqual([]);
  });

  it("does not call an edit-and-rename a move; that is a removal and an addition", () => {
    const plan = planChanges([known("a.md", "1")], [now("b.md", "2")]);
    expect(plan.moves).toEqual([]);
    expect(plan.added).toEqual(["b.md"]);
    expect(plan.removed).toEqual(["a.md"]);
  });

  it("pairs identical files by file name first, then in path order", () => {
    const plan = planChanges(
      [known("a/intro.md", "same"), known("a/zeta.md", "same"), known("b/other.md", "same")],
      [now("x/zeta.md", "same"), now("x/intro.md", "same"), now("x/third.md", "same")],
    );
    expect(plan.moves).toEqual(
      expect.arrayContaining([
        { from: "a/intro.md", to: "x/intro.md", by: "content" },
        { from: "a/zeta.md", to: "x/zeta.md", by: "content" },
        { from: "b/other.md", to: "x/third.md", by: "content" },
      ]),
    );
    expect(plan.moves).toHaveLength(3);
  });

  it("leaves extras unmatched when counts differ", () => {
    const plan = planChanges([known("a.md", "s")], [now("b.md", "s"), now("c.md", "s")]);
    expect(plan.moves).toHaveLength(1);
    expect(plan.added).toHaveLength(1);
    expect(plan.removed).toEqual([]);
  });

  it("ignores rows with no recorded content when looking for moves", () => {
    const plan = planChanges([known("a.md", null)], [now("b.md", "s")]);
    expect(plan.moves).toEqual([]);
  });

  it("never deletes anything for a file that is still present, whatever the previous commit was", () => {
    // Nothing here depends on history: a listing is a listing.
    const plan = planChanges([known("a.md", "1"), known("b.md", "2")], [now("a.md", "1"), now("b.md", "2")]);
    expect(plan.removed).toEqual([]);
  });

  it("does not remove a page that is already soft-deleted", () => {
    const plan = planChanges([known("a.md", "1", { deleted: true })], []);
    expect(plan.removed).toEqual([]);
  });

  it("partitions both sides exactly, for any pair of states", () => {
    const sha = fc.constantFrom("s1", "s2", "s3", "s4");
    const path = fc.constantFrom("a.md", "b.md", "c/d.md", "c/e.md", "f.md", "g/h.md", "i.md");
    const state = fc.uniqueArray(fc.tuple(path, sha), { selector: ([p]) => p });
    fc.assert(
      fc.property(state, state, fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }), (before, after, deletedFlags) => {
        const knownFiles = before.map(([p, s], i) => known(p, s, { deleted: deletedFlags[i % 7]! }));
        const current = after.map(([p, s]) => now(p, s));
        const plan = planChanges(knownFiles, current);

        // Every current file lands in exactly one place.
        const placed = [...plan.added, ...plan.modified, ...plan.unchanged, ...plan.revived.map((r) => r.path), ...plan.moves.map((m) => m.to)];
        expect([...placed].sort()).toEqual(current.map((c) => c.path).sort());

        // Every live known file is accounted for exactly once.
        const live = knownFiles.filter((k) => !k.deleted).map((k) => k.path);
        const accounted = [
          ...plan.unchanged.filter((p) => live.includes(p)),
          ...plan.modified,
          ...plan.removed,
          ...plan.moves.map((m) => m.from),
        ];
        expect([...accounted].sort()).toEqual([...live].sort());

        // A move is always a real move: content equal, source gone, destination new.
        for (const m of plan.moves) {
          expect(current.find((c) => c.path === m.to)!.sha).toBe(knownFiles.find((k) => k.path === m.from)!.sha);
          expect(current.some((c) => c.path === m.from)).toBe(false);
        }
        // Moves are one to one.
        expect(new Set(plan.moves.map((m) => m.from)).size).toBe(plan.moves.length);
        expect(new Set(plan.moves.map((m) => m.to)).size).toBe(plan.moves.length);
      }),
      { numRuns: 400 },
    );
  });
});

describe("matchMovesById", () => {
  it("turns a removal and an addition that share an id into a move", () => {
    const knownFiles = [known("old.md", "1", { frontMatterId: "page-7" }), known("other.md", "2", { frontMatterId: "page-8" })];
    const plan = planChanges(knownFiles, [now("new.md", "9"), now("other.md", "2")]);
    expect(plan.moves).toEqual([]);
    const matched = matchMovesById(plan, knownFiles, (path) => (path === "new.md" ? "page-7" : null));
    expect(matched.moves).toEqual([{ from: "old.md", to: "new.md", by: "id" }]);
    expect(matched.added).toEqual([]);
    expect(matched.removed).toEqual([]);
  });

  it("leaves unrelated additions and removals alone", () => {
    const knownFiles = [known("old.md", "1", { frontMatterId: "a" })];
    const plan = planChanges(knownFiles, [now("new.md", "9")]);
    const matched = matchMovesById(plan, knownFiles, () => "different");
    expect(matched.added).toEqual(["new.md"]);
    expect(matched.removed).toEqual(["old.md"]);
  });

  it("uses an id only once", () => {
    const knownFiles = [known("old.md", "1", { frontMatterId: "dup" })];
    const plan = planChanges(knownFiles, [now("n1.md", "8"), now("n2.md", "9")]);
    const matched = matchMovesById(plan, knownFiles, () => "dup");
    expect(matched.moves).toHaveLength(1);
    expect(matched.added).toHaveLength(1);
  });
});
