import { ModuleGuard } from "@/components/layout/access-guard";

// Журналын бүтэн дэлгэцийн засварлагч — GL модулийн унших эрх (бичилт нь action түвшинд хаагдана).
export default function StandaloneGlLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="gl">{children}</ModuleGuard>;
}
