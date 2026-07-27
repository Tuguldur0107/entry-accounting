"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { Copy, Files, Printer, RotateCcw } from "lucide-react";
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
import { buildSegCode, fmtAccountDisplay } from "@/lib/grid/segments";
import {
  JournalLinesGrid,
  type JournalLineRow,
} from "@/components/journal/journal-lines-grid";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

function MetaField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--ea-text-4)]">{label}</div>
      <div
        className={`mt-0.5 break-words text-[var(--ea-text-1)]${mono ? " font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

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
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");

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
      closeWindow();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Алдаа гарлаа");
      setSaving(null);
    }
  }

  // Ctrl/Cmd+Enter — хадгалах shortcut (зөвхөн засварлах горимд).
  useEffect(() => {
    if (readOnly) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
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
  }, [readOnly, saving, date, description]);

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
      window.location.href = `/gl/journal/${id}/edit`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Хуулбарлаж чадсангүй");
    }
  }

  async function handleStorno() {
    if (!voucherId) return;
    if (!confirm("Энэ журналд сторно бичилт үүсгэх үү? Эх журнал 'Буцаагдсан' төлөвт орно."))
      return;
    try {
      await unpostVoucher(voucherId);
      closeWindow();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Сторно хийж чадсангүй");
    }
  }

  const statusLabel =
    voucherStatus === "posted"
      ? "Бичигдсэн"
      : voucherStatus === "reversed"
        ? "Буцаагдсан"
        : "Ноорог";

  return (
    <>
    <div
      className="h-screen flex flex-col print:hidden"
      style={{ background: "var(--ea-bg)", fontFamily: "var(--ea-font-sans)" }}
    >
      <header
        className="px-6 flex items-center shrink-0 h-12 gap-3"
        style={{
          background: "var(--ea-surface)",
          borderBottom: "1px solid var(--ea-border)",
        }}
      >
        <Button variant="ghost" size="sm" onClick={closeWindow}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Буцах
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <span className="text-sm font-semibold" style={{ color: "var(--ea-text-1)" }}>
          {readOnly ? "Журнал харах" : isEdit ? "Журнал засах" : "Журнал бичих"}
        </span>
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

      <div className="flex-1 overflow-y-auto py-6 px-6">
        <div className="max-w-screen-xl mx-auto space-y-4">
          <div
            className="p-5"
            style={{
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border)",
              borderRadius: 10,
            }}
          >
            {/* Толгой — хоёр горимд НЭГ бүтэц: зүүн талд талбарууд
                (харах горимд текст, засварлахад input), баруун талд том
                Дт/Кт нийлбэр, доор нь метадата. */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
                {readOnly ? (
                  <div className="grid min-w-0 flex-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
                    <MetaField label="Огноо" value={date} mono />
                    <MetaField
                      label="Гүйлгээний утга"
                      value={description || "—"}
                    />
                  </div>
                ) : (
                  <div
                    className="grid min-w-0 flex-1 gap-5"
                    style={{ gridTemplateColumns: "180px minmax(0,1fr)" }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="voucher-date">Огноо</Label>
                      <Input
                        id="voucher-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="voucher-description">Гүйлгээний утга</Label>
                      <Input
                        id="voucher-description"
                        type="text"
                        placeholder="Гүйлгээний тайлбар оруулна уу"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div className="flex shrink-0 gap-6 text-right">
                  <div>
                    <div className="text-[11px] text-[var(--ea-text-4)]">
                      Нийт дебет
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-semibold text-[var(--ea-text-1)]">
                      {fmt(totalDebit)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--ea-text-4)]">
                      Нийт кредит
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-semibold text-[var(--ea-text-1)]">
                      {fmt(totalCredit)}
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="grid grid-cols-2 gap-x-8 gap-y-3 pt-3 text-sm sm:grid-cols-4"
                style={{ borderTop: "1px solid var(--ea-border)" }}
              >
                <MetaField label="Мөрийн тоо" value={String(lines.length)} mono />
                {voucherCreatedAt && (
                  <MetaField label="Үүсгэсэн" value={voucherCreatedAt} mono />
                )}
                <div className="col-span-2">
                  <div className="text-[11px] text-[var(--ea-text-4)]">Дугаар</div>
                  {voucherId ? (
                    <div className="mt-0.5 flex items-start gap-1.5">
                      {/* Сонгож хуулах боломжтой — товч нь зөвхөн хурдавчлал */}
                      <span className="min-w-0 select-all break-all font-mono text-xs text-[var(--ea-text-2)]">
                        {voucherId}
                      </span>
                      <button
                        type="button"
                        onClick={copyId}
                        title="ID хуулах"
                        aria-label="Журналын ID хуулах"
                        className="mt-0.5 shrink-0 text-[var(--ea-text-4)] transition-colors hover:text-[var(--ea-primary)]"
                      >
                        <Copy size={11} />
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
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs text-[var(--ea-text-4)]">
                      Хадгалахад үүснэ
                    </div>
                  )}
                </div>
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
        className="px-6 py-3 flex items-center justify-between shrink-0"
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
              <Button variant="outline" onClick={() => window.print()}>
                <Printer size={14} />
                Хэвлэх
              </Button>
              <Button variant="outline" onClick={handleDuplicate}>
                <Files size={14} />
                Хуулбарлах
              </Button>
              {voucherStatus === "posted" && (
                <Button variant="outline" onClick={handleStorno}>
                  <RotateCcw size={14} />
                  Сторно хийх
                </Button>
              )}
              <Separator orientation="vertical" className="h-5" />
              <Button variant="outline" onClick={closeWindow}>
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
              <Separator orientation="vertical" className="h-5" />
              <Button variant="outline" onClick={closeWindow}>
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

      {/* ── Хэвлэх баримт — зөвхөн print үед харагдана ─────────────────── */}
      <div className="hidden print:block bg-white p-8 text-black">
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
    </>
  );
}
