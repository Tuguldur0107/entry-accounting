"use client";

// Глобал keyboard навигаци:
//   "/", Cmd/Ctrl+K — хурдан шилжих палитр: хуудас + үүсгэх үйлдэл
//          (MODULES бүртгэлээс) + ДАТА хайлт — данс/харилцагч/бараа
//          клиент кэшээс (П5, network-гүй), баримтууд /api/search-ээс
//          debounce-тэйгээр; баримт нь панелээрээ шууд нээгдэнэ (П10).
//   "?"  — товчлолын тусламжийн overlay
// "/" ба "?" нь input/textarea/contenteditable дотор идэвхгүй;
// Cmd/Ctrl+K хаанаас ч ажиллана.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { HOME_MODULE_ID, MODULES } from "@/components/layout/modules";
import { useDisabledModuleIds } from "@/components/layout/nav-visibility";
import { QUICK_CREATE_ACTIONS } from "@/components/layout/quick-create";
import { getReferenceData } from "@/lib/reference/client-cache";
import {
  REFERENCE_MIN_QUERY,
  searchReference,
  type ReferenceData,
} from "@/lib/reference/palette-search";
import {
  openArapDocPanel,
  openCashDocPanel,
  openVoucherPanel,
} from "@/lib/store/panel-store";
import { cn } from "@/lib/utils";

type NavEntry = {
  key: string;
  /** Хайлтад ашиглах бүтэн текст (дата илэрцэд хоосон — аль хэдийн шүүгдсэн). */
  search: string;
  group: string;
  label: string;
  /** Хажууд нь муутгаж үзүүлэх нэмэлт (дугаар, огноо, төлөв). */
  sub?: string;
  icon: IconName;
  run: (router: ReturnType<typeof useRouter>) => void;
};

/** /api/search-ийн нэг бүлгийн илэрц. */
type DocHit = {
  id: string;
  documentNo?: string;
  documentType?: string;
  label: string;
  sub: string;
};

type DocSearchResult = { arap: DocHit[]; cash: DocHit[]; vouchers: DocHit[] };

function buildEntries(disabledModuleIds: string[]): NavEntry[] {
  // Модулийн тохиргоогоор унтраасан модулийн хуудас, үүсгэх үйлдэл палитрт
  // гарахгүй (Тохиргоо → Ерөнхий журналын тохиргоо → Модулийн тохиргоо).
  const pages: NavEntry[] = MODULES.filter(
    (module) => !disabledModuleIds.includes(module.id)
  ).flatMap((module) =>
    module.items.map((item) => ({
      key: `page:${item.href}`,
      search: `${module.label} ${item.label}`.toLowerCase(),
      group: module.id === HOME_MODULE_ID ? "Нүүр" : module.label,
      label: item.label,
      icon: item.icon,
      run: (router) => router.push(item.href),
    }))
  );
  const creates: NavEntry[] = QUICK_CREATE_ACTIONS.filter(
    (action) => !action.moduleId || !disabledModuleIds.includes(action.moduleId)
  ).map((action) => ({
    key: `create:${action.key}`,
    search: `шинэ үүсгэх ${action.label}`.toLowerCase(),
    group: "Үүсгэх",
    label: action.label,
    icon: action.icon,
    run: (router) =>
      action.href ? router.push(action.href) : action.run?.(),
  }));
  return [...creates, ...pages];
}

/** Товчлолын тусламжид үзүүлэх жагсаалт. */
const SHORTCUT_HELP: { keys: string; description: string }[] = [
  {
    keys: "/ · Cmd/Ctrl+K",
    description: "Палитр: хуудас, үйлдэл + данс/харилцагч/бараа/баримт хайх",
  },
  { keys: "?", description: "Энэ тусламжийг нээх" },
  { keys: "Esc", description: "Палитр/панель хаах, edit-ээс гарах" },
  { keys: "Enter / Shift+Enter", description: "Хүснэгтэд commit + доош / дээш" },
  { keys: "Tab / Shift+Tab", description: "Дараагийн / өмнөх editable нүд" },
  { keys: "F2", description: "Шинэ баримтын цэс нээх; хүснэгтэд — нүдийг засах горим" },
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
      // Cmd/Ctrl+K — бичиж байсан ч ажиллана (Linear/Superhuman конвенц).
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
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
  const disabledModuleIds = useDisabledModuleIds();
  const entries = useMemo(
    () => buildEntries(disabledModuleIds),
    [disabledModuleIds]
  );
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // П5 — лавлах дата клиент кэшээс (нэг session-д нэг fetch).
  const [reference, setReference] = useState<ReferenceData | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getReferenceData().then((data) => {
      if (!cancelled && data) setReference(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // П10 — баримтын хайлт: debounce + AbortController. Илэрц нь query-тэйгээ
  // хамт хадгалагдаж render дээр тулгагдана — хуучирсан query-ийн илэрц
  // харагдахгүй, effect дотор sync reset ч хэрэггүй.
  const [docSearch, setDocSearch] = useState<{
    q: string;
    result: DocSearchResult;
  } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < REFERENCE_MIN_QUERY) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: (DocSearchResult & { error?: string }) | null) => {
          if (data && !data.error) setDocSearch({ q, result: data });
        })
        .catch(() => {});
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const filtered = useMemo(() => {
    const rawQuery = query.trim();
    const q = rawQuery.toLowerCase();
    const staticEntries = q
      ? entries.filter((entry) => entry.search.includes(q))
      : entries;
    if (q.length < REFERENCE_MIN_QUERY) return staticEntries;
    const docResult =
      docSearch && docSearch.q === rawQuery ? docSearch.result : null;

    // Лавлах илэрц — кэшээс шууд (network-гүй).
    const referenceEntries: NavEntry[] = reference
      ? searchReference(reference, q).map((hit) => ({
          key: `${hit.kind}:${hit.id}`,
          search: "",
          group:
            hit.kind === "account"
              ? "Данс"
              : hit.kind === "counterparty"
                ? "Харилцагч"
                : "Бараа",
          label: hit.label,
          sub: hit.sub,
          icon:
            hit.kind === "account"
              ? "generalLedger"
              : hit.kind === "counterparty"
                ? "company"
                : "inventory",
          run: (router) =>
            router.push(
              hit.kind === "account"
                ? "/settings/gl"
                : hit.kind === "counterparty"
                  ? hit.counterpartyType === "supplier"
                    ? "/payables/counterparties"
                    : "/receivables/counterparties"
                  : "/inventory/items"
            ),
        }))
      : [];

    // Баримтын илэрц — панелээрээ шууд нээгдэнэ.
    const documentEntries: NavEntry[] = docResult
      ? [
          ...docResult.arap.map((hit): NavEntry => ({
            key: `arap:${hit.id}`,
            search: "",
            group: "АР/АП баримт",
            label: hit.label,
            sub: hit.sub,
            icon: "document",
            run: () =>
              openArapDocPanel({
                documentId: hit.id,
                mode: hit.documentType === "ap_bill" ? "payable" : "receivable",
                title: hit.documentNo,
              }),
          })),
          ...docResult.cash.map((hit): NavEntry => ({
            key: `cashdoc:${hit.id}`,
            search: "",
            group: "Кассын баримт",
            label: hit.label,
            sub: hit.sub,
            icon: "cash",
            run: () => openCashDocPanel(hit.id, hit.documentNo),
          })),
          ...docResult.vouchers.map((hit): NavEntry => ({
            key: `voucher:${hit.id}`,
            search: "",
            group: "Журнал",
            label: hit.label,
            sub: hit.sub,
            icon: "journal",
            run: () => openVoucherPanel(hit.id),
          })),
        ]
      : [];

    return [...staticEntries, ...referenceEntries, ...documentEntries];
  }, [entries, query, reference, docSearch]);

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
          placeholder="Хуудас, үйлдэл, данс, харилцагч, бараа, баримт хайх…"
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
              <span className="min-w-0 flex-1 truncate">
                {entry.label}
                {entry.sub && (
                  <span
                    className="ml-2 text-[11px]"
                    style={{ color: "var(--ea-text-4)" }}
                  >
                    {entry.sub}
                  </span>
                )}
              </span>
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
