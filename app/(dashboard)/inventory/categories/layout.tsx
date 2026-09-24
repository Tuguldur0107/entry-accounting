import { ModuleGuard } from "@/components/layout/access-guard";

// Барааны ангилал — бараа материалын мастер дата (inv).
export default function InventoryCategoriesLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="inv">{children}</ModuleGuard>;
}
