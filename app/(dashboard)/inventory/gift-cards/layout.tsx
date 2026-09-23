import { ModuleGuard } from "@/components/layout/access-guard";

// POS-ийн бэлгийн карт ба дэлгүүрийн кредит — pos эрхээр.
export default function PosGiftCardsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="pos">{children}</ModuleGuard>;
}
