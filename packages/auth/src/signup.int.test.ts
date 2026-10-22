import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@gitcrook/db";
import { makeOrg, makeUser, resetDatabase } from "../../../tests/support/factory";

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** `getEnv()` caches per module instance, so each scenario loads a fresh copy under its own environment. */
async function loadSignup(env: { SIGNUP_MODE?: string; ALLOWED_DISCORD_IDS?: string }) {
  vi.stubEnv("SIGNUP_MODE", env.SIGNUP_MODE ?? "closed");
  vi.stubEnv("ALLOWED_DISCORD_IDS", env.ALLOWED_DISCORD_IDS ?? "");
  vi.resetModules();
  return import("./signup");
}

const candidate = (over: Partial<{ discordId: string; email: string | null; emailVerified: boolean }> = {}) => ({
  discordId: "900",
  email: "new@example.test",
  emailVerified: true,
  ...over,
});

async function invite(email: string, over: { expiresAt?: Date } = {}) {
  const org = await makeOrg();
  await prisma.invitation.create({
    data: { organizationId: org.id, email, role: "EDITOR", expiresAt: over.expiresAt ?? new Date(Date.now() + 86_400_000) },
  });
  return org;
}

describe("decideSignIn", () => {
  it("lets an existing account in whatever the mode", async () => {
    const user = await makeUser();
    await prisma.account.create({ data: { userId: user.id, type: "oauth", provider: "discord", providerAccountId: "900" } });
    const { decideSignIn } = await loadSignup({ SIGNUP_MODE: "closed", ALLOWED_DISCORD_IDS: "1" });
    expect(await decideSignIn(candidate())).toBe("existing");
  });

  it("admits anyone when sign-up is open", async () => {
    const { decideSignIn } = await loadSignup({ SIGNUP_MODE: "open" });
    expect(await decideSignIn(candidate())).toBe("open");
  });

  it("admits an allow-listed Discord id", async () => {
    await makeUser();
    const { decideSignIn } = await loadSignup({ ALLOWED_DISCORD_IDS: "111, 900" });
    expect(await decideSignIn(candidate())).toBe("allowlisted");
  });

  it("makes the first sign-in on an empty instance its owner", async () => {
    const { decideSignIn } = await loadSignup({});
    expect(await decideSignIn(candidate())).toBe("first-owner");
  });

  it("does not offer first-owner once anyone has an account", async () => {
    await makeUser();
    const { decideSignIn } = await loadSignup({});
    expect(await decideSignIn(candidate())).toBe("denied");
  });

  it("switches first-owner off when an allow-list exists, so a stranger can't win the race", async () => {
    const { decideSignIn } = await loadSignup({ ALLOWED_DISCORD_IDS: "111" });
    expect(await decideSignIn(candidate())).toBe("denied");
  });

  it("admits a verified email holding a live invitation, case-insensitively", async () => {
    await makeUser();
    await invite("new@example.test");
    const { decideSignIn } = await loadSignup({});
    expect(await decideSignIn(candidate({ email: "New@Example.TEST" }))).toBe("invited");
  });

  it("does not honour an invitation for an unverified email", async () => {
    await makeUser();
    await invite("new@example.test");
    const { decideSignIn } = await loadSignup({});
    expect(await decideSignIn(candidate({ emailVerified: false }))).toBe("denied");
  });

  it("does not honour an expired invitation or a different address", async () => {
    await makeUser();
    await invite("new@example.test", { expiresAt: new Date(Date.now() - 1000) });
    await invite("someone-else@example.test");
    const { decideSignIn } = await loadSignup({});
    expect(await decideSignIn(candidate())).toBe("denied");
  });

  it("denies a stranger with no email", async () => {
    await makeUser();
    const { decideSignIn } = await loadSignup({});
    expect(await decideSignIn(candidate({ email: null }))).toBe("denied");
  });
});

describe("redeemInvitations", () => {
  const verified = () => new Date();

  it("turns live invitations into memberships and deletes them", async () => {
    const orgA = await invite("new@example.test");
    const orgB = await invite("new@example.test");
    const user = await makeUser({ email: "new@example.test", emailVerified: verified() });
    const { redeemInvitations } = await loadSignup({});

    expect(await redeemInvitations(user)).toBe(2);
    const memberships = await prisma.membership.findMany({ where: { userId: user.id }, orderBy: { organizationId: "asc" } });
    expect(memberships.map((m) => m.organizationId).sort()).toEqual([orgA.id, orgB.id].sort());
    expect(memberships.every((m) => m.role === "EDITOR")).toBe(true);
    expect(await prisma.invitation.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "member.joinViaInvitation" } })).toBe(2);
  });

  it("does nothing for an unverified email", async () => {
    await invite("new@example.test");
    const user = await makeUser({ email: "new@example.test", emailVerified: null });
    const { redeemInvitations } = await loadSignup({});
    expect(await redeemInvitations(user)).toBe(0);
    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.invitation.count()).toBe(1);
  });

  it("ignores expired invitations and other addresses", async () => {
    await invite("new@example.test", { expiresAt: new Date(Date.now() - 1000) });
    await invite("other@example.test");
    const user = await makeUser({ email: "new@example.test", emailVerified: verified() });
    const { redeemInvitations } = await loadSignup({});
    expect(await redeemInvitations(user)).toBe(0);
    expect(await prisma.membership.count()).toBe(0);
  });

  it("is safe when the user is already a member", async () => {
    const org = await invite("new@example.test");
    const user = await makeUser({ email: "new@example.test", emailVerified: verified() });
    await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: "ADMIN" } });
    const { redeemInvitations } = await loadSignup({});
    await redeemInvitations(user);
    expect((await prisma.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org.id, userId: user.id } } })).role).toBe("ADMIN");
  });

  it("does nothing for a user with no email", async () => {
    const { redeemInvitations } = await loadSignup({});
    expect(await redeemInvitations({ id: "x", email: null, emailVerified: new Date() })).toBe(0);
  });
});
