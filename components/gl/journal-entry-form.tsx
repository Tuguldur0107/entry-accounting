"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { createPortal } from "react-dom";
import { nanoid } from "nanoid";
import {
  createVoucher,
  duplicateVoucher,
  unpostVoucher,
  updateVoucher,
} from "@/lib/actions/gl";
import type { ChartOfAccount, SegmentValue } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtMnt } from "@/lib/reports/balances";
import {
  buildSegCode,
  fmtAccountDisplay,
  parseSegParts,
} from "@/lib/grid/segments";
import {
  JournalLinesGrid,
  type JournalLineRow,
} from "@/components/journal/journal-lines-grid";
import { ExcelImportDialog } from "@/components/excel/excel-import-dialog";
import {
  journalLinesSpec,
  type JournalLineImport,
} from "@/lib/excel/specs";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { cn } from "@/lib/utils";

/**
 * Толгойн НЭГ талбар: жижиг саарал шошго + тогтмол өндөртэй утгын нүд.
 * Утга нь текст (харах горим) эсвэл Input (засварлах) байхаас үл хамааран
 * мөрийн өндөр ижил байна — хоёр горим ижил харагдана.
 */
function HeaderField({
  label,
  htmlFor,
  align = "left",
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label
        htmlFor={htmlFor}
        className={cn(
          "block text-[11px] font-normal text-[var(--ea-text-4)]",
          align === "right" && "text-right"
        )}
      >
        {label}
      </Label>
      <div
        className={cn(
          "mt-0.5 flex h-8 min-w-0 items-center",
          align === "right" && "justify-end"
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Standalone цонх дахь хаалт. Панель горимд ЭНИЙГ ДУУДАХГҮЙ — оронд нь
 * onDone() дуудаж, эх хуудсыг router.refresh()-ээр л шинэчилнэ (бүтэн
 * reload хийхгүй тул шүүлтүүр/скролл/бусад панель хэвээр үлдэнэ).
 */
function closeWindow() {
  if (typeof window === "undefined") return;
  if (window.opener) {
    window.opener.location.reload();
    window.close();
  } else {
    window.location.href = "/gl/journal";
  }
}

interface InitialLine {
  account: string;
  debit: string | number;
  credit: string | number;
  description: string;
}

interface InitialVoucher {
  date: string;
  description: string;
  lines: InitialLine[];
}

interface Props {
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  segmentValues: SegmentValue[];
  defaultSegments?: Record<number, string>;
  voucherId?: string;
  initialVoucher?: InitialVoucher;
  /** Зөвхөн харах — батлагдсан/буцаагдсан журналд засвар хийхгүй. */
  readOnly?: boolean;
  /** Харах горимд төлөвийг badge-аар үзүүлнэ. */
  voucherStatus?: string;
  /** Харах горимд үзүүлэх үүсгэсэн огноо-цаг (урьдчилан форматалсан). */
  voucherCreatedAt?: string;
  /** Панель дотор — өөрийн gorimoo цонх шиг барихгүй, эцгээ дүүргэнэ. */
  embedded?: boolean;
  /** Панель горимд: АМЖИЛТТАЙ ажил (хадгалах/буцаалт) дуусахад дуудагдана. */
  onDone?: () => void;
  /**
   * Панель горимд: Болих/Хаах — юу ч хадгалагдаагүй гарах хүсэлт. Панелийн
   * dirty-баталгаажуулалтаар дайрдаг тул бөглөсөн зүйл чимээгүй устахгүй.
   */
  onCancel?: () => void;
  /** Панель горимд: хадгалаагүй өөрчлөлтийн төлөв мэдэгдэнэ. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Панель горимд: хуулбарыг шинэ панелиар нээхэд. */
  onOpenVoucher?: (voucherId: string) => void;
  /**
   * Гарын shortcut (Ctrl+Enter) идэвхтэй эсэх. Панель горимд зөвхөн ФОКУСТАЙ
   * панель true авна — эс бөгөөс нээлттэй бүх панель зэрэг хадгалчихна.
   */
  shortcutsEnabled?: boolean;
}

const fmt = (n: number) => fmtMnt(n);

export function JournalEntryForm({
  accounts,
  activeSegIds,
  segmentValues,
  defaultSegments = {},
  voucherId,
  initialVoucher,
  readOnly = false,
  voucherStatus,
  voucherCreatedAt,
  embedded = false,
  onDone,
  onCancel,
  onDirtyChange,
  onOpenVoucher,
  shortcutsEnabled = true,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!voucherId;

  const makeEmptyLine = useCallback((): JournalLineRow => {
    const parts: Record<number, string> = {};
    for (const id of activeSegIds) parts[id] = defaultSegments[id] ?? "";
    return {
      id: nanoid(),
      account: buildSegCode(parts, activeSegIds, defaultSegments),
      debit: 0,
      credit: 0,
      description: "",
    };
  }, [activeSegIds, defaultSegments]);

  const [date, setDate] = useState(initialVoucher?.date ?? today);
  const [description, setDescription] = useState(initialVoucher?.description ?? "");
  const [lines, setLines] = useState<JournalLineRow[]>(() => {
    if (initialVoucher?.lines && initialVoucher.lines.length >= 2) {
      return initialVoucher.lines.map((l) => ({
        id: nanoid(),
        account: l.account,
        debit: typeof l.debit === "number" ? l.debit : parseFloat(String(l.debit)) || 0,
        credit: typeof l.credit === "number" ? l.credit : parseFloat(String(l.credit)) || 0,
        description: l.description,
      }));
    }
    return [makeEmptyLine(), makeEmptyLine()];
  });

  // Мөрүүдийн ХАМГИЙН СҮҮЛИЙН утга — Ctrl+Enter дарахад AG Grid-ийн нээлттэй
  // editor-ийг blur-аар commit хийхэд state-ийн шинэчлэл асинхрон тул
  // хадгалах үед энэ ref-ээс уншина.
  const linesRef = useRef(lines);
  // Формын root — панель горимд Ctrl+Enter фокус дотор нь байгааг шалгана.
  const formRootRef = useRef<HTMLDivElement>(null);
  const updateLines = useCallback(
    (updater: (prev: JournalLineRow[]) => JournalLineRow[]) => {
      const next = updater(linesRef.current);
      linesRef.current = next;
      setLines(next);
    },
    []
  );

  const [saving, setSaving] = useState<"draft" | "posted" | null>(null);
  const [error, setError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  // Панель горимд хэвлэх үед л print sheet-ийг body-д portal-оор гаргана —
  // эс бөгөөс window.print() нь АРД байгаа хуудас + нээлттэй БҮХ панелийн
  // sheet-ийг зэрэг хэвлэнэ.
  const [printing, setPrinting] = useState(false);

  const nameByMain = useMemo(
    () => new Map(accounts.map((a) => [a.number, a.name])),
    [accounts]
  );
  const accountLabel = useCallback(
    (code: string) => {
      const parts = code.split(".");
      const main = parts.length === 10 ? parts[2] : code;
      return {
        code: fmtAccountDisplay(code, activeSegIds),
        name: nameByMain.get(main) ?? "",
      };
    },
    [activeSegIds, nameByMain]
  );

  // Хадгалаагүй өөрчлөлтийн хамгаалалт — эхний render-ийн snapshot-той
  // харьцуулна (lazy useState нь ref-ээс ялгаатай render-цэвэр).
  const currentSnapshot = JSON.stringify({
    date,
    description,
    lines: lines.map((l) => [l.account, l.debit, l.credit, l.description]),
  });
  const [initialSnapshot] = useState(currentSnapshot);
  const dirty = !readOnly && currentSnapshot !== initialSnapshot;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty || saving !== null) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const diff = totalDebit - totalCredit;
  const isEmpty = totalDebit === 0 && totalCredit === 0;
  const balanced = !isEmpty && Math.abs(diff) <= 0.01;

  const segOptions = useMemo<Record<number, SegOption[]>>(() => {
    const map: Record<number, SegOption[]> = {};
    // Засварлах үед зөвхөн идэвхтэй данс сонгогдоно; харах горимд бүгд —
    // идэвхгүй болсон данстай хуучин бичилтийн нэр харагдана.
    const s3Accounts = readOnly
      ? accounts
      : accounts.filter((a) => a.isEnabled);
    for (const segId of activeSegIds) {
      map[segId] =
        segId === 3
          ? s3Accounts.map((a) => ({ code: a.number, name: a.name }))
          : segmentValues
              .filter((sv) => sv.segmentId === segId)
              .map((sv) => ({ code: sv.code, name: sv.name }));
    }
    return map;
  }, [activeSegIds, accounts, segmentValues, readOnly]);

  // Excel импорт — спек нь grid-ийн paste урсгалтай ижил normalize хийдэг
  // (стандарт: зөвхөн зөв мөрүүд орж ирнэ, шалгалт нь спек дотор).
  const importSpec = useMemo(
    () =>
      journalLinesSpec({
        accountsByMain: new Map(
          accounts.filter((a) => a.isEnabled).map((a) => [a.number, a.name])
        ),
        activeSegIds,
        defaultSegments,
      }),
    [accounts, activeSegIds, defaultSegments]
  );

  function handleImportLines(values: JournalLineImport[]) {
    updateLines((prev) => {
      // Хүрээгүй хоосон мөрүүдийг (үндсэн данс, дүн, тайлбаргүй) импорт орлоно.
      const kept = prev.filter(
        (line) =>
          line.debit > 0 ||
          line.credit > 0 ||
          line.description.trim() !== "" ||
          (parseSegParts(line.account, [3])[3] ?? "").trim() !== ""
      );
      return [
        ...kept,
        ...values.map((value) => ({ id: nanoid(), ...value })),
      ];
    });
  }

  // АМЖИЛТТАЙ ажил дуусахад: панель горимд эцэгтээ мэдэгдэнэ (эх хуудас
  // зөвхөн router.refresh хийнэ), standalone цонхонд өөрийгөө хаана.
  const finish = useCallback(() => {
    if (embedded) onDone?.();
    else closeWindow();
  }, [embedded, onDone]);

  // Болих/Хаах: панель горимд onCancel → панелийн dirty-баталгаажуулалт.
  // onDone-оор дайрвал бөглөсөн зүйл асуултгүй устана — тиймээс тусдаа зам.
  function cancel() {
    if (embedded) (onCancel ?? onDone)?.();
    else closeWindow();
  }

  async function handleSave(status: "draft" | "posted") {
    if (!date || !description.trim()) {
      setError("Огноо ба гүйлгээний утгыг бөглөнө үү");
      return;
    }
    // Хамгийн сүүлийн (commit хийгдсэн) мөрүүдээр тэнцлийг дахин шалгана.
    const current = linesRef.current;
    const dr = current.reduce((s, l) => s + l.debit, 0);
    const cr = current.reduce((s, l) => s + l.credit, 0);
    const balancedNow =
      !(dr === 0 && cr === 0) && Math.abs(dr - cr) <= 0.01;
    if (status === "posted" && !balancedNow) return;
    setSaving(status);
    setError("");
    try {
      const payload = {
        date,
        description: description.trim(),
        status,
        lines: current.map((l) => ({
          account: l.account,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
        })),
      };
      if (isEdit && voucherId) {
        await updateVoucher(voucherId, payload);
      } else {
        await createVoucher(payload);
      }
      finish();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Алдаа гарлаа");
      setSaving(null);
    }
  }

  // Ctrl/Cmd+Enter — хадгалах shortcut (зөвхөн засварлах горимд, панель
  // горимд зөвхөн фокустай панельд — window-түвшний listener тул).
  useEffect(() => {
    if (readOnly || !shortcutsEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      // Панель горимд фокус ФОРМ ДОТОР байх ёстой — панель "идэвхтэй" ч
      // хэрэглэгч ард буй хуудасны талбар/диалогт бичиж байвал энэ панель
      // хадгалж болохгүй.
      if (
        embedded &&
        !formRootRef.current?.contains(document.activeElement)
      )
        return;
      event.preventDefault();
      if (saving !== null) return;
      // Нүдэнд бичиж байгаад дарсан бол эхлээд editor-ийг commit хийнэ —
      // blur нь AG Grid-ийн stopEditingWhenCellsLoseFocus-ыг синхроноор
      // ажиллуулж linesRef-ийг шинэчилнэ.
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest?.(".ag-cell")) active.blur();
      handleSave("posted");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, shortcutsEnabled, embedded, saving, date, description]);

  function handlePrint() {
    // Standalone цонхонд бүх хуудас өөрөө print:hidden/print:block-оор
    // зохицуулагдсан; панель горимд portal + body class хэрэгтэй.
    if (!embedded) window.print();
    else setPrinting(true);
  }

  useEffect(() => {
    if (!printing) return;
    // Class нь globals.css-ийн дүрмээр sheet-ээс бусад бүгдийг нуудаг.
    document.body.classList.add("ea-printing-voucher");
    window.print();
    document.body.classList.remove("ea-printing-voucher");
    // window.print() нь хэвлэх dialog хаагдтал блоклоно — дараа нь portal-ыг
    // буулгана (sync setState effect дотор хориотой тул timeout-оор).
    const timer = setTimeout(() => setPrinting(false), 0);
    return () => clearTimeout(timer);
  }, [printing]);

  async function copyId() {
    if (!voucherId) return;
    try {
      await navigator.clipboard.writeText(voucherId);
      setCopyState("ok");
    } catch {
      // Зөвшөөрөлгүй/HTTP орчинд clipboard ажиллахгүй — хэрэглэгчид хэлнэ
      // (ID нь сонгож хуулах боломжтой текстээр хажууд нь байгаа).
      setCopyState("fail");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  }

  async function handleDuplicate() {
    if (!voucherId) return;
    try {
      const { id } = await duplicateVoucher(voucherId);
      if (embedded) {
        onOpenVoucher?.(id);
        onDone?.();
      } else {
        window.location.href = `/gl/journal/${id}/edit`;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Хуулбарлаж чадсангүй");
    }
  }

  async function handleStorno() {
    if (!voucherId) return;
    if (!confirm("Энэ журналд буцаалтын бичилт үүсгэх үү? Эх журнал 'Буцаагдсан' төлөвт орно."))
      return;
    try {
      await unpostVoucher(voucherId);
      finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Буцааж чадсангүй");
    }
  }

  const statusLabel =
    voucherStatus === "posted"
      ? "Бичигдсэн"
      : voucherStatus === "reversed"
        ? "Буцаагдсан"
        : "Ноорог";

  /* ── Хэвлэх баримт — зөвхөн print үед харагдана ─────────────────────── */
  const printSheet = (
    <div className="ea-print-sheet hidden print:block bg-white p-8 text-black">
      <div className="mb-1 text-center text-lg font-bold uppercase tracking-wide">
        Журналын баримт
      </div>
      <div className="mb-5 text-center text-xs text-neutral-500">
        № {voucherId ?? "—"}
      </div>
      <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-neutral-500">Огноо: </span>
          <span className="font-mono">{date}</span>
        </div>
        <div>
          <span className="text-neutral-500">Төлөв: </span>
          {statusLabel}
        </div>
        <div>
          <span className="text-neutral-500">Мөр: </span>
          <span className="font-mono">{lines.length}</span>
        </div>
        <div className="col-span-3">
          <span className="text-neutral-500">Гүйлгээний утга: </span>
          {description || "—"}
        </div>
      </div>

      <div
        className="grid border-t border-b border-black text-xs"
        style={{ gridTemplateColumns: "1.4fr 1.2fr 1.4fr 0.9fr 0.9fr" }}
      >
        <div className="border-b border-neutral-400 py-1.5 font-semibold">Данс</div>
        <div className="border-b border-neutral-400 py-1.5 font-semibold">Дансны нэр</div>
        <div className="border-b border-neutral-400 py-1.5 font-semibold">Тайлбар</div>
        <div className="border-b border-neutral-400 py-1.5 text-right font-semibold">
          Дебет
        </div>
        <div className="border-b border-neutral-400 py-1.5 text-right font-semibold">
          Кредит
        </div>
        {lines.map((line) => {
          const label = accountLabel(line.account);
          return (
            <div key={line.id} className="contents">
              <div className="py-1 font-mono">{label.code}</div>
              <div className="py-1">{label.name}</div>
              <div className="py-1">{line.description || ""}</div>
              <div className="py-1 text-right font-mono">
                {line.debit ? fmt(line.debit) : ""}
              </div>
              <div className="py-1 text-right font-mono">
                {line.credit ? fmt(line.credit) : ""}
              </div>
            </div>
          );
        })}
        <div className="col-span-3 border-t border-black py-1.5 font-semibold">
          Нийт дүн
        </div>
        <div className="border-t border-black py-1.5 text-right font-mono font-semibold">
          {fmt(totalDebit)}
        </div>
        <div className="border-t border-black py-1.5 text-right font-mono font-semibold">
          {fmt(totalCredit)}
        </div>
      </div>

      <div className="mt-12 grid grid-cols-3 gap-8 text-xs">
        <div>
          Бүрдүүлсэн: _______________________
          <div className="mt-1 text-neutral-500">/овог нэр, гарын үсэг/</div>
        </div>
        <div>
          Шалгасан: _______________________
          <div className="mt-1 text-neutral-500">/овог нэр, гарын үсэг/</div>
        </div>
        <div>
          Батласан: _______________________
          <div className="mt-1 text-neutral-500">/овог нэр, гарын үсэг/</div>
        </div>
      </div>
    </div>
  );

  return (
    <>
    <div
      ref={formRootRef}
      className={cn(
        "flex flex-col print:hidden",
        embedded ? "min-h-0 flex-1" : "h-screen"
      )}
      style={{
        background: embedded ? "var(--ea-surface)" : "var(--ea-bg)",
        fontFamily: "var(--ea-font-sans)",
      }}
    >
      {/* Панель дотор гарчгийн мөрийг панелийн толгой үзүүлдэг тул давхардуулахгүй */}
      {!embedded && (
      <header
        className="px-6 flex items-center shrink-0 h-12 gap-3"
        style={{
          background: "var(--ea-surface)",
          borderBottom: "1px solid var(--ea-border)",
        }}
      >
        <Button variant="ghost" size="sm" onClick={cancel}>
          <Icon name="chevronLeft" />
          Буцах
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <span className="text-sm font-semibold" style={{ color: "var(--ea-text-1)" }}>
          {readOnly ? "Журнал харах" : isEdit ? "Журнал засах" : "Журнал бичих"}
        </span>
        {!readOnly && (
          <StatusBadge tone="warning">Ноорог</StatusBadge>
        )}
        {readOnly && voucherStatus && (
          <StatusBadge
            tone={
              voucherStatus === "posted"
                ? "success"
                : voucherStatus === "draft"
                  ? "warning"
                  : "muted"
            }
          >
            {voucherStatus === "posted"
              ? "Бичигдсэн"
              : voucherStatus === "reversed"
                ? "Буцаагдсан"
                : "Ноорог"}
          </StatusBadge>
        )}
      </header>
      )}

      <div
        className={cn(
          "flex-1 overflow-y-auto",
          embedded ? "px-4 py-4" : "px-6 py-6"
        )}
      >
        <div className="max-w-screen-xl mx-auto space-y-4">
          <div
            className="p-5"
            style={{
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border)",
              borderRadius: 10,
            }}
          >
            {/* Толгой — НЭГ бүтэц, НЭГ талбарын component. readOnly нь
                зөвхөн нүд дотор текст үү, input уу гэдгийг шийднэ. */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
                <div className="grid min-w-0 flex-1 gap-x-8 gap-y-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <HeaderField label="Огноо" htmlFor="voucher-date">
                    {readOnly ? (
                      <span className="font-mono text-sm text-[var(--ea-text-1)]">
                        {date}
                      </span>
                    ) : (
                      <Input
                        id="voucher-date"
                        type="date"
                        className="h-8 w-full"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    )}
                  </HeaderField>
                  <HeaderField
                    label="Гүйлгээний утга"
                    htmlFor="voucher-description"
                  >
                    {readOnly ? (
                      <span className="truncate text-sm text-[var(--ea-text-1)]">
                        {description || "—"}
                      </span>
                    ) : (
                      <Input
                        id="voucher-description"
                        type="text"
                        className="h-8 w-full"
                        placeholder="Гүйлгээний тайлбар оруулна уу"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    )}
                  </HeaderField>
                </div>

                <div className="flex shrink-0 gap-6 text-right">
                  <HeaderField label="Нийт дебет" align="right">
                    <span className="font-mono text-lg font-semibold text-[var(--ea-text-1)]">
                      {fmt(totalDebit)}
                    </span>
                  </HeaderField>
                  <HeaderField label="Нийт кредит" align="right">
                    <span className="font-mono text-lg font-semibold text-[var(--ea-text-1)]">
                      {fmt(totalCredit)}
                    </span>
                  </HeaderField>
                </div>
              </div>

              <div
                className="grid grid-cols-2 gap-x-8 gap-y-3 pt-3 sm:grid-cols-4"
                style={{ borderTop: "1px solid var(--ea-border)" }}
              >
                <HeaderField label="Мөрийн тоо">
                  <span className="font-mono text-sm text-[var(--ea-text-1)]">
                    {lines.length}
                  </span>
                </HeaderField>
                <HeaderField label="Үүсгэсэн">
                  <span className="font-mono text-sm text-[var(--ea-text-1)]">
                    {voucherCreatedAt ?? "—"}
                  </span>
                </HeaderField>
                <HeaderField label="Дугаар" className="col-span-2">
                  {voucherId ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      {/* Сонгож хуулах боломжтой — товч нь зөвхөн хурдавчлал */}
                      <span className="min-w-0 select-all truncate font-mono text-xs text-[var(--ea-text-2)]">
                        {voucherId}
                      </span>
                      <button
                        type="button"
                        onClick={copyId}
                        title="ID хуулах"
                        aria-label="Журналын ID хуулах"
                        className="shrink-0 text-[var(--ea-text-4)] transition-colors hover:text-[var(--ea-primary)]"
                      >
                        <Icon name="copy" size="xs" />
                      </button>
                      {copyState !== "idle" && (
                        <span
                          className={
                            copyState === "ok"
                              ? "shrink-0 text-[10px] text-[var(--ea-success)]"
                              : "shrink-0 text-[10px] text-[var(--ea-danger)]"
                          }
                        >
                          {copyState === "ok" ? "Хуулагдлаа" : "Хуулж чадсангүй"}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--ea-text-4)]">
                      Хадгалахад үүснэ
                    </span>
                  )}
                </HeaderField>
              </div>
            </div>
          </div>

          <div
            style={{
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <JournalLinesGrid
              lines={lines}
              onLinesChange={updateLines}
              activeSegIds={activeSegIds}
              segOptions={segOptions}
              defaultSegments={defaultSegments}
              onError={setError}
              readOnly={readOnly}
            />
          </div>
        </div>
      </div>

      <footer
        className={cn(
          "flex shrink-0 items-center justify-between py-3",
          embedded ? "px-4" : "px-6"
        )}
        style={{
          background: "var(--ea-surface)",
          borderTop: "1px solid var(--ea-border)",
        }}
      >
        <div className="flex items-center gap-3">
          <StatusBadge tone={isEmpty ? "muted" : balanced ? "success" : "danger"}>
            {isEmpty ? "Дүн оруулаагүй" : balanced ? "✓ Тэнцсэн" : `Зөрүү: ${fmt(diff)}`}
          </StatusBadge>
          {error && (
            <span className="text-sm" style={{ color: "var(--ea-danger)" }}>
              {error}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {readOnly ? (
            <>
              <Button variant="outline" onClick={handlePrint}>
                <Icon name="print" size="sm" />
                Хэвлэх
              </Button>
              <Button variant="outline" onClick={handleDuplicate}>
                <Icon name="duplicate" size="sm" />
                Хуулбарлах
              </Button>
              {voucherStatus === "posted" && (
                <Button variant="outline" onClick={handleStorno}>
                  <Icon name="reset" size="sm" />
                  Буцаалт хийх
                </Button>
              )}
              <Separator orientation="vertical" className="h-5" />
              <Button variant="outline" onClick={cancel}>
                Хаах
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => updateLines((p) => [...p, makeEmptyLine()])}
              >
                + Мөр нэмэх
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Icon name="spreadsheet" size="sm" />
                Excel импорт
              </Button>
              <Separator orientation="vertical" className="h-5" />
              <Button variant="outline" onClick={cancel}>
                Болих
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSave("draft")}
                disabled={saving !== null}
              >
                {saving === "draft" ? "Хадгалж байна..." : "Ноорог"}
              </Button>
              <Button
                onClick={() => handleSave("posted")}
                disabled={!balanced || saving !== null}
                title="Ctrl+Enter"
              >
                {saving === "posted" ? "Хадгалж байна..." : "Хадгалах"}
              </Button>
            </>
          )}
        </div>
      </footer>
    </div>

      {/* Панель горимд sheet-ийг body-д, зөвхөн хэвлэж байх агшинд — олон
          панель нээлттэй байсан ч зөвхөн ЭНЭ журнал хэвлэгдэнэ. Standalone
          цонхонд хуучин шигээ байнга (Ctrl+P ч ажиллана). */}
      {embedded
        ? printing &&
          typeof document !== "undefined" &&
          createPortal(printSheet, document.body)
        : printSheet}

      {!readOnly && (
        <ExcelImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          spec={importSpec}
          title="Журналын мөр импортлох"
          onImport={handleImportLines}
        />
      )}
    </>
  );
}
