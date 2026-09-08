import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <svg viewBox="0 0 32 32" fill="none" className="h-10 w-10" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
        <path d="M9 10.5 16 22l7-11.5" stroke="var(--color-brand-ink)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h1 className="text-3xl font-semibold text-ink">VoidDocs</h1>
      <p className="max-w-md text-ink-muted">Publish beautiful documentation on your own domain.</p>
      <Link
        href="/login"
        className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-brand-ink transition hover:opacity-90"
      >
        Sign in
      </Link>
    </div>
  );
}
