import type { LucideIcon } from "lucide-react";
import {
  List,
  BarChart3,
  User,
  Building2,
  Settings as SettingsIcon,
} from "lucide-react";

export type ModuleItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type Module = {
  id: string;
  label: string;
  matchPrefix: string;
  defaultHref: string;
  items: ModuleItem[];
};

export const MODULES: Module[] = [
  {
    id: "gl",
    label: "Ерөнхий журнал",
    matchPrefix: "/gl",
    defaultHref: "/gl/journal",
    items: [
      { label: "Журналын жагсаалт", href: "/gl/journal", icon: List },
      { label: "Тайлан", href: "/gl/reports", icon: BarChart3 },
    ],
  },
  {
    id: "settings",
    label: "Тохиргоо",
    matchPrefix: "/settings",
    defaultHref: "/settings/profile",
    items: [
      { label: "Хэрэглэгчийн профайл", href: "/settings/profile", icon: User },
      { label: "Компанийн мэдээлэл", href: "/settings/company", icon: Building2 },
      { label: "Ерөнхий журналын тохиргоо", href: "/settings/gl", icon: SettingsIcon },
    ],
  },
];

export function getActiveModule(pathname: string): Module {
  return (
    MODULES.find((m) => pathname.startsWith(m.matchPrefix)) ?? MODULES[0]
  );
}
