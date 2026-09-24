import { ModuleGuard } from "@/components/layout/access-guard";

// Агуулах — бараа материалын мастер дата (inv).
export default function InventoryWarehousesLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="inv">{children}</ModuleGuard>;
}
