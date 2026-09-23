import { ModuleGuard } from "@/components/layout/access-guard";

// POS-ийн ээлж — pos эрхээр.
export default function PosShiftsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="pos">{children}</ModuleGuard>;
}
