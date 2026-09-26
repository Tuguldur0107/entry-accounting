// Ажилтны ЦАЛИНГИЙН ХУУДАС (payslip) — ЦЭВЭР бүтэц (DB-гүй, тесттэй).
//
// Хуудас нь ажилтанд өгдөг албан ёсны задаргаа тул мөрүүд нь бодолтын
// хадгалагдсан дүнгээс ГАРНА — энд ЮУ Ч ДАХИН БОДОГДОХГҮЙ (илүү цагийн
// задаргаанаас бусад, тэр нь ЗӨВХӨН харуулах зорилготой).
//
// ТЭНЦЭЛ (заавал): Σолголт − Σсуутгал + татваргүй олголт = гарт олгох.
// Зөрүү гарвал ШИДНЭ — буруу хуудсыг ажилтанд өгөхөөс алдаа өгсөн нь дээр.

import {
  computeOvertimePay,
  type OvertimeCoefficients,
} from "./additions";

export interface PayslipAmountLine {
  label: string;
  /** Тайлбар (цаг, хоног, хувь) — дүнгийн ЯАЖ гарсныг харуулна. */
  note?: string;
  amount: number;
}

export interface PayslipSection {
  title: string;
  lines: PayslipAmountLine[];
  total: number;
}

export interface Payslip {
  periodMonth: string;
  employeeId: string;
  employeeName: string;
  registerNo: string;
  position: string;
  department: string;
  /** Олголт — татварын суурьт ОРНО. */
  earnings: PayslipSection;
  /** Суутгал — НДШ, ХАОАТ ба татварын дараах бусад суутгал. */
  deductions: PayslipSection;
  /** Татваргүй олголт (ХЧТА) — дүн 0 бол null. */
  taxFree: PayslipSection | null;
  netSalary: number;
  advanceAmount: number;
  finalNet: number;
  /** Ажил олгогчийн НДШ — МЭДЭЭЛЛИЙН зорилгоор (ажилтнаас суутгагдахгүй). */
  employerSi: number;
  /** Ээлжийн амралт / ХЧТА-ийн суурь дундажийн тайлбар (ил байх ёстой). */
  averageNote: string | null;
}

/** Бодолтын мөрөөс хуудсанд хэрэгтэй талбарууд (PayrollLineView-ийн дэд олонлог). */
export interface PayslipLineInput {
  employeeId: string;
  employeeName: string;
  registerNo: string;
  position: string;
  department: string;
  baseSalary: number;
  standardHours: number;
  workedHours: number;
  baseEarnings: number;
  overtimeHours: number;
  restDayHours: number;
  holidayHours: number;
  nightHours: number;
  overtimePay: number;
  overtimePayManual: boolean;
  vacationDays: number;
  vacationPay: number;
  vacationPayManual: boolean;
  otherAdditions: number;
  earnings: number;
  employeeSi: number;
  pit: number;
  otherDeductions: number;
  sickDays: number;
  sickBenefit: number;
  sickBenefitManual: boolean;
  netSalary: number;
  advanceAmount: number;
  finalNet: number;
  employerSi: number;
  averageMonthlyEarnings: number;
  averageMonthsUsed: number;
}

const r2 = (value: number) => Math.round(value * 100) / 100;

const fmtNumber = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Дүн 0 биш мөрүүдийг л хуудсанд гаргана (хоосон мөр ажилтныг төөрөлдүүлнэ). */
function pushLine(
  lines: PayslipAmountLine[],
  label: string,
  amount: number,
  note?: string
) {
  if (Math.abs(amount) < 0.005) return;
  lines.push({ label, amount: r2(amount), note });
}

export function buildPayslip(input: {
  periodMonth: string;
  line: PayslipLineInput;
  coefficients: OvertimeCoefficients;
  monthlyWorkDays: number;
}): Payslip {
  const { line } = input;
  const earningLines: PayslipAmountLine[] = [];

  pushLine(
    earningLines,
    "Үндсэн цалин",
    line.baseEarnings,
    line.standardHours > 0
      ? `ажилласан ${fmtNumber(line.workedHours)} / ${fmtNumber(line.standardHours)} цаг`
      : undefined
  );

  // Илүү цагийн задаргаа нь ЗӨВХӨН харуулах — нийлбэр нь хадгалагдсан дүн.
  // Гараар дарж бичсэн бол задлахгүй (задаргаа нийлбэртэй таарахгүй болно).
  if (line.overtimePayManual) {
    pushLine(earningLines, "Илүү цаг, шөнийн нэмэгдэл", line.overtimePay, "гараар");
  } else if (Math.abs(line.overtimePay) >= 0.005) {
    const hourlyRate = line.standardHours > 0 ? line.baseSalary / line.standardHours : 0;
    const breakdown = computeOvertimePay({
      hourlyRate,
      hours: {
        overtimeHours: line.overtimeHours,
        restDayHours: line.restDayHours,
        holidayHours: line.holidayHours,
        nightHours: line.nightHours,
      },
      coefficients: input.coefficients,
    });
    pushLine(
      earningLines,
      "Илүү цагийн нэмэгдэл",
      breakdown.overtime,
      `${fmtNumber(line.overtimeHours)} цаг × ${input.coefficients.overtime}`
    );
    pushLine(
      earningLines,
      "Амралтын өдрийн нэмэгдэл",
      breakdown.restDay,
      `${fmtNumber(line.restDayHours)} цаг × ${input.coefficients.restDay}`
    );
    pushLine(
      earningLines,
      "Баярын өдрийн нэмэгдэл",
      breakdown.holiday,
      `${fmtNumber(line.holidayHours)} цаг × ${input.coefficients.holiday}`
    );
    pushLine(
      earningLines,
      "Шөнийн нэмэгдэл",
      breakdown.night,
      `${fmtNumber(line.nightHours)} цаг × ${input.coefficients.nightBonus}`
    );
    // Бөөрөнхийллийн зөрүү гарвал ил мөр болгоно — задаргаа нь хадгалагдсан
    // дүнтэй ҮРГЭЛЖ таарна (нуухгүй).
    const shown = earningLines
      .filter((row) => row.label.includes("нэмэгдэл"))
      .reduce((sum, row) => sum + row.amount, 0);
    pushLine(earningLines, "Нэмэгдлийн бөөрөнхийлөл", line.overtimePay - shown);
  }

  pushLine(
    earningLines,
    "Ээлжийн амралтын олговор",
    line.vacationPay,
    line.vacationPayManual
      ? "гараар"
      : line.vacationDays > 0
        ? `${fmtNumber(line.vacationDays)} хоног`
        : undefined
  );
  pushLine(earningLines, "Бусад нэмэгдэл", line.otherAdditions);

  const earnings: PayslipSection = {
    title: "Олголт",
    lines: earningLines,
    total: r2(line.earnings),
  };

  const deductionLines: PayslipAmountLine[] = [];
  pushLine(deductionLines, "НДШ (ажилтан)", line.employeeSi, "11.5%");
  pushLine(deductionLines, "ХХОАТ", line.pit);
  pushLine(deductionLines, "Бусад суутгал", line.otherDeductions, "татварын дараа");
  const deductions: PayslipSection = {
    title: "Суутгал",
    lines: deductionLines,
    total: r2(line.employeeSi + line.pit + line.otherDeductions),
  };

  const taxFree: PayslipSection | null =
    Math.abs(line.sickBenefit) >= 0.005
      ? {
          title: "Татваргүй олголт",
          lines: [
            {
              label: "ХЧТА тэтгэмж",
              note: line.sickBenefitManual
                ? "гараар"
                : line.sickDays > 0
                  ? `${fmtNumber(line.sickDays)} хоног`
                  : undefined,
              amount: r2(line.sickBenefit),
            },
          ],
          total: r2(line.sickBenefit),
        }
      : null;

  // ТЭНЦЭЛ — хуудас нь бодолттой ҮРГЭЛЖ таарна.
  const computed = earnings.total - deductions.total + (taxFree?.total ?? 0);
  if (Math.abs(computed - r2(line.netSalary)) > 0.01)
    throw new Error(
      `${line.employeeName}: цалингийн хуудас тэнцэхгүй байна (${fmtNumber(computed)} ≠ ${fmtNumber(line.netSalary)})`
    );

  const averageNote =
    line.vacationDays > 0 || line.sickDays > 0
      ? line.averageMonthsUsed > 0
        ? `Дундаж цалин ${fmtNumber(line.averageMonthlyEarnings)}₮ (сүүлийн ${line.averageMonthsUsed} сар) · өдрийн дундаж ${fmtNumber(r2(line.averageMonthlyEarnings / input.monthlyWorkDays))}₮`
        : `Дундаж цалин ${fmtNumber(line.averageMonthlyEarnings)}₮ (түүх байхгүй тул үндсэн цалингаар)`
      : null;

  return {
    periodMonth: input.periodMonth,
    employeeId: line.employeeId,
    employeeName: line.employeeName,
    registerNo: line.registerNo,
    position: line.position,
    department: line.department,
    earnings,
    deductions,
    taxFree,
    netSalary: r2(line.netSalary),
    advanceAmount: r2(line.advanceAmount),
    finalNet: r2(line.finalNet),
    employerSi: r2(line.employerSi),
    averageNote,
  };
}

/** Хуудасны толгойн компанийн мэдээлэл (дэлгэц, PDF хоёуланд). */
export interface PayslipCompany {
  name: string;
  registerNo: string;
  address: string;
  phone: string;
}

/** Ажилтан бүрийн и-мэйлээр хүргэлтийн төлөв. */
export interface PayslipDelivery {
  email: string | null;
  /** Сүүлд илгээсэн (аудитаас) — ISO огноо. */
  lastSentAt: string | null;
}

export interface PayslipReport {
  periodMonth: string;
  company: PayslipCompany;
  payslips: Payslip[];
  /** Мөр нь тэнцээгүй тул алгасагдсан ажилтад (буруу хуудас гаргахгүй). */
  errors: { employeeName: string; message: string }[];
  /** И-мэйлээр илгээх — lib/payroll/payslip-email.ts. */
  email: {
    /** null бол илгээж болно; үгүй бол шалтгаан (журнал батлагдаагүй г.м.). */
    blocker: string | null;
    /** RESEND_API_KEY тохируулсан эсэх. */
    configured: boolean;
    delivery: Record<string, PayslipDelivery>;
  };
}
