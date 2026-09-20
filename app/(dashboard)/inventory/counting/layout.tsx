import { ModuleGuard } from "@/components/layout/access-guard";

// Бараа материалын унших эрх (inv) — POS-оор л орсон кассчинд нээгдэхгүй.
export default function InventoryCountingLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="inv">{children}</ModuleGuard>;
}
