"use server";

import { z } from "zod";
import { prisma } from "@gitcrook/db";
import { getVisitorAccess } from "./visitorAccess";
import { checkRateLimit } from "@gitcrook/shared/server";
import { computeVisitorHash } from "@/lib/analytics/track";
import { readRequestMeta } from "@/lib/analytics/requestMeta";

export interface FeedbackState {
  error?: string;
  submitted?: boolean;
}

const FeedbackSchema = z.object({
  pageId: z.string().min(1),
  rating: z.coerce.number().int().min(0).max(1),
  feedback: z.string().max(2000).optional(),
});

/** Visitor-facing (anonymous, like passwordGateActions.ts) — thumbs up/down plus optional free text, matching GitBook's "was this helpful?" widget. */
export async function submitPageFeedback(_prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const parsed = FeedbackSchema.safeParse({
    pageId: formData.get("pageId"),
    rating: formData.get("rating"),
    feedback: formData.get("feedback") || undefined,
  });
  if (!parsed.success) return { error: "Something went wrong — try again." };

  const page = await prisma.page.findUnique({ where: { id: parsed.data.pageId }, include: { site: true } });
  if (!page || page.isDraft) return { error: "Page not found." };

  // A rating is a write against a page, so it needs the same access as reading it:
  // knowing a page id (it appears in the page's HTML) must not be enough to rate a
  // page on a site you can't see.
  const access = await getVisitorAccess(page.site);
  if (access.status !== "allow") return { error: "Page not found." };

  const meta = await readRequestMeta();
  const rl = checkRateLimit(`feedback:${page.siteId}:${meta.ip}`, 10, 60_000);
  if (!rl.allowed) return { error: "Too many submissions — try again in a minute." };

  // One rating per visitor per page per day: a repeat submission replaces the
  // earlier one instead of stacking, so the "helpful" percentage can't be inflated
  // by clicking.
  const visitorHash = computeVisitorHash(page.siteId, meta.ip, meta.userAgent);
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const existing = await prisma.pageRating.findFirst({ where: { pageId: page.id, visitorHash, createdAt: { gte: startOfDay } }, select: { id: true } });
  const data = { rating: parsed.data.rating, feedback: parsed.data.feedback ?? null };
  if (existing) await prisma.pageRating.update({ where: { id: existing.id }, data });
  else await prisma.pageRating.create({ data: { pageId: page.id, visitorHash, ...data } });

  return { submitted: true };
}
