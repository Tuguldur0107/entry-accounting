import { auth, signOut } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EAMark, EAWordmark } from "@/components/auth/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV_ITEMS = [
  { label: "Ерөнхий журнал", href: "/gl/journal" },
  { label: "Мөнгөн гүйлгээ", href: "/cash/transactions" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-full flex flex-col">
      <header style={{ background: 'var(--ea-surface)', borderBottom: '1px solid var(--ea-border)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="max-w-screen-xl mx-auto px-6 flex items-center gap-6 h-14">
          <Link href="/gl/journal" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <EAMark size={28} />
            <EAWordmark size={15} />
          </Link>
          <nav className="flex items-center gap-1 flex-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-1.5 text-sm rounded transition-colors hover:bg-[var(--ea-bg-2)]"
                style={{ color: 'var(--ea-text-2)' }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <span className="text-sm" style={{ color: 'var(--ea-text-3)' }}>{session.user.name}</span>
            <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
              <button type="submit" className="text-sm px-3 py-1.5 rounded transition-colors hover:bg-[var(--ea-bg-2)]"
                style={{ color: 'var(--ea-text-3)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                Гарах
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-screen-xl mx-auto w-full px-6 py-8">
        {children}
      </main>
    </div>
  );
}
