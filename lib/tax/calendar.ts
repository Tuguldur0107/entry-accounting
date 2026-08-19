// Монголын татварын хуанли — ЦЭВЭР логик (тесттэй). Хуваарь (CLAUDE.md §4):
//   НӨАТ  — тайлант сарын дараа сарын 10
//   НДШ   — тайлант сарын дараа сарын 5
//   ХАОАТ — тайлант сарын дараа сарын 10 (цалингийн суутгал)
//   ААНОАТ — улирлын дараа сарын 20
// Өнөөдрөөс хойшхи ХАМГИЙН ОЙРЫН хугацааг тайлант үетэй нь хамт буцаана.

export type TaxDeadlineKey = "vat" | "si" | "pit" | "cit";

export interface TaxDeadline {
  key: TaxDeadlineKey;
  label: string;
  /** Тайлант үе — сарын татварт YYYY-MM, улирлынхад "YYYY QN". */
  period: string;
  /** Тайлагнах/төлөх эцсийн огноо (YYYY-MM-DD). */
  dueDate: string;
  /** Өнөөдрөөс дуусах хугацаа хүртэлх хоног (өнөөдөр дуусвал 0). */
  daysLeft: number;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function addMonths(year: number, month: number, delta: number) {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function daysBetween(from: string, to: string) {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10))
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10))
  );
  return Math.round((b - a) / 86_400_000);
}

/** Сарын татварын дараагийн хугацаа: period сарын ДАРАА сарын {day}. */
function nextMonthlyDeadline(today: string, day: number) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  // Энэ сард болох хугацаа = өмнөх сарын тайлан.
  const thisMonthDue = `${today.slice(0, 7)}-${pad2(day)}`;
  if (today <= thisMonthDue) {
    const period = addMonths(year, month, -1);
    return { period: `${period.year}-${pad2(period.month)}`, dueDate: thisMonthDue };
  }
  // Өнгөрсөн бол дараагийн хугацаа: энэ сарын тайлан, дараа сард.
  const next = addMonths(year, month, 1);
  return {
    period: today.slice(0, 7),
    dueDate: `${next.year}-${pad2(next.month)}-${pad2(day)}`,
  };
}

/** Улирлын ААНОАТ: улирал дууссаны дараа сарын 20. */
function nextQuarterlyDeadline(today: string) {
  const year = Number(today.slice(0, 4));
  // Улирал бүрийн хугацаа: Q1→04-20, Q2→07-20, Q3→10-20, Q4→дараа оны 01-20.
  const candidates = [
    { period: `${year - 1} Q4`, dueDate: `${year}-01-20` },
    { period: `${year} Q1`, dueDate: `${year}-04-20` },
    { period: `${year} Q2`, dueDate: `${year}-07-20` },
    { period: `${year} Q3`, dueDate: `${year}-10-20` },
    { period: `${year} Q4`, dueDate: `${year + 1}-01-20` },
  ];
  return candidates.find((candidate) => today <= candidate.dueDate)!;
}

export function computeTaxDeadlines(today: string): TaxDeadline[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today))
    throw new Error(`Огноо буруу: ${today}`);

  const si = nextMonthlyDeadline(today, 5);
  const vat = nextMonthlyDeadline(today, 10);
  const pit = nextMonthlyDeadline(today, 10);
  const cit = nextQuarterlyDeadline(today);

  const rows: TaxDeadline[] = [
    { key: "si", label: "НДШ", ...si, daysLeft: daysBetween(today, si.dueDate) },
    { key: "vat", label: "НӨАТ", ...vat, daysLeft: daysBetween(today, vat.dueDate) },
    { key: "pit", label: "ХАОАТ", ...pit, daysLeft: daysBetween(today, pit.dueDate) },
    { key: "cit", label: "ААНОАТ", ...cit, daysLeft: daysBetween(today, cit.dueDate) },
  ];
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
