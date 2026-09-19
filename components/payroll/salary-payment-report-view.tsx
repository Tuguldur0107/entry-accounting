"use client";

// Цалин олгох тайлан — банкны багц шилжүүлгийн жагсаалт.
//
// Сар (topbar-ийн периодын шүүлтүүр) + олголтын төрөл (урьдчилгаа / сүүл)
// сонгоод ажилтан тус бүрийн банк, данс, олгох дүнг гаргана. Дүн нь
// цалингийн бодолтын мөрөөс шууд гардаг тул нэхэмжлэхийн нийт дүнтэй
// үргэлж тэнцэнэ.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PageTabs } from "@/components/ui/tabs";
import { PayrollReportTabs } from "@/components/payroll/payroll-report-tabs";
import {
  type SalaryPaymentReport,
  type SalaryPaymentRow,
} from "@/lib/actions/payroll";
import {
  SALARY_BILL_LABEL,
  SALARY_BILL_STATUS_LABEL as BILL_STATUS_LABEL,
  type SalaryBillKind,
} from "@/lib/payroll/bills";
import { col } from "@/lib/grid/columnTypes";
import { downloadWorkbook } from "@/lib/excel/core";
import { fmtMnt } from "@/lib/grid/formatters";
import { fmtPeriodCode } from "@/lib/periods/period";

interface Props {
  data: SalaryPaymentReport;
}

const TABS = [
  { value: "advance", label: SALARY_BILL_LABEL.advance },
  { value: "final", label: SALARY_BILL_LABEL.final },
] as const satisfies readonly { value: SalaryBillKind; label: string }[];

export function SalaryPaymentReportView({ data }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<SalaryBillKind>(data.kind);

  const label = SALARY_BILL_LABEL[data.kind];

  function switchKind(next: SalaryBillKind) {
    setKind(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("kind", next);
    startTransition(() => router.replace(`/payroll/reports?${params}`));
  }

  const pinnedBottomRowData = useMemo(
    () => [
      {
        employeeId: "__totals__",
        employeeName: "Нийт",
        registerNo: "",
        position: "",
        bankName: "",
        bankAccountNo: "",
        iban: "",
        amount: data.total,
      } satisfies SalaryPaymentRow,
    ],
    [data.total]
  );

  const columns = useMemo<ColDef<SalaryPaymentRow>[]>(
    () => [
      col<SalaryPaymentRow>({
        eaType: "readonly-text",
        headerName: "Ажилтан",
        field: "employeeName",
        minWidth: 160,
        flex: 1,
        cellClassRules: {
          "font-semibold": (params) => !!params.node.rowPinned,
        },
      }),
      col<SalaryPaymentRow>({
        eaType: "readonly-text",
        headerName: "Регистр",
        field: "registerNo",
        width: 110,
        cellClass: "font-mono text-xs",
      }),
      col<SalaryPaymentRow>({
        eaType: "readonly-text",
        headerName: "Албан тушаал",
        field: "position",
        width: 140,
        cellClass: "text-xs text-[var(--ea-text-3)]",
      }),
      col<SalaryPaymentRow>({
        eaType: "readonly-text",
        headerName: "Банк",
        field: "bankName",
        width: 140,
      }),
      col<SalaryPaymentRow>({
        eaType: "readonly-text",
        headerName: "Дансны дугаар",
        field: "bankAccountNo",
        width: 150,
        cellClass: "font-mono",
      }),
      col<SalaryPaymentRow>({
        eaType: "readonly-text",
        headerName: "IBAN",
        field: "iban",
        width: 180,
        cellClass: "font-mono text-xs",
      }),
      col<SalaryPaymentRow>({
        eaType: "readonly-money",
        headerName: "Олгох дүн",
        field: "amount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
      }),
    ],
    []
  );

  function exportExcel() {
    if (data.rows.length === 0) {
      toast.error("Гаргах мөр алга");
      return;
    }
    void downloadWorkbook({
      slug: `entry-salary-${data.kind}-${data.periodMonth}`,
      sheetName: `${label} ${data.periodMonth}`,
      columns: [
        { header: "Ажилтан", width: 24 },
        { header: "Регистр", width: 14 },
        { header: "Албан тушаал", width: 20 },
        { header: "Банк", width: 18 },
        { header: "Дансны дугаар", width: 20 },
        { header: "IBAN", width: 26 },
        { header: "Олгох дүн", width: 16, kind: "number" },
      ],
      rows: data.rows.map((row) => [
        row.employeeName,
        row.registerNo,
        row.position,
        row.bankName,
        row.bankAccountNo,
        row.iban,
        row.amount,
      ]),
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Цалин олгох тайлан — {fmtPeriodCode(data.periodMonth)}
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            {label}
            {data.payDate && (
              <>
                {" "}
                · Олгох огноо{" "}
                <span className="font-mono">{data.payDate}</span>
              </>
            )}{" "}
            · Нийт{" "}
            <span className="font-mono font-medium text-[var(--ea-text-1)]">
              {fmtMnt(data.total)}
            </span>
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={exportExcel}
          disabled={data.rows.length === 0}
        >
          <Icon name="document" size="sm" />
          Excel татах
        </Button>
      </div>

      <PayrollReportTabs value="payment" />

      <PageTabs
        tabs={TABS}
        value={kind}
        onChange={switchKind}
        ariaLabel="Цалин олголтын төрөл"
      />

      {data.rows.length === 0 ? (
        <div className="flex min-h-56 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          <p>
            {fmtPeriodCode(data.periodMonth)} сард {label.toLowerCase()} алга.
          </p>
          <p className="text-xs">
            <Link
              href={`/payroll?period=${data.periodMonth}`}
              className="font-medium text-[var(--ea-primary)] underline"
            >
              Цалин бодолт
            </Link>{" "}
            хэсэгт бодолт хийж, урьдчилгааны ажилласан цагийг оруулна уу.
          </p>
        </div>
      ) : (
        <DataGridDynamic<SalaryPaymentRow>
          rowData={data.rows}
          columnDefs={columns}
          getRowId={(params) => params.data.employeeId}
          pinnedBottomRowData={pinnedBottomRowData}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        />
      )}

      {data.rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="text-[var(--ea-text-3)]">
            {data.rows.length} ажилтан
            {data.missingBankCount > 0 && (
              <span className="ml-2 font-medium text-[var(--ea-warning-fg)]">
                · {data.missingBankCount} ажилтны банкны данс бүртгэгдээгүй —{" "}
                <Link href="/payroll/employees" className="underline">
                  Ажилтнууд
                </Link>{" "}
                хэсэгт нөхнө үү
              </span>
            )}
          </p>
          <p className="text-[var(--ea-text-3)]">
            {data.bill ? (
              <>
                Өглөгийн нэхэмжлэх{" "}
                <Link
                  href="/payables/documents"
                  className="font-medium text-[var(--ea-primary)] underline"
                >
                  {data.bill.documentNo}
                </Link>{" "}
                · {BILL_STATUS_LABEL[data.bill.status] ?? data.bill.status} ·
                төлсөн{" "}
                <span className="font-mono">{fmtMnt(data.bill.paidAmount)}</span>{" "}
                / <span className="font-mono">{fmtMnt(data.bill.totalAmount)}</span>
              </>
            ) : (
              <>
                Өглөгийн нэхэмжлэх үүсээгүй —{" "}
                <Link
                  href={`/payroll?period=${data.periodMonth}`}
                  className="font-medium text-[var(--ea-primary)] underline"
                >
                  Цалин бодолт
                </Link>{" "}
                хэсгээс үүсгэнэ
              </>
            )}
          </p>
        </div>
      )}
      {isPending && <span className="sr-only">Ачаалж байна…</span>}
    </section>
  );
}
