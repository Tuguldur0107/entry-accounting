"use client";

// Цалингийн хуудас — ажилтан бүрд өгөх сарын задаргаа (A4, хэвлэх).
//
// Дүн бүр цалингийн бодолтын ХАДГАЛАГДСАН мөрөөс гарна (lib/payroll/payslip.ts
// зөвхөн бүтэцчилнэ) тул хуудас нь GL журнал, банкны олголттой үргэлж таарна.
// Хэвлэх нь POS-ийн баримттай ИЖИЛ хэв маяг: portal + body класс (§UI).

import { useMemo, useState, type ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ColDef, RowDoubleClickedEvent } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import {
  PayrollReportTabs,
} from "@/components/payroll/payroll-report-tabs";
import type { PayslipReport } from "@/lib/actions/payroll";
import type { Payslip } from "@/lib/payroll/payslip";
import { col } from "@/lib/grid/columnTypes";
import { fmtMnt } from "@/lib/grid/formatters";
import { fmtPeriodCode } from "@/lib/periods/period";

interface Props {
  data: PayslipReport;
}

/** Хэвлэх туслах — `print()` дуудахад зөвхөн хуудсууд хэвлэгдэнэ. */
function usePayslipPrint(content: ReactNode) {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("ea-printing-payslip");
    window.print();
    document.body.classList.remove("ea-printing-payslip");
    const timer = setTimeout(() => setPrinting(false), 0);
    return () => clearTimeout(timer);
  }, [printing]);

  const portal =
    printing && typeof document !== "undefined"
      ? createPortal(
          <div className="ea-payslip-sheets bg-white text-black">{content}</div>,
          document.body
        )
      : null;

  return { print: () => setPrinting(true), portal };
}

type Row = {
  employeeId: string;
  employeeName: string;
  position: string;
  earnings: number;
  deductions: number;
  taxFree: number;
  netSalary: number;
  advanceAmount: number;
  finalNet: number;
};

export function PayslipReportView({ data }: Props) {
  const { periodMonth, company, payslips, errors } = data;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => payslips.find((slip) => slip.employeeId === selectedId) ?? null,
    [payslips, selectedId]
  );

  // Хэвлэхэд: сонгосон ажилтан байвал ЗӨВХӨН тэр, үгүй бол БҮГД.
  const toPrint = selected ? [selected] : payslips;
  const { print, portal } = usePayslipPrint(
    toPrint.map((slip) => (
      <PayslipSheet key={slip.employeeId} slip={slip} company={company} />
    ))
  );

  const rows = useMemo<Row[]>(
    () =>
      payslips.map((slip) => ({
        employeeId: slip.employeeId,
        employeeName: slip.employeeName,
        position: slip.position,
        earnings: slip.earnings.total,
        deductions: slip.deductions.total,
        taxFree: slip.taxFree?.total ?? 0,
        netSalary: slip.netSalary,
        advanceAmount: slip.advanceAmount,
        finalNet: slip.finalNet,
      })),
    [payslips]
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          employeeId: "__totals__",
          employeeName: "Нийт",
          position: "",
          earnings: sum.earnings + row.earnings,
          deductions: sum.deductions + row.deductions,
          taxFree: sum.taxFree + row.taxFree,
          netSalary: sum.netSalary + row.netSalary,
          advanceAmount: sum.advanceAmount + row.advanceAmount,
          finalNet: sum.finalNet + row.finalNet,
        }),
        {
          employeeId: "__totals__",
          employeeName: "Нийт",
          position: "",
          earnings: 0,
          deductions: 0,
          taxFree: 0,
          netSalary: 0,
          advanceAmount: 0,
          finalNet: 0,
        } satisfies Row
      ),
    [rows]
  );

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      col<Row>({
        eaType: "readonly-text",
        headerName: "Ажилтан",
        field: "employeeName",
        minWidth: 170,
        flex: 1,
        cellClassRules: { "font-semibold": (params) => !!params.node.rowPinned },
      }),
      col<Row>({
        eaType: "readonly-text",
        headerName: "Албан тушаал",
        field: "position",
        width: 150,
        cellClass: "text-xs text-[var(--ea-text-3)]",
      }),
      col<Row>({
        eaType: "readonly-money",
        headerName: "Нийт олголт",
        field: "earnings",
        width: 145,
      }),
      col<Row>({
        eaType: "readonly-money",
        headerName: "Суутгал",
        field: "deductions",
        width: 135,
      }),
      col<Row>({
        eaType: "readonly-money",
        headerName: "Татваргүй (ХЧТА)",
        field: "taxFree",
        width: 160,
      }),
      col<Row>({
        eaType: "readonly-money",
        headerName: "Гарт олгох",
        field: "netSalary",
        width: 145,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
      }),
      col<Row>({
        eaType: "readonly-money",
        headerName: "Урьдчилгаа",
        field: "advanceAmount",
        width: 135,
      }),
      col<Row>({
        eaType: "readonly-money",
        headerName: "Сүүл цалин",
        field: "finalNet",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
      }),
    ],
    []
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Цалингийн хуудас — {fmtPeriodCode(periodMonth)}
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Ажилтан бүрийн сарын задаргаа — олголт, суутгал, гарт олгох дүн.
            Мөр дээр давхар дарж нэг ажилтныг сонгоод хэвлэнэ; сонгоогүй бол
            бүх ажилтны хуудас дараалан хэвлэгдэнэ.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected && (
            <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>
              <Icon name="close" size="sm" />
              Сонголт болих
            </Button>
          )}
          <Button size="sm" onClick={print} disabled={payslips.length === 0}>
            <Icon name="print" size="sm" />
            {selected ? `${selected.employeeName} — хэвлэх` : "Бүгдийг хэвлэх"}
          </Button>
        </div>
      </div>

      <PayrollReportTabs value="payslip" />

      {errors.length > 0 && (
        <p className="rounded-md border border-[var(--ea-danger)]/40 bg-[var(--ea-danger)]/8 px-3 py-2 text-xs text-[var(--ea-text-1)]">
          {errors.length} ажилтны хуудас гарсангүй:{" "}
          {errors.map((row) => `${row.employeeName} — ${row.message}`).join("; ")}
        </p>
      )}

      {payslips.length === 0 ? (
        <EmptyState
          icon="document"
          title="Цалингийн бодолт хийгдээгүй байна"
          description="Цалин → Цалин бодолт хэсэгт «Бодолт хийх» дарсны дараа хуудас үүснэ."
        />
      ) : (
        <>
          <DataGridDynamic<Row>
            rowData={rows}
            columnDefs={columns}
            getRowId={(params) => params.data.employeeId}
            pinnedBottomRowData={[totals]}
            onRowDoubleClicked={(event: RowDoubleClickedEvent<Row>) => {
              if (!event.data || event.node.rowPinned) return;
              setSelectedId(event.data.employeeId);
            }}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          />

          {selected && (
            <div className="max-h-[50vh] overflow-y-auto rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4">
              <PayslipSheet slip={selected} company={company} />
            </div>
          )}
        </>
      )}

      {portal}
    </section>
  );
}

/** A4 хуудсын бие — дэлгэц дээр ч, хэвлэхэд ч ИЖИЛ markup. */
export function PayslipSheet({
  slip,
  company,
}: {
  slip: Payslip;
  company: PayslipReport["company"];
}) {
  return (
    <article className="ea-payslip mx-auto w-full max-w-[190mm] text-[12px] leading-relaxed text-black">
      <header className="mb-3 flex items-start justify-between gap-4 border-b border-black/20 pb-2">
        <div>
          <p className="text-[13px] font-semibold">{company.name || "—"}</p>
          <p className="text-[11px] text-black/60">
            {[company.registerNo && `РД: ${company.registerNo}`, company.address, company.phone]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[13px] font-semibold">ЦАЛИНГИЙН ХУУДАС</p>
          <p className="text-[11px] text-black/60">{fmtPeriodCode(slip.periodMonth)}</p>
        </div>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
        <p>
          <span className="text-black/60">Ажилтан:</span>{" "}
          <span className="font-medium">{slip.employeeName}</span>
        </p>
        <p>
          <span className="text-black/60">Регистр:</span> {slip.registerNo || "—"}
        </p>
        <p>
          <span className="text-black/60">Албан тушаал:</span> {slip.position || "—"}
        </p>
        <p>
          <span className="text-black/60">Хэлтэс:</span> {slip.department || "—"}
        </p>
      </div>

      <SheetSection section={slip.earnings} />
      <SheetSection section={slip.deductions} />
      {slip.taxFree && <SheetSection section={slip.taxFree} />}

      <div className="mt-3 border-t-2 border-black/70 pt-2">
        <SheetRow label="ГАРТ ОЛГОХ" amount={slip.netSalary} strong />
        <SheetRow label="Урьдчилгаагаар олгосон" amount={-slip.advanceAmount} />
        <SheetRow label="Сүүл цалин" amount={slip.finalNet} strong />
      </div>

      <p className="mt-3 text-[10px] text-black/60">
        Ажил олгогчийн НДШ {fmtMnt(slip.employerSi)} (мэдээллийн зорилгоор —
        ажилтнаас суутгагдахгүй).
        {slip.averageNote ? ` ${slip.averageNote}.` : ""}
      </p>

      <div className="mt-6 flex justify-between gap-8 text-[11px]">
        <p>Нягтлан бодогч: ______________________</p>
        <p>Ажилтан: ______________________</p>
      </div>
    </article>
  );
}

function SheetSection({ section }: { section: Payslip["earnings"] }) {
  return (
    <div className="mb-2">
      <p className="border-b border-black/20 pb-0.5 text-[11px] font-semibold uppercase tracking-wide">
        {section.title}
      </p>
      {section.lines.map((line) => (
        <SheetRow
          key={line.label}
          label={line.label}
          note={line.note}
          amount={line.amount}
        />
      ))}
      <SheetRow label={`${section.title} — нийт`} amount={section.total} subtotal />
    </div>
  );
}

function SheetRow({
  label,
  note,
  amount,
  strong,
  subtotal,
}: {
  label: string;
  note?: string;
  amount: number;
  strong?: boolean;
  subtotal?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-[1px] ${
        subtotal ? "border-t border-black/20 font-medium" : ""
      } ${strong ? "text-[13px] font-semibold" : ""}`}
    >
      <span>
        {label}
        {note && <span className="ml-1 text-[10px] text-black/50">({note})</span>}
      </span>
      <span className="font-mono tabular-nums">{fmtMnt(amount)}</span>
    </div>
  );
}
