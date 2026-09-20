import { ModuleGuard } from "@/components/layout/access-guard";

// POS-ийн борлуулалт/ээлж/тохиргоо — pos эрхээр.
export default function PosSalesLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="pos">{children}</ModuleGuard>;
}
