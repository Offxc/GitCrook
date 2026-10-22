import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { makeOrg, makePage, makeSite, makeUser, resetDatabase } from "../../../tests/support/factory";
import { canUserDoX, getOrgRole, resolveEffectiveRole, ROLE_RANK, type Action } from "./rbac";

beforeEach(resetDatabase);

const ALL_ACTIONS: Action[] = [
  "content.view",
  "content.comment",
  "content.edit",
  "content.mergeChangeRequest",
  "content.manageSpaces",
  "site.viewAnalytics",
  "site.manageSettings",
  "site.manageMembers",
  "org.manageMembers",
];

async function world() {
  const owner = await makeUser();
  const org = await makeOrg([{ user: owner, role: "ADMIN" }]);
  const built = await makeSite({ organizationId: org.id });
  const page = await makePage({ variantId: built.variant.id, siteId: built.site.id, slug: "p" });
  const section = built.sections[0]!;
  const space = await prisma.space.findFirstOrThrow({ where: { sectionId: section.id } });
  return { org, site: built.site, section, space, page, owner };
}

describe("role matrix", () => {
  // What each role may do, spelled out rather than derived from ROLE_RANK so a change to the
  // thresholds in rbac.ts shows up here as a deliberate edit.
  const expected: Record<string, Action[]> = {
    GUEST: [],
    READER: ["content.view"],
    COMMENTER: ["content.view", "content.comment"],
    EDITOR: ["content.view", "content.comment", "content.edit", "site.viewAnalytics"],
    REVIEWER: ["content.view", "content.comment", "content.edit", "site.viewAnalytics", "content.mergeChangeRequest"],
    CREATOR: ["content.view", "content.comment", "content.edit", "site.viewAnalytics", "content.mergeChangeRequest", "content.manageSpaces"],
    ADMIN: ALL_ACTIONS,
  };

  it.each(Object.entries(expected))("%s", async (role, allowed) => {
    const w = await world();
    const user = await makeUser();
    await prisma.membership.create({ data: { organizationId: w.org.id, userId: user.id, role: role as never } });
    for (const action of ALL_ACTIONS) {
      for (const resource of [
        { type: "site", id: w.site.id },
        { type: "page", id: w.page.id },
        { type: "org", id: w.org.id },
      ] as const) {
        expect(await canUserDoX(user.id, action, resource), `${role} ${action} on ${resource.type}`).toBe(allowed.includes(action));
      }
    }
  });

  it("ranks the roles in a strict order", () => {
    const order = ["GUEST", "READER", "COMMENTER", "EDITOR", "REVIEWER", "CREATOR", "ADMIN"] as const;
    for (let i = 1; i < order.length; i++) expect(ROLE_RANK[order[i]!]).toBeGreaterThan(ROLE_RANK[order[i - 1]!]);
  });
});

describe("deny by default", () => {
  it("denies anonymous callers", async () => {
    const w = await world();
    for (const id of [null, undefined, ""]) expect(await canUserDoX(id, "content.view", { type: "site", id: w.site.id })).toBe(false);
  });

  it("denies a signed-in user with no membership anywhere", async () => {
    const w = await world();
    const stranger = await makeUser();
    expect(await resolveEffectiveRole(stranger.id, { type: "page", id: w.page.id })).toBeNull();
    expect(await canUserDoX(stranger.id, "content.view", { type: "site", id: w.site.id })).toBe(false);
  });

  it("denies a member of a different organization", async () => {
    const w = await world();
    const otherOrgAdmin = await makeUser();
    await makeOrg([{ user: otherOrgAdmin, role: "ADMIN" }]);
    expect(await canUserDoX(otherOrgAdmin.id, "content.edit", { type: "site", id: w.site.id })).toBe(false);
    expect(await canUserDoX(otherOrgAdmin.id, "org.manageMembers", { type: "org", id: w.org.id })).toBe(false);
  });

  it("denies a resource that does not exist", async () => {
    const w = await world();
    for (const type of ["site", "section", "space", "page"] as const) {
      expect(await canUserDoX(w.owner.id, "content.view", { type, id: "does-not-exist" })).toBe(false);
    }
  });
});

describe("overrides", () => {
  it("a page override beats the membership, upward and downward", async () => {
    const w = await world();
    const user = await makeUser();
    await prisma.membership.create({ data: { organizationId: w.org.id, userId: user.id, role: "READER" } });
    const other = await makePage({ variantId: (await prisma.variant.findFirstOrThrow({ where: { space: { section: { siteId: w.site.id } } } })).id, siteId: w.site.id, slug: "q" });

    await prisma.pagePermission.create({ data: { pageId: w.page.id, userId: user.id, role: "EDITOR" } });
    expect(await canUserDoX(user.id, "content.edit", { type: "page", id: w.page.id })).toBe(true);
    expect(await canUserDoX(user.id, "content.edit", { type: "page", id: other.id })).toBe(false); // only that page
    expect(await canUserDoX(user.id, "content.edit", { type: "site", id: w.site.id })).toBe(false);

    const admin = await makeUser();
    await prisma.membership.create({ data: { organizationId: w.org.id, userId: admin.id, role: "ADMIN" } });
    await prisma.pagePermission.create({ data: { pageId: w.page.id, userId: admin.id, role: "READER" } });
    expect(await canUserDoX(admin.id, "content.edit", { type: "page", id: w.page.id })).toBe(false); // demoted on that page
    expect(await canUserDoX(admin.id, "content.edit", { type: "site", id: w.site.id })).toBe(true);
  });

  it("the most specific override wins: page > space > section > site > membership", async () => {
    const w = await world();
    const user = await makeUser();
    await prisma.membership.create({ data: { organizationId: w.org.id, userId: user.id, role: "READER" } });
    const role = () => resolveEffectiveRole(user.id, { type: "page", id: w.page.id });

    expect(await role()).toBe("READER");
    await prisma.sitePermission.create({ data: { siteId: w.site.id, userId: user.id, role: "COMMENTER" } });
    expect(await role()).toBe("COMMENTER");
    await prisma.sectionPermission.create({ data: { sectionId: w.section.id, userId: user.id, role: "EDITOR" } });
    expect(await role()).toBe("EDITOR");
    await prisma.spacePermission.create({ data: { spaceId: w.space.id, userId: user.id, role: "CREATOR" } });
    expect(await role()).toBe("CREATOR");
    await prisma.pagePermission.create({ data: { pageId: w.page.id, userId: user.id, role: "REVIEWER" } });
    expect(await role()).toBe("REVIEWER");
  });

  it("an override without any membership still grants nothing outside what it names", async () => {
    // Overrides refine an org member's access; they are looked up before the membership, so a stray
    // override row *would* grant access. This pins the behaviour so a change is a conscious one.
    const w = await world();
    const guest = await makeUser();
    await prisma.sitePermission.create({ data: { siteId: w.site.id, userId: guest.id, role: "READER" } });
    expect(await canUserDoX(guest.id, "content.view", { type: "site", id: w.site.id })).toBe(true);
    expect(await canUserDoX(guest.id, "org.manageMembers", { type: "org", id: w.org.id })).toBe(false);
    expect(await getOrgRole(guest.id, w.org.id)).toBeNull();
  });
});

describe("getOrgRole", () => {
  it("returns the membership role, or null", async () => {
    const w = await world();
    expect(await getOrgRole(w.owner.id, w.org.id)).toBe("ADMIN");
    expect(await getOrgRole((await makeUser()).id, w.org.id)).toBeNull();
    expect(await getOrgRole(null, w.org.id)).toBeNull();
  });
});
