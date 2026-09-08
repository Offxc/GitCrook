"use client";

import { useActionState, useState } from "react";
import { submitPageFeedback, type FeedbackState } from "@/lib/tenancy/feedbackActions";

export function PageFeedback({ pageId }: { pageId: string }) {
  const [rating, setRating] = useState<0 | 1 | null>(null);
  const [state, formAction, pending] = useActionState<FeedbackState, FormData>(submitPageFeedback, {});

  if (state.submitted) {
    return <p className="mt-10 border-t border-site-border pt-6 text-sm text-site-ink-muted">Thanks for your feedback!</p>;
  }

  return (
    <div className="mt-10 border-t border-site-border pt-6">
      {rating === null ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-site-ink-muted">Was this page helpful?</span>
          <button
            type="button"
            onClick={() => setRating(1)}
            aria-label="Yes, helpful"
            className="rounded-md border border-site-border p-1.5 text-site-ink-muted transition hover:border-site-primary hover:text-site-primary"
          >
            <ThumbIcon />
          </button>
          <button
            type="button"
            onClick={() => setRating(0)}
            aria-label="Not helpful"
            className="rounded-md border border-site-border p-1.5 text-site-ink-muted transition hover:border-site-primary hover:text-site-primary"
          >
            <ThumbIcon down />
          </button>
        </div>
      ) : (
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="pageId" value={pageId} />
          <input type="hidden" name="rating" value={rating} />
          <label className="block text-sm text-site-ink-muted">
            {rating === 1 ? "Glad it helped! Anything to add?" : "Sorry about that — what went wrong?"}
          </label>
          <textarea
            name="feedback"
            rows={2}
            maxLength={2000}
            className="w-full resize-none rounded-lg border border-site-border bg-site-canvas px-3 py-2 text-sm text-site-ink outline-none focus:border-site-primary"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-site-primary px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Sending..." : "Send feedback"}
            </button>
            <button type="button" onClick={() => setRating(null)} className="text-sm text-site-ink-muted hover:text-site-ink">
              Skip
            </button>
          </div>
          {state.error ? <p className="text-sm text-site-danger">{state.error}</p> : null}
        </form>
      )}
    </div>
  );
}

function ThumbIcon({ down = false }: { down?: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={down ? { transform: "rotate(180deg)" } : undefined}
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}
