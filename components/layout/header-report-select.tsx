"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useDisabledModuleIds } from "@/components/layout/nav-visibility";
import {
  findActiveReportHref,
  REPORT_REGISTRY,
} from "@/lib/constants/report-registry";

// Топбарын тайлангийн сонгогч — БҮХ модулийн тайлан нэг бүлэглэсэн
// dropdown-д (эх сурвалж: lib/constants/report-registry.ts). Харагдах газар:
//   • тайлангийн хуудас бүр — идэвхтэй тайлан нь сонгогдсон байна
//   • Хяналтын самбар ("/") — "Тайлан руу очих…" placeholder-той
// GL-ийн дотоод сонголт ?report= параметрээр (start/end хадгалагдана),
// модуль хооронд бүтэн навигаци хийнэ.

const PLACEHOLDER = "__none__";

export function HeaderReportSelect() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Унтраасан модулийн тайлан цэсэнд гарахгүй (модулийн тохиргоотой нийцнэ).
  const disabledModuleIds = useDisabledModuleIds();
  const visibleRegistry = REPORT_REGISTRY.filter(
    (module) => !disabledModuleIds.includes(module.moduleId)
  );

  const activeHref = findActiveReportHref(pathname, searchParams.get("report"));

  // Тайлангийн хуудас эсвэл нүүр дээр л харагдана — бусад газар топбар цэвэр.
  if (!activeHref && pathname !== "/") return null;

  function handleChange(nextHref: string) {
    if (nextHref === PLACEHOLDER) return;
    const [nextPath, nextQuery] = nextHref.split("?");
    if (nextPath === pathname && nextQuery?.startsWith("report=")) {
      // Нэг хуудсан доторх сонголт — бусад параметрыг (start/end) хадгална.
      const params = new URLSearchParams(searchParams.toString());
      params.set("report", nextQuery.slice("report=".length));
      router.replace(`${pathname}?${params.toString()}`);
      return;
    }
    router.push(nextHref);
  }

  return (
    <select
      value={activeHref ?? PLACEHOLDER}
      onChange={(e) => handleChange(e.target.value)}
      aria-label="Тайлан сонгох"
      className="h-8 max-w-52 px-2 text-xs border border-[var(--ea-border)] rounded-md bg-[var(--ea-surface)] text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ea-primary)_22%,transparent)] focus:border-[var(--ea-primary)]"
    >
      {!activeHref && (
        <option value={PLACEHOLDER} disabled>
          Тайлан руу очих…
        </option>
      )}
      {visibleRegistry.map((module) => (
        <optgroup key={module.moduleId} label={module.moduleLabel}>
          {module.entries.map((entry) => (
            <option key={entry.value} value={entry.href}>
              {entry.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
