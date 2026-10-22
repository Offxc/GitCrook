import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { makeOrg, makePage, makeSite, makeUser, resetDatabase } from "../../../../tests/support/factory";
import { commitPageContent } from "./commitPageContent";

beforeEach(resetDatabase);

async function fixture() {
  const user = await makeUser();
  const org = await makeOrg([{ user, role: "EDITOR" }]);
  const { site, variant } = await makeSite({ organizationId: org.id });
  const page = await makePage({ variantId: variant.id, siteId: site.id, slug: "p", content: [{ type: "paragraph", content: "v1" }] });
  return { user, page };
}

const doc = (text: string) => [{ type: "paragraph", content: text }];

describe("commitPageContent", () => {
  it("writes when the version matches and returns the next one", async () => {
    const { user, page } = await fixture();
    const next = await commitPageContent({ pageId: page.id, expectedVersion: page.contentVersion, content: doc("v2"), contentText: "v2", userId: user.id, snapshot: false });
    expect(next).toBe(page.contentVersion + 1);
    const stored = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(stored.content).toEqual(doc("v2"));
    expect(stored.contentText).toBe("v2");
    expect(stored.contentVersion).toBe(next);
  });

  it("refuses a stale version and leaves the page untouched", async () => {
    const { user, page } = await fixture();
    await commitPageContent({ pageId: page.id, expectedVersion: 1, content: doc("v2"), contentText: "v2", userId: user.id, snapshot: false });
    const stale = await commitPageContent({ pageId: page.id, expectedVersion: 1, content: doc("lost"), contentText: "lost", userId: user.id, snapshot: false });
    expect(stale).toBeNull();
    expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).content).toEqual(doc("v2"));
  });

  it("returns null for a page that has been deleted", async () => {
    const { user, page } = await fixture();
    await prisma.page.delete({ where: { id: page.id } });
    expect(await commitPageContent({ pageId: page.id, expectedVersion: 1, content: [], contentText: "", userId: user.id, snapshot: true })).toBeNull();
  });

  it("keeps the replaced content as a history snapshot when asked", async () => {
    const { user, page } = await fixture();
    await commitPageContent({ pageId: page.id, expectedVersion: 1, content: doc("v2"), contentText: "v2", userId: user.id, snapshot: true });
    const versions = await prisma.pageVersion.findMany({ where: { pageId: page.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]!.content).toEqual(doc("v1")); // the content that was replaced
    expect(versions[0]!.version).toBe(1);
    expect(versions[0]!.createdById).toBe(user.id);
  });

  it("does not snapshot when not asked, nor when the write is refused", async () => {
    const { user, page } = await fixture();
    await commitPageContent({ pageId: page.id, expectedVersion: 1, content: doc("a"), contentText: "a", userId: user.id, snapshot: false });
    await commitPageContent({ pageId: page.id, expectedVersion: 1, content: doc("b"), contentText: "b", userId: user.id, snapshot: true });
    expect(await prisma.pageVersion.count()).toBe(0);
  });

  // The race D1/C6 is about: two tabs saving from the same version at the same moment.
  it("lets exactly one of 20 racing saves win", async () => {
    const { user, page } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        commitPageContent({ pageId: page.id, expectedVersion: 1, content: doc(`writer-${i}`), contentText: `writer-${i}`, userId: user.id, snapshot: true }),
      ),
    );
    expect(results.filter((r) => r !== null)).toEqual([2]);
    const stored = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(stored.contentVersion).toBe(2);
    expect(await prisma.pageVersion.count({ where: { pageId: page.id } })).toBe(1);
  });
});
