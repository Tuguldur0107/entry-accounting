import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { ModuleSwitcher } from "@/components/layout/module-switcher";
import { Sidebar } from "@/components/layout/sidebar";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { HeaderJournalSearch } from "@/components/layout/header-journal-search";
import { HeaderReportSelect } from "@/components/layout/header-report-select";
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
        <div className="px-3 md:px-6 flex items-center gap-2 md:gap-4 h-14">
          <SidebarToggle />
          <ModuleSwitcher />
          <div className="flex-1 flex items-center justify-center gap-2">
            <HeaderJournalSearch />
            <HeaderReportSelect />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <NewJournalButton />
            <ThemeToggle />
            <span className="hidden text-sm sm:inline" style={{ color: "var(--ea-text-3)" }}>
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
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="min-w-0 flex-1 flex flex-col min-h-0 px-4 py-5 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
