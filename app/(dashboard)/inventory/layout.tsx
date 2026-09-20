import { ModuleGuard } from "@/components/layout/access-guard";

// Бараа материал (inv) ЭСВЭЛ POS (pos) — кассчин зөвхөн pos эрхтэй байж болох
// тул үндсэн хавтас аль нэгээр нээгдэнэ; дэд хавтас бүр өөрийн түлхүүрээр
// дахин хаана (items/movements/counting/reports → inv, pos/sales → pos).
export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys={["inv", "pos"]}>{children}</ModuleGuard>;
}
