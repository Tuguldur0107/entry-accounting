"use client";

// Модулийн эрхийн түвшин CLIENT-д (SIM2-047) — ModuleGuard (server) нь
// тухайн модулийн түвшинг энд дамжуулна. Эрхгүй үйлдлийн товчийг урьдчилан
// идэвхгүй болгож tooltip-оор тайлбарлана (форм бөглөсний ДАРАА татгалзахгүй).
// Сервер талын хамгаалалт (requireModuleAction) хэвээр — энэ нь зөвхөн UX.
// Провайдергүй газарт (глобал панель) мэдэгдэхгүй тул хаахгүй.

import { createContext, useContext, type ReactNode } from "react";

import { PERMISSION_LEVELS, type PermissionLevel } from "@/lib/permissions";

const ModuleAccessContext = createContext<Record<string, PermissionLevel> | null>(null);

export function ModuleAccessProvider({
  levels,
  children,
}: {
  levels: Record<string, PermissionLevel>;
  children: ReactNode;
}) {
  const parent = useContext(ModuleAccessContext);
  return (
    <ModuleAccessContext.Provider value={{ ...(parent ?? {}), ...levels }}>
      {children}
    </ModuleAccessContext.Provider>
  );
}

/** Модульд `min` түвшний эрхтэй эсэх — мэдэгдэхгүй (провайдергүй) бол true. */
export function useModuleCan(moduleKey: string, min: PermissionLevel = "write"): boolean {
  const levels = useContext(ModuleAccessContext);
  const level = levels?.[moduleKey];
  if (!level) return true;
  return PERMISSION_LEVELS.indexOf(level) >= PERMISSION_LEVELS.indexOf(min);
}

export const READ_ONLY_HINT = "Танд зөвхөн харах эрх байна — бичих эрхийг байгууллагын админ олгоно";
