import { prisma } from "@gitcrook/db";
import { getEnv } from "@gitcrook/shared/server";

/**
 * Sign-up is closed unless the operator opens it, because every new account gets
 * an organization that can publish pages under the platform's own domain — open by
 * default means anyone can host anything there.
 *
 * Existing accounts are never affected: this only decides whether a *new* Discord
 * identity may create an account.
 */
export type SignInDecision = "existing" | "open" | "allowlisted" | "first-owner" | "invited" | "denied";

export interface SignInCandidate {
  /** The Discord user id (a snowflake). */
  discordId: string;
  email: string | null | undefined;
  /** Discord's own `verified` flag for that email. An unverified address proves nothing, so it never matches an invitation. */
  emailVerified: boolean;
}

export function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function decideSignIn(candidate: SignInCandidate): Promise<SignInDecision> {
  const existing = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: "discord", providerAccountId: candidate.discordId } },
    select: { id: true },
  });
  if (existing) return "existing";

  const env = getEnv();
  if (env.SIGNUP_MODE === "open") return "open";

  const allowList = parseAllowList(env.ALLOWED_DISCORD_IDS);
  if (allowList.includes(candidate.discordId)) return "allowlisted";

  // The first person on an empty instance owns it — unless the operator named the
  // allowed people explicitly, in which case nobody else gets to race them to it.
  if (allowList.length === 0 && (await prisma.user.count()) === 0) return "first-owner";

  if (candidate.email && candidate.emailVerified) {
    const invitation = await prisma.invitation.findFirst({
      where: { email: candidate.email.toLowerCase(), expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (invitation) return "invited";
  }

  return "denied";
}

/**
 * Turns a new user's pending invitations into memberships. Returns how many were
 * redeemed. Only a *verified* email may redeem: otherwise anyone could register a
 * Discord account with someone else's address and walk into their organization.
 */
export async function redeemInvitations(user: { id: string; email?: string | null; emailVerified?: Date | null }): Promise<number> {
  if (!user.email || !user.emailVerified) return 0;

  const invitations = await prisma.invitation.findMany({
    where: { email: user.email.toLowerCase(), expiresAt: { gt: new Date() } },
  });
  if (invitations.length === 0) return 0;

  await prisma.$transaction([
    prisma.membership.createMany({
      data: invitations.map((i) => ({ organizationId: i.organizationId, userId: user.id, role: i.role })),
      skipDuplicates: true,
    }),
    prisma.invitation.deleteMany({ where: { id: { in: invitations.map((i) => i.id) } } }),
    ...invitations.map((i) =>
      prisma.auditLog.create({
        data: { organizationId: i.organizationId, actorId: user.id, action: "member.joinViaInvitation", targetType: "User", targetId: user.id, metadata: { role: i.role } },
      }),
    ),
  ]);
  return invitations.length;
}
