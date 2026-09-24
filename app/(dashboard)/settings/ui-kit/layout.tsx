import { RoleGuard } from "@/components/layout/access-guard";

// Хөгжүүлэгчийн UI Kit демо — зөвхөн admin+ (ENT-075: SaaS-ийн энгийн
// хэрэглэгч демо component-уудыг харж байв). Апп дотор super-admin роль
// БАЙХГҮЙ (CLAUDE.md) тул байгууллагын admin/owner л.
export default function UiKitLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard minRole="admin">{children}</RoleGuard>;
}
