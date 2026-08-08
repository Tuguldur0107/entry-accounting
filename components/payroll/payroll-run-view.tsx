"use client";

// Сарын цалингийн бодолтын дэлгэц (CLAUDE.md §7).
//
// Урсгал: Бодолт хийх → мөрийн олголт/суутгал засах (тооцоолол server талд
// дахин бодогдоно) → GL НООРОГ журнал үүсгэх → нягтланч GL журналаас батална
// (human-in-the-loop §9 — энэ дэлгэц хэзээ ч шууд post хийхгүй).

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  calculatePayrollRun,
  createPayrollVoucher,
  updatePayrollLine,
  type PayrollLineView,
  type PayrollRunView as PayrollRunData,
} from "@/lib/actions/payroll";
import { col } from "@/lib/grid/columnTypes";
import { fmtMnt } from "@/lib/grid/formatters";
import { fmtPeriodCode } from "@/lib/periods/period";

interface Props {
  data: PayrollRunData;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Алдаа гарлаа";
}

export function PayrollRunView({ data }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const { periodMonth, voucher, lines, settings, activeEmployeeCount } = data;
  // GL журнал үүссэн run — мөр засварлах/дахин бодохыг server мөн хориглодог.
  const locked = voucher !== null;

  const totals = useMemo(
    () =>
      lines.reduce(
        (sum, line) => ({
          earnings: sum.earnings + line.earnings,
          otherDeductions: sum.otherDeductions + line.otherDeductions,
          employeeSi: sum.employeeSi + line.employeeSi,
          employerSi: sum.employerSi + line.employerSi,
          pit: sum.pit + line.pit,
          netSalary: sum.netSalary + line.netSalary,
        }),
        {
          earnings: 0,
          otherDeductions: 0,
          employeeSi: 0,
          employerSi: 0,
          pit: 0,
          netSalary: 0,
        }
      ),
    [lines]
  );

  const pinnedBottomRowData = useMemo(
    () => [
      {
        id: "__totals__",
        employeeId: "",
        employeeName: "Нийт",
        position: "",
        accidentRatePercent: 0,
        ...totals,
      } satisfies PayrollLineView,
    ],
    [totals]
  );

  function calculate() {
    startTransition(async () => {
      try {
        await calculatePayrollRun(periodMonth);
        toast.success(`${fmtPeriodCode(periodMonth)} сарын бодолт хийгдлээ`);
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  function createVoucher() {
    startTransition(async () => {
      try {
        const result = await createPayrollVoucher(periodMonth);
        if (result.dedup) {
          toast.info("Цалингийн журнал аль хэдийн үүссэн байна");
        } else {
          toast.success(
            "Цалингийн НООРОГ журнал үүслээ — GL журналаас шалгаад батална уу"
          );
        }
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  async function handleCellValueChanged(
    event: CellValueChangedEvent<PayrollLineView>
  ) {
    const field = event.colDef.field;
    if (field !== "earnings" && field !== "otherDeductions") return;
    if (!event.data || event.node.rowPinned) return;
    if (event.newValue === event.oldValue) return;
    try {
      await updatePayrollLine({
        lineId: event.data.id,
        earnings: event.data.earnings,
        otherDeductions: event.data.otherDeductions,
      });
      router.refresh();
    } catch (error) {
      // Алдаа гарвал нүдийг хуучин утга руу нь буцаана.
      event.node.setDataValue(field, event.oldValue);
      toast.error(errorMessage(error));
    }
  }

  const columns = useMemo<ColDef<PayrollLineView>[]>(() => {
    const editable = (params: { node: { rowPinned?: string | null } }) =>
      !locked && !params.node.rowPinned;
    return [
      col<PayrollLineView>({
        eaType: "readonly-text",
        headerName: "Ажилтан",
        field: "employeeName",
        minWidth: 160,
        flex: 1,
        cellClassRules: {
          "font-semibold": (params) => !!params.node.rowPinned,
        },
      }),
      col<PayrollLineView>({
        eaType: "readonly-text",
        headerName: "Албан тушаал",
        field: "position",
        width: 130,
        cellClass: "text-xs text-[var(--ea-text-3)]",
      }),
      col<PayrollLineView>({
        eaType: "number-money",
        headerName: "Нийт олголт",
        field: "earnings",
        width: 140,
        editable,
      }),
      col<PayrollLineView>({
        eaType: "number-money",
        headerName: "Бусад суутгал",
        field: "otherDeductions",
        width: 130,
        editable,
      }),
      col<PayrollLineView>({
        eaType: "readonly-money",
        headerName: "НДШ (ажилтан)",
        field: "employeeSi",
        width: 130,
      }),
      col<PayrollLineView>({
        eaType: "readonly-money",
        headerName: "ХАОАТ",
        field: "pit",
        width: 120,
      }),
      col<PayrollLineView>({
        eaType: "readonly-money",
        headerName: "Гарт олгох",
        field: "netSalary",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
      }),
      col<PayrollLineView>({
        eaType: "readonly-money",
        headerName: "АО НДШ",
        field: "employerSi",
        width: 120,
      }),
    ];
  }, [locked]);

  const siCap = settings.minimumWage * settings.siCapMultiplier;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Цалингийн бодолт — {fmtPeriodCode(periodMonth)}
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Доод цалин{" "}
            <span className="font-mono">{fmtMnt(settings.minimumWage)}</span> ·
            НДШ дээд суурь{" "}
            <span className="font-mono">{fmtMnt(siCap)}</span> (доод цалин ×{" "}
            {settings.siCapMultiplier})
            {settings.monthlyTaxFree > 0 && (
              <>
                {" "}
                · Татваргүй босго{" "}
                <span className="font-mono">
                  {fmtMnt(settings.monthlyTaxFree)}
                </span>
              </>
            )}
          </p>
        </div>
        <Button size="sm" onClick={calculate} disabled={isPending || locked}>
          <Icon name="costing" size="sm" />
          Бодолт хийх
        </Button>
      </div>

      {locked && (
        <p className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs text-[var(--ea-text-3)]">
          GL журнал үүссэн тул бодолт болон мөрийн засвар түгжигдсэн — дахин
          бодохын тулд эхлээд журналыг устгана.
        </p>
      )}

      {lines.length === 0 ? (
        <div className="flex min-h-56 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          <p>Бодолт хийгдээгүй байна — «Бодолт хийх» товчоор эхэлнэ.</p>
          {activeEmployeeCount === 0 && (
            <p className="rounded-md border border-[var(--ea-warning)]/40 bg-[var(--ea-warning)]/8 px-3 py-2 text-xs text-[var(--ea-text-1)]">
              Идэвхтэй ажилтан бүртгэгдээгүй байна —{" "}
              <Link
                href="/payroll/employees"
                className="font-medium text-[var(--ea-primary)] underline"
              >
                Ажилтнууд
              </Link>{" "}
              хэсэгт эхлээд бүртгэнэ үү.
            </p>
          )}
        </div>
      ) : (
        <DataGridDynamic<PayrollLineView>
          rowData={lines}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          pinnedBottomRowData={pinnedBottomRowData}
          onCellValueChanged={handleCellValueChanged}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        />
      )}

      {lines.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--ea-text-3)]">
            {lines.length} ажилтан · Нийт олголт{" "}
            <span className="font-mono font-medium text-[var(--ea-text-1)]">
              {fmtMnt(totals.earnings)}
            </span>{" "}
            · Гарт олгох{" "}
            <span className="font-mono font-medium text-[var(--ea-text-1)]">
              {fmtMnt(totals.netSalary)}
            </span>{" "}
            · АО НДШ{" "}
            <span className="font-mono font-medium text-[var(--ea-text-1)]">
              {fmtMnt(totals.employerSi)}
            </span>
          </p>

          {voucher ? (
            <p className="text-xs text-[var(--ea-text-3)]">
              GL журнал:{" "}
              <span className="font-medium text-[var(--ea-text-1)]">
                {voucher.status === "draft"
                  ? "ноорог"
                  : voucher.status === "posted"
                    ? "батлагдсан"
                    : voucher.status === "reversed"
                      ? "буцаагдсан"
                      : voucher.status}
              </span>{" "}
              —{" "}
              <Link
                href="/gl/journal"
                className="font-medium text-[var(--ea-primary)] underline"
              >
                GL журналын жагсаалтаас харна уу
              </Link>
            </p>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={createVoucher}
              disabled={isPending}
            >
              <Icon name="journal" size="sm" />
              GL ноорог журнал үүсгэх
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
