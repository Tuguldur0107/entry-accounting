import { RoleGuard } from "@/components/layout/access-guard";

// Хэрэглэгчдийн эрх — урилгын линк, роль зэрэг мэдрэг мэдээлэл тул admin+.
export default function PermissionsSettingsLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard minRole="admin">{children}</RoleGuard>;
}
