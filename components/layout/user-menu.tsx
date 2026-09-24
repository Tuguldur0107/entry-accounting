"use client";

// Топбарын профайл цэс — өдөр бүр хэрэглэгддэггүй удирдлага (дуу, горим,
// гарах) нэг товчны ард (UI гайдын карт 8, ENT-061: толгойн ~10 удирдлагыг
// ≤5 болгох). Гарах нь server action-ийг prop-оор авна (layout-д тодорхойлогдсон).

import { useState, useSyncExternalStore } from "react";

import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icon";
import { toggleTheme } from "@/components/theme-toggle";
import { isSoundOn, setSoundOn, subscribeSound } from "@/lib/ui/feedback";

function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function readIsDark() {
  return document.documentElement.classList.contains("dark");
}

export function UserMenu({
  name,
  email,
  signOutAction,
}: {
  name: string;
  email?: string | null;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const soundOn = useSyncExternalStore(subscribeSound, isSoundOn, () => true);
  const isDark = useSyncExternalStore(subscribeTheme, readIsDark, () => false);

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      panelClassName="w-64"
      trigger={
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Профайл цэс — ${name}`}
          title="Профайл: дуу, горим, гарах"
          onClick={() => setOpen((current) => !current)}
          className="ea-icon-action flex h-9 max-w-44 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--ea-border)] px-2 text-sm text-[var(--ea-text-2)]"
        >
          <Icon name="user" size="lg" className="pointer-events-none shrink-0" />
          <span className="hidden truncate sm:inline">{name}</span>
          <Icon name="chevronDown" size="xs" className="pointer-events-none shrink-0 text-[var(--ea-text-3)]" />
        </button>
      }
    >
      <div className="px-2 pb-1.5 pt-1">
        <div className="truncate text-sm font-medium text-[var(--ea-text-1)]">{name}</div>
        {email ? (
          <div className="truncate font-mono text-[11px] text-[var(--ea-text-3)]">{email}</div>
        ) : null}
      </div>
      <DropdownSeparator />
      <DropdownItem onSelect={() => setSoundOn(!soundOn)}>
        <Icon name={soundOn ? "soundOn" : "soundOff"} size="sm" aria-hidden />
        <span className="flex-1">Системийн дуу</span>
        <span className="text-[var(--ea-text-3)]">{soundOn ? "Асаалттай" : "Унтраалттай"}</span>
      </DropdownItem>
      <DropdownItem onSelect={() => toggleTheme()}>
        <Icon name={isDark ? "lightMode" : "darkMode"} size="sm" aria-hidden />
        <span className="flex-1">{isDark ? "Цайвар горим" : "Харанхуй горим"}</span>
      </DropdownItem>
      <DropdownSeparator />
      <form action={signOutAction}>
        <button
          type="submit"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--ea-text-1)] hover:bg-[var(--ea-hover-subtle)]"
        >
          <Icon name="signOut" size="sm" aria-hidden />
          Гарах
        </button>
      </form>
    </Dropdown>
  );
}
