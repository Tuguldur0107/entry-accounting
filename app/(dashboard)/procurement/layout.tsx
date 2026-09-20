import { ModuleGuard } from "@/components/layout/access-guard";

// Модулийн уншилтын эрх — «Байхгүй» гишүүнд URL-ээр ч нээгдэхгүй (components/layout/access-guard.tsx).
export default function ProcurementLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="proc">{children}</ModuleGuard>;
}
