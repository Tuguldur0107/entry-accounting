"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useDisabledModuleIds } from "@/components/layout/nav-visibility";
import {
  findActiveReportHref,
  REPORT_REGISTRY,
  reportModuleOfHref,
} from "@/lib/constants/report-registry";

// Топбарын тайлангийн сонгогч — БҮХ модулийн тайлан нэг бүлэглэсэн
// dropdown-д (эх сурвалж: lib/constants/report-registry.ts). Харагдах газар:
//   • тайлангийн хуудас бүр — идэвхтэй тайлан нь сонгогдсон байна
//   • Хяналтын самбар ("/") — "Тайлан руу очих…" placeholder-той
// Нэг хуудсанд параметрээр солигддог тайлан (GL ?report=, Бараа ?tab=,
// Цалин ?view=) — бусад параметрыг (огнооны муж) хадгалж зөвхөн тэр
// түлхүүрийг солино; модуль хооронд бүтэн навигаци хийнэ.
//
// ДҮРЭМ (UI стандарт): ӨӨР тайлан руу шилжих нь ЗӨВХӨН энэ сонгогчоор.
// Хуудас доторх таб нь НЭГ тайлангийн зүсэлт (бараагаар/өдрөөр…) л байна.

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

  const activeHref = findActiveReportHref(pathname, (key) => searchParams.get(key));

  // Тайлангийн хуудас эсвэл нүүр дээр л харагдана — бусад газар топбар цэвэр.
  if (!activeHref && pathname !== "/") return null;

  function handleChange(nextHref: string) {
    if (nextHref === PLACEHOLDER) return;
    const [nextPath, nextQuery] = nextHref.split("?");
    const reportModule = reportModuleOfHref(nextHref);
    if (nextPath === pathname && reportModule?.param) {
      // Нэг хуудсан доторх тайлан солих — огнооны муж зэрэг бусад параметрыг
      // хадгалж, зөвхөн тайлангийн түлхүүрийг солино. Өмнөх тайлангийн
      // өөрийн шүүлтүүр (дэд таб, агуулах…) шинэ тайланд хамааралгүй тул
      // зөвхөн нийтлэг огнооны параметрүүд дагана.
      const params = new URLSearchParams();
      for (const key of ["start", "end", "from", "to", "period", "asOf"]) {
        const carried = searchParams.get(key);
        if (carried) params.set(key, carried);
      }
      const nextValue = new URLSearchParams(nextQuery ?? "").get(reportModule.param);
      if (nextValue) params.set(reportModule.param, nextValue);
      router.push(params.size ? `${pathname}?${params}` : pathname);
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
