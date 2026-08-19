"use client";

// Глобал keyboard навигаци:
//   "/"  — хурдан шилжих палитр (бүх модулийн хуудас + үүсгэх үйлдлүүд,
//          MODULES бүртгэлээс — тусдаа жагсаалт хөтлөхгүй)
//   "?"  — товчлолын тусламжийн overlay
// Input/textarea/contenteditable дотор бичиж байхад идэвхгүй.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { HOME_MODULE_ID, MODULES } from "@/components/layout/modules";
import { QUICK_CREATE_ACTIONS } from "@/components/layout/quick-create";
import { cn } from "@/lib/utils";

type NavEntry = {
  key: string;
  /** Хайлтад ашиглах бүтэн текст. */
  search: string;
  group: string;
  label: string;
  icon: IconName;
  run: (router: ReturnType<typeof useRouter>) => void;
};

function buildEntries(): NavEntry[] {
  const pages: NavEntry[] = MODULES.flatMap((module) =>
    module.items.map((item) => ({
      key: `page:${item.href}`,
      search: `${module.label} ${item.label}`.toLowerCase(),
      group: module.id === HOME_MODULE_ID ? "Нүүр" : module.label,
      label: item.label,
      icon: item.icon,
      run: (router) => router.push(item.href),
    }))
  );
  const creates: NavEntry[] = QUICK_CREATE_ACTIONS.map((action) => ({
    key: `create:${action.key}`,
    search: `шинэ үүсгэх ${action.label}`.toLowerCase(),
    group: "Үүсгэх",
    label: action.label,
    icon: action.icon,
    run: () => action.run(),
  }));
  return [...creates, ...pages];
}

/** Товчлолын тусламжид үзүүлэх жагсаалт. */
const SHORTCUT_HELP: { keys: string; description: string }[] = [
  { keys: "/", description: "Хурдан шилжих палитр (хуудас, үүсгэх үйлдэл)" },
  { keys: "?", description: "Энэ тусламжийг нээх" },
  { keys: "Esc", description: "Палитр/панель хаах, edit-ээс гарах" },
  { keys: "Enter / Shift+Enter", description: "Хүснэгтэд commit + доош / дээш" },
  { keys: "Tab / Shift+Tab", description: "Дараагийн / өмнөх editable нүд" },
  { keys: "F2", description: "Нүдийг засах горимд оруулах" },
  { keys: "Ctrl/Cmd+C · V · X", description: "Мужийг хуулах / буулгах / таслах (Excel-рүү шууд)" },
  { keys: "Ctrl/Cmd+Z · Y", description: "Undo / Redo (хүснэгтийн засвар)" },
  { keys: "Shift+даралт", description: "Хүснэгтэд мужаар сонгох" },
  { keys: "Давхар даралт", description: "Мөрийн дэлгэрэнгүй панель нээх" },
];

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable
  );
}

export function QuickNav() {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="top-[20%] translate-y-0 p-0 sm:max-w-lg">
          {paletteOpen && (
            <PaletteBody
              onRun={(entry) => {
                setPaletteOpen(false);
                entry.run(router);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Гарын товчлолууд</DialogTitle>
          </DialogHeader>
          <ul className="grid gap-1.5">
            {SHORTCUT_HELP.map((entry) => (
              <li key={entry.keys} className="flex items-center gap-3 text-sm">
                <kbd
                  className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px]"
                  style={{
                    borderColor: "var(--ea-border)",
                    background: "var(--ea-bg-2)",
                    color: "var(--ea-text-1)",
                  }}
                >
                  {entry.keys}
                </kbd>
                <span style={{ color: "var(--ea-text-2)" }}>{entry.description}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PaletteBody({ onRun }: { onRun: (entry: NavEntry) => void }) {
  const entries = useMemo(() => buildEntries(), []);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => entry.search.includes(q));
  }, [entries, query]);

  // Шүүлт өөрчлөгдөхөд идэвхтэй мөр жагсаалтын хязгаарт байг.
  const active = Math.min(activeIndex, Math.max(0, filtered.length - 1));

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(active + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(active - 1, 0));
    } else if (event.key === "Enter" && filtered[active]) {
      event.preventDefault();
      onRun(filtered[active]);
    }
  }

  // Идэвхтэй мөрийг харагдацад байлгана.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="flex max-h-[60vh] flex-col">
      <div className="border-b p-2" style={{ borderColor: "var(--ea-border)" }}>
        <Input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Хуудас, үйлдэл хайх…"
          className="border-none bg-transparent shadow-none focus-visible:ring-0"
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs" style={{ color: "var(--ea-text-4)" }}>
            Илэрц алга.
          </p>
        ) : (
          filtered.map((entry, index) => (
            <button
              key={entry.key}
              type="button"
              data-index={index}
              onClick={() => onRun(entry)}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                index === active
                  ? "bg-[var(--ea-selected-bg)] text-[var(--ea-interactive)]"
                  : "text-[var(--ea-text-1)]"
              )}
            >
              <Icon name={entry.icon} size="sm" className="shrink-0 text-[var(--ea-text-3)]" />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              <span className="shrink-0 text-[11px]" style={{ color: "var(--ea-text-4)" }}>
                {entry.group}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
