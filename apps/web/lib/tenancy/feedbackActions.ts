"use server";

import { z } from "zod";
import { prisma } from "@gitcrook/db";
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

  const page = await prisma.page.findUnique({ where: { id: parsed.data.pageId }, select: { id: true, siteId: true } });
  if (!page) return { error: "Page not found." };

  const meta = await readRequestMeta();
  const rl = checkRateLimit(`feedback:${page.siteId}:${meta.ip}`, 10, 60_000);
  if (!rl.allowed) return { error: "Too many submissions — try again in a minute." };

  await prisma.pageRating.create({
    data: {
      pageId: page.id,
      rating: parsed.data.rating,
      feedback: parsed.data.feedback ?? null,
      visitorHash: computeVisitorHash(page.siteId, meta.ip, meta.userAgent),
    },
  });

  return { submitted: true };
}
