import { ModuleGuard } from "@/components/layout/access-guard";

// Бараа материалын унших эрх (inv) — POS-оор л орсон кассчинд нээгдэхгүй.
export default function InventoryItemsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="inv">{children}</ModuleGuard>;
}
