"use server";

import { randomBytes } from "node:crypto";
import dns from "node:dns";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@voiddocs/db";
import { canUserDoX } from "@voiddocs/auth";
import { requireSite } from "@/lib/dashboard/site";
import { VERIFICATION_PREFIX, type DomainActionState } from "./shared";

const HostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^(?!-)[a-z0-9-]{1,63}(\.(?!-)[a-z0-9-]{1,63})+$/, "Enter a valid domain, like docs.example.com");

async function assertCanManage(orgSlug: string, siteId: string) {
  const ctx = await requireSite(orgSlug, siteId);
  const allowed = await canUserDoX(ctx.userId, "site.manageSettings", { type: "site", id: ctx.site.id });
  if (!allowed) throw new Error("You don't have permission to manage this site's domain.");
  return ctx;
}

export async function addDomain(orgSlug: string, siteId: string, _prev: DomainActionState, formData: FormData): Promise<DomainActionState> {
  const ctx = await assertCanManage(orgSlug, siteId);

  const parsed = HostnameSchema.safeParse(formData.get("hostname"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid domain" };
  const hostname = parsed.data;

  if (hostname === process.env.ROOT_DOMAIN || hostname.endsWith(`.${process.env.ROOT_DOMAIN}`)) {
    return { error: "Can't use the platform's own root domain as a custom domain." };
  }

  const taken = await prisma.customDomain.findUnique({ where: { hostname } });
  if (taken) return { error: "That domain is already in use." };

  const verificationToken = randomBytes(16).toString("hex");
  await prisma.customDomain.create({
    data: { siteId: ctx.site.id, hostname, verificationToken },
  });

  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "domain.add", targetType: "Site", targetId: ctx.site.id, metadata: { hostname } },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/domain`);
  return {};
}

export async function verifyDomain(orgSlug: string, siteId: string): Promise<DomainActionState> {
  const ctx = await assertCanManage(orgSlug, siteId);
  const domain = await prisma.customDomain.findUnique({ where: { siteId: ctx.site.id } });
  if (!domain) return { error: "No domain configured yet." };

  const recordName = `${VERIFICATION_PREFIX}.${domain.hostname}`;
  const expected = `voiddocs-verify=${domain.verificationToken}`;

  let found = false;
  try {
    // A DNS TXT lookup only — never an HTTP fetch to the candidate domain, so
    // this step carries no SSRF risk regardless of what hostname is submitted.
    const records = await dns.promises.resolveTxt(recordName);
    found = records.some((chunks) => chunks.join("").trim() === expected);
  } catch {
    found = false; // NXDOMAIN / no TXT record yet — not verified, not a crash
  }

  if (!found) {
    await prisma.customDomain.update({
      where: { siteId: ctx.site.id },
      data: { lastCheckedAt: new Date(), consecutiveFailures: { increment: 1 } },
    });
    return { error: `TXT record not found yet at ${recordName}. DNS changes can take a few minutes to propagate.` };
  }

  await prisma.customDomain.update({
    where: { siteId: ctx.site.id },
    data: { status: "ACTIVE", verifiedAt: new Date(), lastCheckedAt: new Date(), consecutiveFailures: 0 },
  });

  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "domain.verify", targetType: "Site", targetId: ctx.site.id, metadata: { hostname: domain.hostname } },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/domain`);
  return {};
}

export async function removeDomain(orgSlug: string, siteId: string): Promise<DomainActionState> {
  const ctx = await assertCanManage(orgSlug, siteId);
  const domain = await prisma.customDomain.findUnique({ where: { siteId: ctx.site.id } });
  if (!domain) return {};

  await prisma.customDomain.delete({ where: { siteId: ctx.site.id } });
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "domain.remove", targetType: "Site", targetId: ctx.site.id, metadata: { hostname: domain.hostname } },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/domain`);
  return {};
}
