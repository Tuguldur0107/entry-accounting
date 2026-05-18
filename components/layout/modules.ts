export type ModuleItem = {
  label: string;
  href: string;
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
      { label: "Журналын жагсаалт", href: "/gl/journal" },
      { label: "Тайлан", href: "/gl/reports" },
    ],
  },
  {
    id: "settings",
    label: "Тохиргоо",
    matchPrefix: "/settings",
    defaultHref: "/settings/profile",
    items: [
      { label: "Хэрэглэгчийн профайл", href: "/settings/profile" },
      { label: "Компанийн мэдээлэл", href: "/settings/company" },
      { label: "Ерөнхий журналын тохиргоо", href: "/settings/gl" },
    ],
  },
];

export function getActiveModule(pathname: string): Module {
  return (
    MODULES.find((m) => pathname.startsWith(m.matchPrefix)) ?? MODULES[0]
  );
}
