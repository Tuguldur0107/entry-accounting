// Цалингийн нэхэмжлэхийн тогтмолууд — ЭНГИЙН модуль ("use server" БИШ:
// server action файл нь зөвхөн async функц export хийж чаддаг тул объект
// тогтмолыг эндээс авна; client component ч эндээс шууд импортолно).

/** Цалин олголтын хуваарь — сарын гарт олгох дүнг хоёр төлбөр болгоно. */
export type SalaryBillKind = "advance" | "final";

export const SALARY_BILL_LABEL: Record<SalaryBillKind, string> = {
  advance: "Урьдчилгаа цалин",
  final: "Сүүл цалин",
};

/** Нэхэмжлэх сард нэг л удаа үүснэ (idempotency — АР/АП-ийн externalRef). */
export const salaryBillRefOf = (
  kind: SalaryBillKind,
  periodMonth: string
): string => `payroll-${kind}:${periodMonth}`;

/** АР/АП баримтын төлөвийн монгол шошго — цалингийн дэлгэцүүдэд нийтлэг. */
export const SALARY_BILL_STATUS_LABEL: Record<string, string> = {
  draft: "ноорог",
  posted: "батлагдсан",
  partially_paid: "хэсэгчлэн төлсөн",
  paid: "төлөгдсөн",
  reversed: "буцаагдсан",
};
