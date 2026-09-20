import { ModuleGuard } from "@/components/layout/access-guard";

// POS нь Бараа материалын дотор боловч ТУСДАА эрхийн түлхүүр (pos) — кассчин inv-гүй байж болно.
export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="pos">{children}</ModuleGuard>;
}
