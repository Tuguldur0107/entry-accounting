import { ModuleGuard } from "@/components/layout/access-guard";

// POS-ийн тохиргоо — pos эрхээр.
export default function PosSettingsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="pos">{children}</ModuleGuard>;
}
