"use client";

// Сарын цалингийн бодолтын дэлгэц (CLAUDE.md §7).
//
// Урсгал: Бодолт хийх → мөрийн олголт/суутгал засах (тооцоолол server талд
// дахин бодогдоно) → GL НООРОГ журнал үүсгэх → нягтланч GL журналаас батална
// (human-in-the-loop §9 — энэ дэлгэц хэзээ ч шууд post хийхгүй).
//
// ХОЁР ТАБ = сарын гарт олгох цалинг ХОЁР удаа олгох хуваарь:
//   Урьдчилгаа — ажилласан цагаар бодогдож СУУТГАЛГҮЙ олгоно
//   Сүүл цалин — бүх нэмэгдэл/суутгал бодогдож, НДШ ба ХАОАТ суутгагдсаны
//                ДАРАА урьдчилгаа хасагдана
// Тэнцэл: урьдчилгаа + сүүл цалин = сарын нийт гарт олгох (нэмэлт олголт
// үүсэхгүй) тул GL-ийн ноорог журнал ӨӨРЧЛӨГДӨХГҮЙ — цалингийн өглөг
// бүтнээрээ кредитлэгдэж, хоёр төлбөр тэр өглөгийг хаана.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PageTabs } from "@/components/ui/tabs";
import {
  calculatePayrollRun,
  createPayrollSalaryBill,
  createPayrollVoucher,
  updatePayrollLine,
  type PayrollLineView,
  type PayrollRunView as PayrollRunData,
} from "@/lib/actions/payroll";
import {
  SALARY_BILL_LABEL,
  SALARY_BILL_STATUS_LABEL as BILL_STATUS_LABEL,
  type SalaryBillKind,
} from "@/lib/payroll/bills";
import { col } from "@/lib/grid/columnTypes";
import { fmtMnt } from "@/lib/grid/formatters";
import { fmtPeriodCode } from "@/lib/periods/period";

interface Props {
  data: PayrollRunData;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Алдаа гарлаа";
}

type PayrollTab = "advance" | "final";

const TABS = [
  { value: "advance", label: "Урьдчилгаа цалин" },
  { value: "final", label: "Сүүл цалин" },
] as const satisfies readonly { value: PayrollTab; label: string }[];

export function PayrollRunView({ data }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<PayrollTab>("advance");

  const { periodMonth, voucher, lines, settings, activeEmployeeCount, bills } =
    data;
  // Урьдчилгааг сар дундуур олгодог тул огноог хэрэглэгч сонгоно; сүүл цалин
  // нь сарын эцсийн огноогоор бичигдэнэ (server талд default).
  const [advanceDate, setAdvanceDate] = useState(
    data.advanceDate ?? `${periodMonth}-15`
  );
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
          advanceHours: sum.advanceHours + line.advanceHours,
          advanceAmount: sum.advanceAmount + line.advanceAmount,
          finalNet: sum.finalNet + line.finalNet,
        }),
        {
          earnings: 0,
          otherDeductions: 0,
          employeeSi: 0,
          employerSi: 0,
          pit: 0,
          netSalary: 0,
          advanceHours: 0,
          advanceAmount: 0,
          finalNet: 0,
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
        employerSiPercent: 0,
        baseSalary: 0,
        standardHours: 0,
        hourlyRate: 0,
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

  function createBill(kind: SalaryBillKind) {
    startTransition(async () => {
      try {
        const result = await createPayrollSalaryBill(
          periodMonth,
          kind,
          kind === "advance" ? advanceDate : undefined
        );
        if (result.dedup) {
          toast.info(`${SALARY_BILL_LABEL[kind]}ы нэхэмжлэх аль хэдийн үүссэн`);
        } else {
          toast.success(
            `${SALARY_BILL_LABEL[kind]}ы НООРОГ нэхэмжлэх үүслээ (${result.documentNo}) — Өглөг хэсгээс батална уу`
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
    if (
      field !== "earnings" &&
      field !== "otherDeductions" &&
      field !== "advanceHours" &&
      field !== "standardHours"
    )
      return;
    if (!event.data || event.node.rowPinned) return;
    if (event.newValue === event.oldValue) return;
    try {
      await updatePayrollLine({
        lineId: event.data.id,
        earnings: event.data.earnings,
        otherDeductions: event.data.otherDeductions,
        advanceHours: event.data.advanceHours,
        standardHours: event.data.standardHours,
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

    // Хоёр табын НИЙТЛЭГ эхний багануудыг нэг л газар тодорхойлно.
    const identity: ColDef<PayrollLineView>[] = [
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
    ];

    if (tab === "advance")
      return [
        ...identity,
        col<PayrollLineView>({
          eaType: "readonly-money",
          headerName: "Үндсэн цалин",
          field: "baseSalary",
          width: 140,
        }),
        col<PayrollLineView>({
          eaType: "number-hours",
          headerName: "Ажиллавал зохих цаг",
          field: "standardHours",
          width: 175,
          editable,
        }),
        col<PayrollLineView>({
          eaType: "readonly-money",
          headerName: "Цагийн хөлс",
          field: "hourlyRate",
          width: 130,
        }),
        col<PayrollLineView>({
          eaType: "number-hours",
          headerName: "Ажилласан цаг",
          field: "advanceHours",
          width: 140,
          editable,
        }),
        col<PayrollLineView>({
          eaType: "readonly-money",
          headerName: "Урьдчилгаа (гарт олгох)",
          field: "advanceAmount",
          width: 190,
          cellClass: "ag-right-aligned-cell font-mono font-semibold",
        }),
      ];

    return [
      ...identity,
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
      // АО НДШ нь ажилтнаас суутгах НДШ-ийн ЗҮҮН талд — ажил олгогчийн
      // зардал эхэлж, дараа нь ажилтнаас суутгагдах дүнгүүд эгнэнэ.
      col<PayrollLineView>({
        eaType: "readonly-money",
        headerName: "АО НДШ",
        field: "employerSi",
        width: 120,
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
        headerName: "Нийт гарт олгох",
        field: "netSalary",
        width: 150,
      }),
      col<PayrollLineView>({
        eaType: "readonly-money",
        headerName: "Урьдчилгаа",
        field: "advanceAmount",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono text-[var(--ea-text-3)]",
      }),
      col<PayrollLineView>({
        eaType: "readonly-money",
        headerName: "Сүүл цалин",
        field: "finalNet",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
      }),
    ];
  }, [locked, tab]);

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
            )}{" "}
            · Сарын стандарт ажлын цаг{" "}
            <span className="font-mono">{settings.standardMonthlyHours}</span>
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

      {lines.length > 0 && (
        <PageTabs
          tabs={TABS}
          value={tab}
          onChange={setTab}
          ariaLabel="Цалин олголтын хуваарь"
        />
      )}

      {lines.length > 0 && (
        <p className="text-xs text-[var(--ea-text-3)]">
          {tab === "advance"
            ? "«Бодолт хийх» дарахад ажиллавал зохих цаг тохиргооноос бөглөгдөж цагийн хөлс бодогдоно (ажилтан бүрд засаж болно). Ажилласан цагийг оруулахад урьдчилгаа СУУТГАЛГҮЙ бодогдоно — цагийн хөлс = үндсэн цалин / ажиллавал зохих цаг."
            : "Бүх нэмэгдэл, суутгал энд бодогдоно. НДШ, ХАОАТ суутгагдсаны ДАРАА урьдчилгаа хасагдаж сүүл цалин гарна — урьдчилгаа + сүүл цалин = сарын нийт гарт олгох."}
        </p>
      )}

      {lines.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs">
          {tab === "advance" && !bills.advance && (
            <label className="flex items-center gap-1.5 text-[var(--ea-text-2)]">
              Олгох огноо
              <input
                type="date"
                value={advanceDate}
                min={`${periodMonth}-01`}
                onChange={(event) => setAdvanceDate(event.target.value)}
                className="h-7 rounded border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 font-mono text-xs text-[var(--ea-text-1)]"
              />
            </label>
          )}

          {bills[tab] ? (
            <span className="text-[var(--ea-text-3)]">
              Өглөгийн нэхэмжлэх{" "}
              <Link
                href="/payables/documents"
                className="font-medium text-[var(--ea-primary)] underline"
              >
                {bills[tab]!.documentNo}
              </Link>{" "}
              · {BILL_STATUS_LABEL[bills[tab]!.status] ?? bills[tab]!.status} ·{" "}
              <span className="font-mono">{fmtMnt(bills[tab]!.totalAmount)}</span>
              {bills[tab]!.paidAmount > 0 && (
                <>
                  {" "}
                  · төлсөн{" "}
                  <span className="font-mono">
                    {fmtMnt(bills[tab]!.paidAmount)}
                  </span>
                </>
              )}
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => createBill(tab)}
              disabled={isPending}
            >
              <Icon name="document" size="sm" />
              {SALARY_BILL_LABEL[tab]}ы өглөг үүсгэх
            </Button>
          )}

          <span className="ml-auto text-[var(--ea-text-4)]">
            {tab === "advance"
              ? "Ажилтанд өгөх өглөг АР/АП модульд үүснэ — кассаас тэр өглөгийг хаана."
              : "Нэхэмжлэх нь Dr Цалингийн өглөг / Cr Ажилтны өглөг — зардал §7-ийн журналд нэг л удаа бичигдэнэ."}
          </span>
        </div>
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
            {lines.length} ажилтан · Нийт гарт олгох{" "}
            <span className="font-mono font-medium text-[var(--ea-text-1)]">
              {fmtMnt(totals.netSalary)}
            </span>{" "}
            = урьдчилгаа{" "}
            <span className="font-mono font-medium text-[var(--ea-text-1)]">
              {fmtMnt(totals.advanceAmount)}
            </span>{" "}
            + сүүл цалин{" "}
            <span className="font-mono font-medium text-[var(--ea-text-1)]">
              {fmtMnt(totals.finalNet)}
            </span>
            {tab === "final" && (
              <>
                {" "}
                · Нийт олголт{" "}
                <span className="font-mono font-medium text-[var(--ea-text-1)]">
                  {fmtMnt(totals.earnings)}
                </span>{" "}
                · АО НДШ{" "}
                <span className="font-mono font-medium text-[var(--ea-text-1)]">
                  {fmtMnt(totals.employerSi)}
                </span>
              </>
            )}
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
