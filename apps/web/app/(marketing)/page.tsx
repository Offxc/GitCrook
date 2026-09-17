import { GitCrookMark } from "@/app/_components/GitCrookMark";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <GitCrookMark className="h-10 w-auto text-brand" />
      <h1 className="text-3xl font-semibold text-ink">GitCrook</h1>
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
