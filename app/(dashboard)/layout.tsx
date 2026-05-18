import { auth, signOut } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EAMark } from "@/components/auth/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { ModuleSwitcher } from "@/components/layout/module-switcher";
import { Sidebar } from "@/components/layout/sidebar";
import { HeaderJournalSearch } from "@/components/layout/header-journal-search";
import { NewJournalButton } from "@/components/layout/new-journal-button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-full flex flex-col">
      <header
        style={{
          background: "var(--ea-surface-glass)",
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          borderBottom: "1px solid var(--ea-border)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div className="px-6 flex items-center gap-4 h-14">
          <Link
            href="/gl/journal"
            style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}
          >
            <EAMark size={28} />
          </Link>
          <ModuleSwitcher />
          <div className="flex-1 flex justify-center">
            <HeaderJournalSearch />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <NewJournalButton />
            <ThemeToggle />
            <span className="text-sm" style={{ color: "var(--ea-text-3)" }}>
              {session.user.name}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="text-sm px-3 py-1.5 rounded transition-colors hover:bg-[var(--ea-bg-2)]"
                style={{
                  color: "var(--ea-text-3)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Гарах
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="flex-1 flex">
        <Sidebar />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
