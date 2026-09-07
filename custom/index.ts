// ┌──────────────────────────────────────────────────────────────────────┐
// │  custom/ — ТАНЫ өргөтгөлийн ЦОРЫН ГАНЦ entrypoint                     │
// │  Core (upstream) энэ хавтас дотор хэзээ ч бичихгүй; та core файлд     │
// │  гар хүрэхгүй. Ингэснээр `git merge upstream/main` conflict-гүй явна. │
// └──────────────────────────────────────────────────────────────────────┘
//
// Багц бүртгэх: custom/packages/<нэр>/index.ts-ээс import хийгээд
// mergeCustomizations(...)-д нэмнэ. Жишээ:
//
//   import { demoPackage } from "./packages/demo";
//   export const customization = mergeCustomizations(demoPackage);
//
// Дэлгэрэнгүй: custom/README.md (хэрэглэгчид), custom/CLAUDE.md (Claude Code-д).

import type { EntryCustomization } from "@/lib/custom/types";
import { mergeCustomizations } from "@/lib/custom/validate";

export const customization: EntryCustomization = mergeCustomizations();
