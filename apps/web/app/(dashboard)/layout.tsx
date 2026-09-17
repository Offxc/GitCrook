import { GitCrookMark } from "@/app/_components/GitCrookMark";
import { redirect } from "next/navigation";
import { auth, signOut } from "@gitcrook/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen bg-surface">
      <header className="flex h-14 items-center justify-between border-b border-border bg-canvas px-5">
        <div className="flex items-center gap-2">
          <GitCrookMark className="h-6 w-auto text-brand" />
          <span className="text-sm font-semibold text-ink">GitCrook</span>
        </div>
        <div className="flex items-center gap-3">
          {session.user.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar comes from Discord's CDN, not worth next/image config for a 32px round crop
            <img src={session.user.image} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
          ) : null}
          <span className="text-sm text-ink-muted">{session.user.name}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="text-sm text-ink-muted transition hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
