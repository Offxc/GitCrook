import { prisma, Role } from "@voiddocs/db";

/**
 * Centralized authorization. This is the ONLY place in the codebase that should
 * decide whether a user may do something (OWASP A01 — Broken Access Control).
 * Every Server Action and Route Handler must call `canUserDoX` before acting; a
 * hidden button in the UI is never itself access control, and a client-supplied
 * role/orgId is never trusted — this always re-derives the answer from the
 * session's userId plus a fresh DB lookup.
 *
 * Anonymous doc-site *visitors* (as opposed to signed-in org members) never have
 * a userId at all — they're deliberately handled by a separate function,
 * `resolveVisitorAccess` (added in Phase 5 alongside public/private/password/
 * share-link sites), so a null userId can never accidentally fall through into
 * an "allow" branch meant for members.
 */

export const ROLE_RANK: Record<Role, number> = {
  GUEST: 0,
  READER: 1,
  COMMENTER: 2,
  EDITOR: 3,
  REVIEWER: 4,
  CREATOR: 5,
  ADMIN: 6,
};

export type Action =
  | "content.view"
  | "content.comment"
  | "content.edit"
  | "content.mergeChangeRequest" // reserved for the deferred change-request workflow
  | "content.manageSpaces" // create/delete space/section/site, manage content-level perms
  | "site.viewAnalytics"
  | "site.manageSettings"
  | "site.manageMembers"
  | "org.manageMembers";

const ACTION_MIN_ROLE: Record<Action, Role> = {
  "content.view": "READER",
  "content.comment": "COMMENTER",
  "content.edit": "EDITOR",
  "content.mergeChangeRequest": "REVIEWER",
  "content.manageSpaces": "CREATOR",
  "site.viewAnalytics": "EDITOR",
  "site.manageSettings": "ADMIN",
  "site.manageMembers": "ADMIN",
  "org.manageMembers": "ADMIN",
};

export type ResourceRef =
  | { type: "org"; id: string }
  | { type: "site"; id: string }
  | { type: "section"; id: string }
  | { type: "space"; id: string }
  | { type: "page"; id: string };

interface AncestorChain {
  organizationId: string;
  siteId?: string;
  sectionId?: string;
  spaceId?: string;
  pageId?: string;
}

async function loadAncestorChain(resource: ResourceRef): Promise<AncestorChain | null> {
  switch (resource.type) {
    case "org":
      return { organizationId: resource.id };
    case "site": {
      const site = await prisma.site.findUnique({ where: { id: resource.id }, select: { organizationId: true } });
      return site ? { organizationId: site.organizationId, siteId: resource.id } : null;
    }
    case "section": {
      const section = await prisma.section.findUnique({
        where: { id: resource.id },
        select: { id: true, site: { select: { id: true, organizationId: true } } },
      });
      return section ? { organizationId: section.site.organizationId, siteId: section.site.id, sectionId: section.id } : null;
    }
    case "space": {
      const space = await prisma.space.findUnique({
        where: { id: resource.id },
        select: { id: true, section: { select: { id: true, site: { select: { id: true, organizationId: true } } } } },
      });
      return space
        ? {
            organizationId: space.section.site.organizationId,
            siteId: space.section.site.id,
            sectionId: space.section.id,
            spaceId: space.id,
          }
        : null;
    }
    case "page": {
      const page = await prisma.page.findUnique({
        where: { id: resource.id },
        select: {
          id: true,
          variant: { select: { space: { select: { id: true, section: { select: { id: true, site: { select: { id: true, organizationId: true } } } } } } } },
        },
      });
      if (!page) return null;
      const space = page.variant.space;
      return {
        organizationId: space.section.site.organizationId,
        siteId: space.section.site.id,
        sectionId: space.section.id,
        spaceId: space.id,
        pageId: page.id,
      };
    }
  }
}

/**
 * Walks Page -> Space -> Section -> Site -> Membership, most-specific override
 * wins. No Membership row at all means the user isn't a member of the
 * organization at all, which means no access — deny by default.
 */
export async function resolveEffectiveRole(userId: string, resource: ResourceRef): Promise<Role | null> {
  const chain = await loadAncestorChain(resource);
  if (!chain) return null;

  if (chain.pageId) {
    const p = await prisma.pagePermission.findUnique({ where: { pageId_userId: { pageId: chain.pageId, userId } } });
    if (p) return p.role;
  }
  if (chain.spaceId) {
    const p = await prisma.spacePermission.findUnique({ where: { spaceId_userId: { spaceId: chain.spaceId, userId } } });
    if (p) return p.role;
  }
  if (chain.sectionId) {
    const p = await prisma.sectionPermission.findUnique({ where: { sectionId_userId: { sectionId: chain.sectionId, userId } } });
    if (p) return p.role;
  }
  if (chain.siteId) {
    const p = await prisma.sitePermission.findUnique({ where: { siteId_userId: { siteId: chain.siteId, userId } } });
    if (p) return p.role;
  }
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId: chain.organizationId, userId } },
  });
  return membership?.role ?? null;
}

export async function canUserDoX(userId: string | null | undefined, action: Action, resource: ResourceRef): Promise<boolean> {
  if (!userId) return false;
  const role = await resolveEffectiveRole(userId, resource);
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[ACTION_MIN_ROLE[action]];
}

/** Convenience for "is this user a member of this org at all" checks (e.g. dashboard access). */
export async function getOrgRole(userId: string | null | undefined, organizationId: string): Promise<Role | null> {
  if (!userId) return null;
  const membership = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  return membership?.role ?? null;
}
