import { ModuleGuard } from "@/components/layout/access-guard";

// «AI холболт» нь Тохиргоо дотор (2026-09-26) ч эрх нь `ai` модулийн түлхүүрээр
// хэвээр — «Байхгүй» гишүүнд URL-ээр ч нээгдэхгүй (components/layout/access-guard.tsx).
export default function AiSettingsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard moduleKeys="ai">{children}</ModuleGuard>;
}
