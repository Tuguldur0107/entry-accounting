import { RoleGuard } from "@/components/layout/access-guard";

// Удирдлага (байгууллага, гишүүд, аудитын мөр) — зөвхөн admin+.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard minRole="admin">{children}</RoleGuard>;
}
