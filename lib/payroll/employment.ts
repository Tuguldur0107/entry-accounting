// Сарын дотор ажилд орсон / гарсан ажилтны цалингийн хувь — ЦЭВЭР
// (tests/payroll-employment.test.ts). SIM2-019 / SIM2-020.
//
// Суурь нь АЖЛЫН ӨДӨР (Да–Ба): 2025-08-18-нд орсон → 10/21, 2025-09-15-нд
// гарсан → 11/22 (гарсан өдөр ажилласанд тооцогдоно). Бүх нийтийн амралтын
// өдрийг ТООЦОХГҮЙ (кодод хуанли зохиохгүй) — шаардлагатай бол хэрэглэгч
// ажилласан цагийг гараар засна; засвар дахин бодолтод хадгалагдана.

export type EmploymentShare = {
  /** Тухайн сард нэг ч ажлын өдөр ажиллаагүй (ороогүй / аль хэдийн гарсан). */
  employed: boolean;
  /** Сарын дундаас орсон эсвэл гарсан. */
  partial: boolean;
  workedDays: number;
  totalDays: number;
  /** workedDays / totalDays (бүтэн сар = 1). */
  fraction: number;
  /** UI/AI-д харуулах тайлбар — бүтэн сард null. */
  note: string | null;
};

function isoDay(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Сарын ажлын өдрүүд (Да–Ба), YYYY-MM-DD. */
export function monthWorkingDays(periodMonth: string): string[] {
  const [year, month] = periodMonth.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: string[] = [];
  for (let day = 1; day <= last; day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(isoDay(year, month, day));
  }
  return days;
}

export function employmentShare(
  periodMonth: string,
  hireDate: string | null | undefined,
  terminationDate: string | null | undefined
): EmploymentShare {
  const days = monthWorkingDays(periodMonth);
  const totalDays = days.length;
  const worked = days.filter(
    (day) => (!hireDate || day >= hireDate) && (!terminationDate || day <= terminationDate)
  ).length;
  const partial = worked > 0 && worked < totalDays;
  const notes: string[] = [];
  if (partial && hireDate && hireDate > days[0]) notes.push(`${hireDate.slice(5)}-нд орсон`);
  if (partial && terminationDate && terminationDate < days[totalDays - 1])
    notes.push(`${terminationDate.slice(5)}-нд гарсан`);
  return {
    employed: worked > 0,
    partial,
    workedDays: worked,
    totalDays,
    fraction: totalDays > 0 ? worked / totalDays : 0,
    note: partial ? `хэсэгчилсэн сар ${worked}/${totalDays} (${notes.join(", ")})` : null,
  };
}

/** Хэсэгчилсэн сарын ажилласан цаг — стандарт цаг × хувь (0.01 цаг). */
export function proratedHours(standardHours: number, share: EmploymentShare): number {
  if (!share.partial) return standardHours;
  return Math.round(standardHours * share.fraction * 100) / 100;
}

/** Гарсан огноо өнгөрсөн (эсвэл өнөөдөр) бол ажилтан идэвхгүй. */
export function isTerminated(terminationDate: string | null | undefined, today: string): boolean {
  return !!terminationDate && terminationDate <= today;
}
