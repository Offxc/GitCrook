import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, type AudienceMode } from "@gitcrook/db";
import { makeOrg, makeSite, makeUser, resetDatabase } from "../../../tests/support/factory";
import { hashSitePassword, resolveVisitorAccess, signPasswordProof, verifySitePassword } from "./visitorAccess";

beforeEach(resetDatabase);

async function siteIn(audienceMode: AudienceMode) {
  const member = await makeUser();
  const org = await makeOrg([{ user: member, role: "READER" }]);
  const { site } = await makeSite({ organizationId: org.id, audienceMode });
  return { site, member, org };
}

const anonymous = { userId: null, passwordProofCookie: undefined, shareLinkToken: undefined };

describe("resolveVisitorAccess", () => {
  it("lets everyone into a public site", async () => {
    const { site } = await siteIn("PUBLIC");
    expect(await resolveVisitorAccess({ site, ...anonymous })).toEqual({ status: "allow" });
  });

  it("denies anonymous visitors to a private site and lets members in", async () => {
    const { site, member } = await siteIn("PRIVATE");
    expect(await resolveVisitorAccess({ site, ...anonymous })).toEqual({ status: "denied" });
    expect(await resolveVisitorAccess({ site, ...anonymous, userId: member.id })).toEqual({ status: "allow" });
    const stranger = await makeUser();
    expect(await resolveVisitorAccess({ site, ...anonymous, userId: stranger.id })).toEqual({ status: "denied" });
  });

  describe("share links", () => {
    it("admit a visitor with a live token for that site", async () => {
      const { site, member } = await siteIn("PRIVATE");
      await prisma.shareLink.create({ data: { siteId: site.id, token: "live", createdById: member.id } });
      expect(await resolveVisitorAccess({ site, ...anonymous, shareLinkToken: "live" })).toEqual({ status: "allow" });
    });

    it("refuse unknown, revoked and expired tokens", async () => {
      const { site, member } = await siteIn("PRIVATE");
      await prisma.shareLink.create({ data: { siteId: site.id, token: "revoked", createdById: member.id, revokedAt: new Date() } });
      await prisma.shareLink.create({ data: { siteId: site.id, token: "expired", createdById: member.id, expiresAt: new Date(Date.now() - 1000) } });
      for (const token of ["nope", "revoked", "expired"]) {
        expect(await resolveVisitorAccess({ site, ...anonymous, shareLinkToken: token })).toEqual({ status: "denied" });
      }
    });

    it("do not work on a different site", async () => {
      const a = await siteIn("PRIVATE");
      const b = await siteIn("PRIVATE");
      await prisma.shareLink.create({ data: { siteId: a.site.id, token: "a-only", createdById: a.member.id } });
      expect(await resolveVisitorAccess({ site: b.site, ...anonymous, shareLinkToken: "a-only" })).toEqual({ status: "denied" });
    });
  });

  describe("password sites", () => {
    async function passwordSite(password = "correct horse") {
      const ctx = await siteIn("PASSWORD");
      await prisma.sitePassword.create({ data: { siteId: ctx.site.id, passwordHash: await hashSitePassword(password) } });
      return ctx;
    }

    it("asks anonymous visitors for the password", async () => {
      const { site } = await passwordSite();
      expect(await resolveVisitorAccess({ site, ...anonymous })).toEqual({ status: "passwordRequired" });
    });

    it("verifies the password and accepts the proof it yields", async () => {
      const { site } = await passwordSite("s3cret");
      const bad = await verifySitePassword(site.id, "wrong", "ip-1");
      expect(bad).toMatchObject({ ok: false, rateLimited: false });
      const good = await verifySitePassword(site.id, "s3cret", "ip-1");
      expect(good).toMatchObject({ ok: true, version: 1 });
      const proof = signPasswordProof(site.id, good.version);
      expect(await resolveVisitorAccess({ site, ...anonymous, passwordProofCookie: proof })).toEqual({ status: "allow" });
    });

    it("rejects a proof once the password version changes (the S2 fix)", async () => {
      const { site } = await passwordSite();
      const proof = signPasswordProof(site.id, 1);
      expect(await resolveVisitorAccess({ site, ...anonymous, passwordProofCookie: proof })).toEqual({ status: "allow" });
      await prisma.sitePassword.update({ where: { siteId: site.id }, data: { version: { increment: 1 } } });
      expect(await resolveVisitorAccess({ site, ...anonymous, passwordProofCookie: proof })).toEqual({ status: "passwordRequired" });
    });

    it("rejects a proof minted for another site", async () => {
      const a = await passwordSite();
      const b = await passwordSite();
      const proof = signPasswordProof(a.site.id, 1);
      expect(await resolveVisitorAccess({ site: b.site, ...anonymous, passwordProofCookie: proof })).toEqual({ status: "passwordRequired" });
    });

    it("cannot be proven when no password is set", async () => {
      const { site } = await siteIn("PASSWORD");
      expect(await resolveVisitorAccess({ site, ...anonymous, passwordProofCookie: signPasswordProof(site.id, 1) })).toEqual({ status: "passwordRequired" });
      expect(await verifySitePassword(site.id, "anything", "ip")).toMatchObject({ ok: false });
    });

    it("lets members straight in without the password", async () => {
      const { site, member } = await passwordSite();
      expect(await resolveVisitorAccess({ site, ...anonymous, userId: member.id })).toEqual({ status: "allow" });
    });

    it("rate-limits guesses per visitor, not per site", async () => {
      const { site } = await passwordSite();
      for (let i = 0; i < 10; i++) expect((await verifySitePassword(site.id, "nope", "attacker")).rateLimited).toBe(false);
      expect((await verifySitePassword(site.id, "nope", "attacker")).rateLimited).toBe(true);
      // The attacker's lockout must not lock out a different visitor.
      expect((await verifySitePassword(site.id, "nope", "someone-else")).rateLimited).toBe(false);
    });
  });
});

void vi;
