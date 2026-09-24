"use client";

// Topbar-ийн сонгосон тайлант үе (`ea-period` cookie) — client hook.
// SSR-д null (hydration зөрөхгүй), browser-т cookie-оос.

import { useSyncExternalStore } from "react";

import { isDateInPeriod, periodFromCookieHeader } from "./document-date";

const noopSubscribe = () => () => {};

export function useSelectedPeriod(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => periodFromCookieHeader(document.cookie),
    () => null
  );
}

/**
 * Огноо сонгосон үеэс гадуур бол шар анхааруулгын текст (UI гайдын карт 4 —
 * хуучин сарын ажил хийж байхад буруу сард бичих эрсдэл). Үгүй бол null.
 */
export function usePeriodDateWarning(date: string): string | null {
  const period = useSelectedPeriod();
  if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isDateInPeriod(date, period)) return null;
  return `Сонгосон үеэс (${period.replace("-", ".")}) гадуур — ${date.slice(0, 7).replace("-", ".")} сард бичигдэнэ`;
}
