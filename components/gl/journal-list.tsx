"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { toast } from "sonner";
import {
  deleteVoucher,
  postVoucher,
  unpostVoucher,
} from "@/lib/actions/gl";
import { importJournalVouchers } from "@/lib/actions/journal-import";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ExcelImportDialog } from "@/components/excel/excel-import-dialog";
import { downloadWorkbook } from "@/lib/excel/core";
import {
  groupVoucherRows,
  journalVouchersSpec,
  type VoucherRowImport,
} from "@/lib/excel/specs";
import { openVoucherPanel, refreshOpenPanels } from "@/lib/store/panel-store";
import { fmtMnt } from "@/lib/reports/balances";
import { fmtAccountDisplay } from "@/lib/grid/segments";
import type {
  CellClickedEvent,
  ColDef,
  ICellRendererParams,
} from "ag-grid-community";

const PAGE_SIZE = 15;

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  /** Excel импортын normalize — журналын редактортой ижил (S1 auto-fill). */
  defaultSegments?: Record<number, string>;
  initialStart?: string;
  initialEnd?: string;
}

type VoucherRow = JournalVoucherWithLines;

const LINE_HEIGHT = 22;
const ROW_PADDING = 16;

// Огнооны шүүлтүүр нь topbar-ийн PeriodFilter (components/periods/
// period-filter.tsx, cookie-д хадгалагдана) — хуудас нь сонголтыг
// initialStart/initialEnd болгож дамжуулдаг тул энэ component toolbar
// render хийхгүй. Доорх default нь зөвхөн аюулгүйн fallback.
// `accounts` prop одоогоор ашиглагдахгүй (page-level shape хадгална).
function defaultMonthRange() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, today.getMonth() + 1, 0).getDate();
  return {
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function JournalList({
  vouchers,
  accounts,
  activeSegIds,
  defaultSegments = {},
  initialStart,
  initialEnd,
}: Props) {
  const defaults = defaultMonthRange();
  const appliedStart = initialStart ?? defaults.start;
  const appliedEnd = initialEnd ?? defaults.end;
  const { confirm, dialog: confirmDialog } = useConfirm();
  const router = useRouter();
  const [importOpen, setImportOpen] = useState(false);

  // Багц импортын спек — Баримт № ижил мөрүүд нэг журнал болж НООРОГ үүснэ.
  const importSpec = useMemo(
    () =>
      journalVouchersSpec({
        accountsByMain: new Map(
          accounts.map((account) => [account.number, account.name])
        ),
        activeSegIds,
        defaultSegments,
      }),
    [accounts, activeSegIds, defaultSegments]
  );

  async function handleBatchImport(rows: VoucherRowImport[]) {
    const grouped = groupVoucherRows(rows);
    const clean = grouped.filter((entry) => entry.errors.length === 0);
    const broken = grouped.filter((entry) => entry.errors.length > 0);

    if (clean.length === 0)
      return broken
        .map((entry) => `${entry.voucherKey}: ${entry.errors.join(", ")}`)
        .join(" · ");

    const result = await importJournalVouchers(
      clean.map((entry) => ({
        voucherKey: entry.voucherKey,
        date: entry.date,
        description: entry.description,
        lines: entry.lines,
      }))
    );
    if (!result.ok)
      return result.code === "unauthenticated"
        ? "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү."
        : "Оруулахад алдаа гарлаа. Дахин оролдоно уу.";

    if (result.created > 0)
      toast.success(`${result.created} журнал ноорог болж үүслээ`);
    for (const failure of [
      ...broken.map((entry) => ({
        voucherKey: entry.voucherKey,
        reason: entry.errors.join(", "),
      })),
      ...result.failures,
    ])
      toast.error(`${failure.voucherKey}: ${failure.reason}`);

    router.refresh();
    // Юу ч үүсээгүй бол диалогийг нээлттэй үлдээж шалтгааныг үзүүлнэ.
    if (result.created === 0 && result.failures.length > 0)
      return result.failures
        .map((failure) => `${failure.voucherKey}: ${failure.reason}`)
        .join(" · ");
  }

  // Экспорт — багц импортын загвартай ИЖИЛ багана (+ Статус) тул экспортолсон
  // файлыг шууд буцааж импортлож болно (round-trip).
  async function handleExport() {
    const rows = filtered;
    if (rows.length === 0) {
      toast.error("Экспортлох бичилт алга");
      return;
    }
    const nameByMain = new Map(accounts.map((a) => [a.number, a.name]));
    await downloadWorkbook({
      slug: "entry-journal",
      sheetName: "Журнал",
      columns: [
        { header: "Баримт №", width: 12 },
        { header: "Огноо", width: 12 },
        { header: "Гүйлгээний утга", width: 30 },
        { header: "Данс", width: 22 },
        { header: "Дансны нэр", width: 26 },
        { header: "Дебет", width: 16, kind: "number" },
        { header: "Кредит", width: 16, kind: "number" },
        { header: "Мөрийн тайлбар", width: 26 },
        { header: "Статус", width: 12 },
      ],
      rows: rows.flatMap((voucher) =>
        voucher.lines.map((line) => {
          const parts = line.accountNumber.split(".");
          const main = parts.length === 10 ? parts[2] : line.accountNumber;
          return [
            voucher.id.slice(0, 8),
            voucher.date,
            voucher.description,
            fmtAccountDisplay(line.accountNumber, activeSegIds),
            nameByMain.get(main) ?? "",
            Number(line.debit) || null,
            Number(line.credit) || null,
            line.description,
            voucher.status === "posted"
              ? "Бичигдсэн"
              : voucher.status === "reversed"
                ? "Буцаагдсан"
                : "Ноорог",
          ];
        })
      ),
    });
  }

  // columnDefs нь [activeSegIds]-ээр л memo хийгддэг тул renderer доторх
  // handler-ууд эхний render-ийн vouchers-ийг хаасан хэвээр үлддэг. Ref-ээр
  // үргэлж СҮҮЛИЙН жагсаалтаас уншина — эс бөгөөс refresh-ийн дараах
  // баталгаажуулалтын текст хуучин/буруу тайлбар үзүүлнэ.
  const vouchersRef = useRef(vouchers);
  useEffect(() => {
    vouchersRef.current = vouchers;
  }, [vouchers]);

  // Диалогийн текстэд аль журнал болохыг нь заана — зөвхөн id-гаар
  // баталгаажуулах нь буруу бичилт батлах эрсдэлтэй.
  function describeVoucher(id: string) {
    const voucher = vouchersRef.current.find((entry) => entry.id === id);
    if (!voucher) return "Энэ журнал";
    return `${voucher.date} — ${voucher.description || "тайлбаргүй"}`;
  }

  async function handleDelete(id: string) {
    const voucher = vouchersRef.current.find((entry) => entry.id === id);
    const posted = voucher?.status === "posted";
    const ok = await confirm({
      title: "Журнал устгах",
      description: posted
        ? `${describeVoucher(id)} БАТЛАГДСАН бичилтийг GL-ээс бүрмөсөн устгах уу? (Буцаалт биш — аудитын ул мөр үлдэхгүй. Дэд дэвтрийн баримттай холбоотой бол эх баримтаар нь устгахыг шаардана.)`
        : `${describeVoucher(id)} бичилтийг устгах уу?`,
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteVoucher(id);
      toast.success("Журнал устгагдлаа");
      refreshOpenPanels();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Устгах үед алдаа гарлаа");
    }
  }

  async function handlePost(id: string) {
    const ok = await confirm({
      title: "Журнал батлах",
      description: `${describeVoucher(id)} ноорогийг батлах уу?`,
      confirmText: "Батлах",
    });
    if (!ok) return;
    try {
      await postVoucher(id);
      toast.success("Журнал батлагдлаа");
      refreshOpenPanels();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Батлах үед алдаа гарлаа");
    }
  }

  async function handleUnpost(id: string) {
    const ok = await confirm({
      title: "Ноорог болгох",
      description: `${describeVoucher(id)} батлагдсан журналыг ноорог болгож буцаах уу?`,
      confirmText: "Буцаах",
    });
    if (!ok) return;
    try {
      await unpostVoucher(id);
      toast.success("Журнал ноорог болов");
      refreshOpenPanels();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Буцаах үед алдаа гарлаа");
    }
  }

  // Мөр дээр дарахад ижил цонх нээгдэнэ — ноорог бол засварлагч,
  // бичигдсэн/буцаагдсан бол харах горим.
  function handleRowClick(event: CellClickedEvent<VoucherRow>) {
    if (event.colDef.colId === "actions") return;
    if (event.data) handleEdit(event.data.id);
  }

  // Тусдаа browser цонх БИШ — апп доторх ажлын панель. Нэг журналыг хоёр
  // удаа дарвал шинээр нээхгүй, байгааг нь фокуслоно (store дотор dedupe).
  function handleEdit(id: string) {
    const voucher = vouchersRef.current.find((entry) => entry.id === id);
    openVoucherPanel(id, voucher?.description || "Журнал");
  }

  const filtered = useMemo(
    () =>
      vouchers.filter((v) => {
        if (appliedStart && v.date < appliedStart) return false;
        if (appliedEnd && v.date > appliedEnd) return false;
        return true;
      }),
    [vouchers, appliedStart, appliedEnd]
  );

  const grandDebit = filtered.reduce(
    (s, v) => s + v.lines.reduce((ls, l) => ls + Number(l.debit), 0),
    0
  );
  const grandCredit = filtered.reduce(
    (s, v) => s + v.lines.reduce((ls, l) => ls + Number(l.credit), 0),
    0
  );
  const balanced = Math.abs(grandDebit - grandCredit) <= 0.01;

  const columnDefs = useMemo<ColDef<VoucherRow>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 110,
        cellClass: "font-mono text-xs",
        sortable: true,
      },
      {
        headerName: "ID",
        field: "id",
        width: 80,
        valueGetter: (p) => p.data?.id.slice(0, 8) ?? "",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <span
            className="font-mono text-[10px] text-[var(--ea-text-4)] select-all"
            title={p.data?.id}
          >
            {p.data?.id?.slice(0, 8) ?? ""}
          </span>
        ),
        sortable: true,
      },
      {
        headerName: "Утга",
        field: "description",
        flex: 1,
        minWidth: 180,
        sortable: true,
        autoHeight: true,
        cellClass: "text-xs font-medium",
      },
      {
        headerName: "Данс",
        colId: "lines.account",
        flex: 1,
        minWidth: 160,
        sortable: false,
        valueGetter: (p) =>
          p.data?.lines
            .map((line) => fmtAccountDisplay(line.accountNumber, activeSegIds))
            .join(" · ") ?? "",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <div className="flex flex-col py-2 leading-[22px]">
            {p.data?.lines.map((l) => (
              <span key={l.id} className="font-mono text-xs text-[var(--ea-primary-500)] tracking-tight">
                {fmtAccountDisplay(l.accountNumber, activeSegIds)}
              </span>
            ))}
          </div>
        ),
      },
      {
        headerName: "Дебет",
        colId: "lines.debit",
        width: 130,
        cellClass: "ag-right-aligned-cell",
        headerClass: "ag-right-aligned-header",
        sortable: false,
        valueGetter: (p) =>
          p.data?.lines
            .map((line) => Number(line.debit))
            .filter((amount) => amount !== 0)
            .map(fmtMnt)
            .join(" · ") ?? "",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <div className="flex flex-col py-2 leading-[22px] items-end">
            {p.data?.lines.map((l) => {
              const n = Number(l.debit);
              return n !== 0 ? (
                <span key={l.id} className="tabular-nums text-xs font-mono">
                  {fmtMnt(n)}
                </span>
              ) : (
                <span key={l.id} className="tabular-nums text-xs font-mono text-[var(--ea-border-strong)]">
                  —
                </span>
              );
            })}
          </div>
        ),
      },
      {
        headerName: "Кредит",
        colId: "lines.credit",
        width: 130,
        cellClass: "ag-right-aligned-cell",
        headerClass: "ag-right-aligned-header",
        sortable: false,
        valueGetter: (p) =>
          p.data?.lines
            .map((line) => Number(line.credit))
            .filter((amount) => amount !== 0)
            .map(fmtMnt)
            .join(" · ") ?? "",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <div className="flex flex-col py-2 leading-[22px] items-end">
            {p.data?.lines.map((l) => {
              const n = Number(l.credit);
              return n !== 0 ? (
                <span key={l.id} className="tabular-nums text-xs font-mono">
                  {fmtMnt(n)}
                </span>
              ) : (
                <span key={l.id} className="tabular-nums text-xs font-mono text-[var(--ea-border-strong)]">
                  —
                </span>
              );
            })}
          </div>
        ),
      },
      {
        headerName: "Тайлбар",
        colId: "lines.description",
        width: 160,
        sortable: false,
        valueGetter: (p) =>
          p.data?.lines.map((line) => line.description).join(" · ") ?? "",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <div className="flex flex-col py-2 leading-[22px]">
            {p.data?.lines.map((l) => (
              <span key={l.id} className="text-xs text-[var(--ea-text-3)] truncate">
                {l.description}
              </span>
            ))}
          </div>
        ),
      },
      {
        headerName: "Статус",
        field: "status",
        width: 120,
        sortable: true,
        valueGetter: (p) => {
          if (p.data?.status === "posted") return "Бичигдсэн";
          if (p.data?.status === "reversed") return "Буцаагдсан";
          return "Ноорог";
        },
        cellClass: "ag-right-aligned-cell",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => {
          const v = p.data;
          if (!v) return null;
          const statusInfo =
            v.status === "posted"
              ? { dot: "var(--ea-success)", text: "text-[var(--ea-success-fg)]", label: "Бичигдсэн" }
              : v.status === "reversed"
              ? { dot: "var(--ea-text-4)", text: "text-[var(--ea-text-3)]", label: "Буцаагдсан" }
              : { dot: "var(--ea-warning)", text: "text-[var(--ea-warning-fg)]", label: "Ноорог" };
          return (
            <div className="flex items-center justify-end gap-1.5 h-full">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: statusInfo.dot }}
              />
              <span className={`text-[11px] font-medium whitespace-nowrap ${statusInfo.text}`}>
                {statusInfo.label}
              </span>
            </div>
          );
        },
      },
      {
        headerName: "Үйлдэл",
        colId: "actions",
        width: 120,
        sortable: false,
        filter: false,
        cellClass: "ag-right-aligned-cell",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => {
          const v = p.data;
          if (!v) return null;
          return (
            <div className="flex items-center justify-end gap-1 h-full">
              {v.status === "draft" && (
                <>
                  <button
                    onClick={() => handleEdit(v.id)}
                    className="ea-btn ea-btn--icon ea-btn--primary"
                    title="Журнал засах"
                    aria-label="Журнал засах"
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    onClick={() => handlePost(v.id)}
                    className="ea-btn ea-btn--icon ea-btn--success"
                    title="Батлах"
                    aria-label="Батлах"
                  >
                    <Icon name="approve" />
                  </button>
                  <button
                    onClick={() => handleDelete(v.id)}
                    className="ea-btn ea-btn--icon ea-btn--danger"
                    title="Устгах"
                    aria-label="Устгах"
                  >
                    <Icon name="delete" />
                  </button>
                </>
              )}
              {v.status === "posted" && (
                <>
                  <button
                    onClick={() => handleUnpost(v.id)}
                    className="ea-btn ea-btn--icon ea-btn--warning"
                    title="Ноорог болгож буцаах"
                    aria-label="Ноорог болгож буцаах"
                  >
                    <Icon name="undo" />
                  </button>
                  <button
                    onClick={() => handleDelete(v.id)}
                    className="ea-btn ea-btn--icon ea-btn--danger"
                    title="GL-ээс бүрмөсөн устгах"
                    aria-label="GL-ээс бүрмөсөн устгах"
                  >
                    <Icon name="delete" />
                  </button>
                </>
              )}
            </div>
          );
        },
      },
    ],
    // handleEdit нь vouchers-оос хамаарах ч мөрийн товч дарагдах үед л
    // дуудагддаг тул columnDefs-ийг дахин барих шаардлагагүй.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSegIds]
  );

  // Импорт/экспортын toolbar — жагсаалт хоосон үед ч харагдана (импорт нь
  // яг тэр үед хамгийн хэрэгтэй).
  const excelToolbar = (
    <div className="mb-3 flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
        <Icon name="spreadsheet" size="sm" />
        Excel импорт (багц)
      </Button>
      <Button variant="outline" size="sm" onClick={handleExport}>
        <Icon name="download" size="sm" />
        Excel экспорт
      </Button>
    </div>
  );

  const importDialog = (
    <ExcelImportDialog
      open={importOpen}
      onOpenChange={setImportOpen}
      spec={importSpec}
      title="Олон журнал багцаар импортлох"
      onImport={handleBatchImport}
    />
  );

  // Хоосон төлөвт ч {confirmDialog} render хийнэ — filter-ийн улмаас жагсаалт
  // хоосон болсон үед нээлттэй байсан диалог алга болохгүй.
  if (filtered.length === 0) {
    return (
      <>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {excelToolbar}
          <div className="flex flex-1 items-center justify-center bg-[var(--ea-surface)] border border-[var(--ea-border)] rounded-md py-16 text-center text-[var(--ea-text-4)] text-sm">
            Бичилт байхгүй
          </div>
        </section>
        {importDialog}
        {confirmDialog}
      </>
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {excelToolbar}
      <DataGridDynamic<VoucherRow>
        rowData={filtered}
        columnDefs={columnDefs}
        getRowId={(p) => p.data.id}
        getRowHeight={(p) =>
          Math.max(48, (p.data?.lines.length ?? 1) * LINE_HEIGHT + ROW_PADDING)
        }
        pagination
        paginationPageSize={PAGE_SIZE}
        paginationPageSizeSelector={false}
        height="flex"
        wrapperClassName="rounded-lg border border-[var(--ea-border)] overflow-hidden"
        suppressCellFocus
        cellSelection={false}
        onCellClicked={handleRowClick}
      />

      {/* Footer — баганатай харалдаа. Grid template AG-Grid-н column width-тэй тааруулсан */}
      <div
        className="mt-3 text-xs"
        style={{
          background: "var(--ea-bg-2)",
          border: "1px solid var(--ea-border)",
          borderRadius: 6,
          display: "grid",
          gridTemplateColumns:
            "110px 80px minmax(180px,1fr) minmax(160px,1fr) 130px 130px 160px 120px 120px",
          alignItems: "center",
          padding: "10px 0",
        }}
      >
        {/* Огноо + ID — "Нийт дүн" label spanning */}
        <div className="pl-3 col-span-2 text-[var(--ea-text-3)] font-medium" style={{ gridColumn: "1 / span 2" }}>
          Нийт дүн
        </div>
        {/* Утга, Данс — empty */}
        <div />
        <div />
        {/* Дебет */}
        <div className="text-right pr-3 tabular-nums font-mono font-semibold text-[var(--ea-text-1)]">
          {fmtMnt(grandDebit)}
        </div>
        {/* Кредит */}
        <div className="text-right pr-3 tabular-nums font-mono font-semibold text-[var(--ea-text-1)]">
          {fmtMnt(grandCredit)}
        </div>
        {/* Тайлбар — empty */}
        <div />
        {/* Статус */}
        <div className="flex items-center justify-end gap-1.5 pr-3">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              balanced ? "bg-[var(--ea-success)]" : "bg-[var(--ea-danger)]"
            }`}
          />
          <span
            className={`font-medium ${
              balanced ? "text-[var(--ea-success-fg)]" : "text-[var(--ea-danger-fg)]"
            }`}
          >
            {balanced ? "Тэнцсэн" : `Зөрүү ${fmtMnt(Math.abs(grandDebit - grandCredit))}`}
          </span>
        </div>
        {/* Үйлдэл — empty */}
        <div />
      </div>

      {importDialog}
      {confirmDialog}
    </section>
  );
}
