"use client";

// Модулийн тохиргооны (Тохиргоо → Ерөнхий журналын тохиргоо → Модулийн
// тохиргоо) навигацид үзүүлэх нөлөө: унтраасан модуль module switcher,
// Cmd+K палитр, "+ Шинэ" цэснээс нуугдана. Layout (server) module_configs-оо
// уншиж энэ provider-ээр client компонентуудад дамжуулна.

import { createContext, useContext, type ReactNode } from "react";

const NavVisibilityContext = createContext<string[]>([]);

export function NavVisibilityProvider({
  disabledModuleIds,
  children,
}: {
  disabledModuleIds: string[];
  children: ReactNode;
}) {
  return (
    <NavVisibilityContext.Provider value={disabledModuleIds}>
      {children}
    </NavVisibilityContext.Provider>
  );
}

/** Навигациас нуух модулийн id-ууд (components/layout/modules.ts-ийн id). */
export function useDisabledModuleIds(): string[] {
  return useContext(NavVisibilityContext);
}
