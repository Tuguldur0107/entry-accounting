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
import type {
  CellValueChangedEvent,
  ColDef,
  ColGroupDef,
  ICellRendererParams,
} from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
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
  SALARY_BILL_LABEL_GENITIVE,
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
          baseEarnings: sum.baseEarnings + line.baseEarnings,
          vacationPay: sum.vacationPay + line.vacationPay,
          overtimePay: sum.overtimePay + line.overtimePay,
          sickBenefit: sum.sickBenefit + line.sickBenefit,
          otherAdditions: sum.otherAdditions + line.otherAdditions,
          otherDeductions: sum.otherDeductions + line.otherDeductions,
          employeeSi: sum.employeeSi + line.employeeSi,
          employerSi: sum.employerSi + line.employerSi,
          pit: sum.pit + line.pit,
          netSalary: sum.netSalary + line.netSalary,
          advanceHours: sum.advanceHours + line.advanceHours,
          advanceAmount: sum.advanceAmount + line.advanceAmount,
          finalNet: sum.finalNet + line.finalNet,
          overtimeHours: sum.overtimeHours + line.overtimeHours,
          restDayHours: sum.restDayHours + line.restDayHours,
          holidayHours: sum.holidayHours + line.holidayHours,
          nightHours: sum.nightHours + line.nightHours,
          vacationDays: sum.vacationDays + line.vacationDays,
          sickDays: sum.sickDays + line.sickDays,
        }),
        {
          earnings: 0,
          baseEarnings: 0,
          vacationPay: 0,
          overtimePay: 0,
          sickBenefit: 0,
          otherAdditions: 0,
          otherDeductions: 0,
          employeeSi: 0,
          employerSi: 0,
          pit: 0,
          netSalary: 0,
          advanceHours: 0,
          advanceAmount: 0,
          finalNet: 0,
          overtimeHours: 0,
          restDayHours: 0,
          holidayHours: 0,
          nightHours: 0,
          vacationDays: 0,
          sickDays: 0,
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
        workedHours: 0,
        hourlyRate: 0,
        // Нийлбэр мөрд «гар» тэмдэг утгагүй — дүнгүүд нь олон мөрийн нийлбэр.
        vacationPayManual: false,
        overtimePayManual: false,
        sickBenefitManual: false,
        averageMonthlyEarnings: 0,
        averageMonthsUsed: 0,
        sickBenefitPercent: null,
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
          toast.info(
            `${SALARY_BILL_LABEL_GENITIVE[kind]} нэхэмжлэх аль хэдийн үүссэн`
          );
        } else {
          toast.success(
            `${SALARY_BILL_LABEL_GENITIVE[kind]} НООРОГ нэхэмжлэх үүслээ (${result.documentNo}) — Өглөг хэсгээс батална уу`
          );
        }
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  // Засварласан НЭГ талбарыг л server рүү явуулна: олговрын дүнг (ээлжийн
  // амралт / илүү цаг / ХЧТА) явуулах нь тэр мөрд «гар» тэмдэг АСААДАГ тул
  // бүх утгыг сохроор давтвал хэрэглэгч хөндөөгүй дүн гараар түгжигдэнэ.
  const EDITABLE_FIELDS = [
    "otherDeductions",
    "advanceHours",
    "standardHours",
    "workedHours",
    "otherAdditions",
    "overtimeHours",
    "restDayHours",
    "holidayHours",
    "nightHours",
    "vacationDays",
    "sickDays",
    "vacationPay",
    "overtimePay",
    "sickBenefit",
  ] as const;

  type EditableField = (typeof EDITABLE_FIELDS)[number];

  async function handleCellValueChanged(
    event: CellValueChangedEvent<PayrollLineView>
  ) {
    const field = event.colDef.field as EditableField | undefined;
    if (!field || !EDITABLE_FIELDS.includes(field)) return;
    if (!event.data || event.node.rowPinned) return;
    if (event.newValue === event.oldValue) return;
    try {
      const edited = {
        [field]: Number(event.newValue ?? 0),
      } as Partial<Record<EditableField, number>>;
      await updatePayrollLine({
        lineId: event.data.id,
        otherDeductions: event.data.otherDeductions,
        ...edited,
      });
      router.refresh();
    } catch (error) {
      // Алдаа гарвал нүдийг хуучин утга руу нь буцаана.
      event.node.setDataValue(field, event.oldValue);
      toast.error(errorMessage(error));
    }
  }

  /** «Гар» тэмдгийг арилгаж мөрийн олговруудыг дахин АВТОМАТ болгоно. */
  function restoreAuto(line: PayrollLineView) {
    startTransition(async () => {
      try {
        await updatePayrollLine({
          lineId: line.id,
          otherDeductions: line.otherDeductions,
          clearVacationPayManual: true,
          clearOvertimePayManual: true,
          clearSickBenefitManual: true,
        });
        toast.success("Олговрууд дахин автомат бодогдлоо");
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  const columns = useMemo<(ColDef<PayrollLineView> | ColGroupDef<PayrollLineView>)[]>(() => {
    const editable = (params: { node: { rowPinned?: string | null } }) =>
      !locked && !params.node.rowPinned;

    // Гараар дарж бичсэн дүнг ИЛ тэмдэглэнэ — дахин бодолт үүнийг хөндөхгүй.
    const manualRules = (
      flag: "vacationPayManual" | "overtimePayManual" | "sickBenefitManual"
    ) => ({
      "text-[var(--ea-warning-fg)]": (params: { data?: PayrollLineView; node: { rowPinned?: string | null } }) =>
        !params.node.rowPinned && !!params.data?.[flag],
      "font-semibold": (params: { data?: PayrollLineView; node: { rowPinned?: string | null } }) =>
        !params.node.rowPinned && !!params.data?.[flag],
    });

    const manualTooltip = (
      flag: "vacationPayManual" | "overtimePayManual" | "sickBenefitManual",
      auto: string
    ) => (params: { data?: PayrollLineView }) =>
      params.data?.[flag]
        ? "Гараар засварласан — дахин бодолт энэ дүнг хөндөхгүй. «Авто» товчоор буцаана."
        : auto;

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

    // СҮҮЛ ЦАЛИН — тооцооллын дараалал зүүнээс баруун тийш:
    //   цаг → үндсэн олголт → нэмэгдлүүд (ЦАГ/ХОНОГ-оос АВТОМАТ бодогдоно,
    //   дүнг гараар дарж бичиж болно) → нийт олголт → НДШ, ХАОАТ
    //   → ХЧТА тэтгэмж (татваргүй) → БУСАД СУУТГАЛ (татварын ДАРАА)
    //   → гарт олгох → урьдчилгаа хасагдаж сүүл цалин
    return [
      ...identity,
      col<PayrollLineView>({
        eaType: "number-hours",
        headerName: "Ажиллавал зохих цаг",
        field: "standardHours",
        width: 175,
        editable,
      }),
      col<PayrollLineView>({
        eaType: "number-hours",
        headerName: "Ажилласан цаг",
        field: "workedHours",
        width: 145,
        editable,
      }),
      col<PayrollLineView>({
        eaType: "readonly-money",
        headerName: "Үндсэн олголт",
        field: "baseEarnings",
        width: 145,
      }),
      {
        headerName: "Илүү цаг ба шөнийн ажил",
        marryChildren: true,
        children: [
          col<PayrollLineView>({
            eaType: "number-hours",
            headerName: "Илүү цаг",
            field: "overtimeHours",
            width: 110,
            editable,
            headerTooltip: "ХЗ 103 — 1.5×",
            columnGroupShow: "open",
          }),
          col<PayrollLineView>({
            eaType: "number-hours",
            headerName: "Амралтын өдөр",
            field: "restDayHours",
            width: 140,
            editable,
            headerTooltip: "ХЗ 107 — 1.5×",
            columnGroupShow: "open",
          }),
          col<PayrollLineView>({
            eaType: "number-hours",
            headerName: "Баярын өдөр",
            field: "holidayHours",
            width: 130,
            editable,
            headerTooltip: "ХЗ 108 — 2.0×",
            columnGroupShow: "open",
          }),
          col<PayrollLineView>({
            eaType: "number-hours",
            headerName: "Шөнийн цаг",
            field: "nightHours",
            width: 125,
            editable,
            headerTooltip: "ХЗ 106 — цагийн хөлсний +20% нэмэгдэл",
            columnGroupShow: "open",
          }),
          col<PayrollLineView>({
            eaType: "number-money",
            headerName: "Нэмэгдэл",
            field: "overtimePay",
            width: 140,
            editable,
            cellClassRules: manualRules("overtimePayManual"),
            tooltipValueGetter: manualTooltip(
              "overtimePayManual",
              "Цагаас автоматаар бодогдсон — дүнг гараар дарж бичиж болно."
            ),
          }),
        ],
      },
      {
        headerName: "Ээлжийн амралт",
        marryChildren: true,
        children: [
          col<PayrollLineView>({
            eaType: "number-hours",
            headerName: "Хоног",
            field: "vacationDays",
            width: 100,
            editable,
            columnGroupShow: "open",
            headerTooltip: "ХЗ 109 — өдрийн дундаж хөлс × хоног",
          }),
          col<PayrollLineView>({
            eaType: "number-money",
            headerName: "Олговор",
            field: "vacationPay",
            width: 145,
            editable,
            cellClassRules: manualRules("vacationPayManual"),
            tooltipValueGetter: manualTooltip(
              "vacationPayManual",
              "Дундаж цалингаас автоматаар бодогдсон — дүнг гараар дарж бичиж болно."
            ),
          }),
        ],
      },
      col<PayrollLineView>({
        eaType: "number-money",
        headerName: "Бусад нэмэгдэл",
        field: "otherAdditions",
        width: 150,
        editable,
      }),
      col<PayrollLineView>({
        eaType: "readonly-money",
        headerName: "Нийт олголт",
        field: "earnings",
        width: 145,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
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
      // ХЧТА тэтгэмж нь НДШ, ХАОАТ-ын сууринд ОРОХГҮЙ (ХАОАТ хууль 24) —
      // тиймээс татварын багануудын БАРУУН талд, гарт олгоход НЭМЭГДЭНЭ.
      {
        headerName: "ХЧТА тэтгэмж",
        marryChildren: true,
        children: [
          col<PayrollLineView>({
            eaType: "number-hours",
            headerName: "Хоног",
            field: "sickDays",
            width: 100,
            editable,
            columnGroupShow: "open",
            headerTooltip:
              "Хөдөлмөрийн чадвар түр алдалт — өдрийн дундаж × хоног × тэтгэмжийн хувь (ажилтны картад)",
          }),
          col<PayrollLineView>({
            eaType: "number-money",
            headerName: "Тэтгэмж",
            field: "sickBenefit",
            width: 140,
            editable,
            cellClassRules: manualRules("sickBenefitManual"),
            tooltipValueGetter: (params) =>
              params.data?.sickBenefitManual
                ? "Гараар засварласан — дахин бодолт энэ дүнг хөндөхгүй. «Авто» товчоор буцаана."
                : params.data && params.data.sickDays > 0 && params.data.sickBenefitPercent === null
                  ? "Ажилтны ХЧТА-ийн хувь тохируулаагүй тул автоматаар бодогдоогүй — Ажилтнууд хэсэгт хувийг оруулах эсвэл дүнг гараар бичнэ."
                  : "Тэтгэмжийн хувиар автоматаар бодогдсон — дүнг гараар дарж бичиж болно.",
          }),
        ],
      },
      // Бусад суутгал нь татварын сууринд ОРОХГҮЙ — НДШ, ХАОАТ бодогдсоны
      // ДАРАА гарт олгохоос хасагдана, тиймээс багана нь тэдний БАРУУН талд.
      col<PayrollLineView>({
        eaType: "number-money",
        headerName: "Бусад суутгал",
        field: "otherDeductions",
        width: 140,
        editable,
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
      {
        headerName: "",
        colId: "restoreAuto",
        width: 56,
        sortable: false,
        filter: false,
        resizable: false,
        cellRenderer: (params: ICellRendererParams<PayrollLineView>) => {
          const row = params.data;
          if (!row || params.node.rowPinned) return null;
          const manual =
            row.vacationPayManual || row.overtimePayManual || row.sickBenefitManual;
          if (!manual) return null;
          return (
            <IconAction
              name="reset"
              size="xs"
              label="Дахин автомат бодуулах"
              tooltip="Гараар засварласан олговруудыг дахин автомат бодуулна"
              disabled={locked || isPending}
              onClick={() => restoreAuto(row)}
            />
          );
        },
      },
    ];
    // restoreAuto/isPending нь товчны идэвхийг л тодорхойлно — багана дахин
    // үүсгэх шаардлагагүй тул хамаарлыг зориудаар нарийсгав.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, tab, isPending]);

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
          <p className="mt-0.5 text-xs text-[var(--ea-text-4)]">
            Нэмэгдлийн коэффициент: илүү цаг{" "}
            <span className="font-mono">×{settings.coefficients.overtime}</span>{" "}
            · амралтын өдөр{" "}
            <span className="font-mono">×{settings.coefficients.restDay}</span>{" "}
            · баярын өдөр{" "}
            <span className="font-mono">×{settings.coefficients.holiday}</span>{" "}
            · шөнө{" "}
            <span className="font-mono">
              +{Math.round(settings.coefficients.nightBonus * 100)}%
            </span>{" "}
            · дундаж цалин{" "}
            <span className="font-mono">
              {settings.averageEarningsMonths}
            </span>{" "}
            сараар, сарын ажлын өдөр{" "}
            <span className="font-mono">{settings.monthlyWorkDays}</span>
          </p>
        </div>
        {/* Үйлдлийн товчнууд НЭГ газар: бодолт → өглөг → GL журнал гэсэн
            урсгалын дарааллаар (өмнө нь хуудсын гурван өөр хэсэгт тарсан
            байв). Аль хэдийн үүссэн бол товч алга болж, доор нь статус
            линкээр харагдана. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={calculate} disabled={isPending || locked}>
            <Icon name="costing" size="sm" />
            Бодолт хийх
          </Button>

          {lines.length > 0 && !bills[tab] && (
            <>
              {tab === "advance" && (
                <label className="flex items-center gap-1.5 text-xs text-[var(--ea-text-2)]">
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => createBill(tab)}
                disabled={isPending}
              >
                <Icon name="document" size="sm" />
                {SALARY_BILL_LABEL_GENITIVE[tab]} өглөг үүсгэх
              </Button>
            </>
          )}

          {lines.length > 0 && !voucher && (
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
            : "Нэмэгдэл бүр ЦАГ/ХОНОГ-оос АВТОМАТ бодогдоно (илүү цаг 1.5×, амралтын өдөр 1.5×, баярын өдөр 2.0×, шөнө +20%; ээлжийн амралт ба ХЧТА нь өмнөх 12 сарын дундаж цалингаас). Дүнг гараар дарж бичвэл шар өнгөөр тэмдэглэгдэж дахин бодолт түүнийг ХӨНДӨХГҮЙ — ⟲ товчоор автомат руу нь буцаана. НДШ, ХАОАТ нь нийт олголт дээр бодогдоно; ХЧТА тэтгэмж татваргүй, бусад суутгал нь ТАТВАРЫН ДАРАА хасагдана. Эцэст нь урьдчилгаа хасагдаж сүүл цалин гарна."}
        </p>
      )}

      {lines.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs">
          {bills[tab] && (
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

          {voucher && (
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
          )}
        </div>
      )}
    </section>
  );
}
