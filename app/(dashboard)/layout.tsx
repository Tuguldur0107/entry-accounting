import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { EAMark, EAWordmark } from "@/components/auth/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sidebar } from "@/components/layout/sidebar";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { HeaderJournalSearch } from "@/components/layout/header-journal-search";
import { HeaderReportSelect } from "@/components/layout/header-report-select";
import { NewJournalButton } from "@/components/layout/new-journal-button";
import { AiChatButton } from "@/components/layout/ai-chat-button";
import { PanelHost } from "@/components/panel/panel-host";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <header
        className="shrink-0"
        style={{
          background: "var(--ea-surface-glass)",
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          borderBottom: "1px solid var(--ea-border)",
          zIndex: 10,
        }}
      >
        <div className="flex min-h-14 flex-wrap items-center gap-2 px-3 py-2 md:flex-nowrap md:gap-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            <div className="md:hidden">
              <SidebarToggle />
            </div>
            {/* Global brand — module / page context lives in the sidebar
                (module switcher) so the header stays constant app-wide. */}
            <Link
              href="/gl/journal"
              className="flex min-w-0 items-center gap-2.5"
              style={{ textDecoration: "none" }}
              aria-label="Entry Accounting — нүүр"
            >
              <EAMark size={26} />
              <span className="hidden md:inline">
                <EAWordmark size={16} />
              </span>
            </Link>
          </div>
          <div className="order-3 flex w-full items-center gap-2 md:order-none md:w-auto md:flex-1 md:justify-end">
            <HeaderJournalSearch />
            <HeaderReportSelect />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <NewJournalButton />
            <AiChatButton />
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
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-5 md:px-6 md:py-8">{children}</main>
      </div>
      {/* Ажлын панелиуд — олон зэрэг нээгдэж, доод докоор сэлгэнэ */}
      <PanelHost />
    </div>
  );
}
