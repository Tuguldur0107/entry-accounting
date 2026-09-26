// Цалингийн хуудсыг ажилтанд И-МЭЙЛЭЭР илгээх — ЦЭВЭР дүрэм (DB-гүй, тесттэй).
//
// Шийдвэр (product owner 2026-09-26):
//   • хуудас PDF ХАВСРАЛТААР; мэйлийн гарчиг, биед ДҮН БИЧИХГҮЙ (§9d)
//   • зөвхөн тухайн сарын цалингийн GL журнал БАТЛАГДСАНЫ дараа
//   • эрх `payroll:post`; илгээлт бүр (дахин илгээлт ч) аудитад

/** Аудитын мөрийн entityType / action — сүүлд илгээсэн огноог эндээс уншина. */
export const PAYSLIP_EMAIL_AUDIT_ENTITY = "payslip";
export const PAYSLIP_EMAIL_AUDIT_ACTION = "email";

/** Resend-ийн хурдны хязгаар (2 хүсэлт/сек) — дараалсан илгээлтийн завсар. */
export const PAYSLIP_EMAIL_SPACING_MS = 600;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string | null | undefined): boolean {
  return !!value && EMAIL_RE.test(value.trim());
}

/** Аудитын entityId: `<YYYY-MM>:<employeeId>` — сараар prefix-ээр хайна. */
export function payslipAuditEntityId(periodMonth: string, employeeId: string) {
  return `${periodMonth}:${employeeId}`;
}

export function employeeIdOfAuditEntity(
  periodMonth: string,
  entityId: string
): string | null {
  const prefix = `${periodMonth}:`;
  return entityId.startsWith(prefix) ? entityId.slice(prefix.length) || null : null;
}

/**
 * Илгээхийг хориглох шалтгаан — null бол илгээж болно. Хуудас нь GL-тэй
 * ТААРСАН албан баримт байх ёстой тул батлагдаагүй бодолтоос илгээхгүй.
 */
export function payslipEmailBlocker(
  voucher: { status: string; documentNo: string | null } | null
): string | null {
  if (!voucher)
    return "Энэ сарын цалингийн GL журнал үүсээгүй — журнал үүсгэж батласны дараа илгээнэ";
  if (voucher.status === "draft")
    return `Цалингийн журнал${voucher.documentNo ? ` ${voucher.documentNo}` : ""} ноорог байна — батласны дараа илгээнэ`;
  if (voucher.status !== "posted")
    return "Цалингийн журнал буцаагдсан — дахин бодож, журналаа батласны дараа илгээнэ";
  return null;
}

export type PayslipRecipient = {
  employeeId: string;
  employeeName: string;
  email: string;
};

export type PayslipSkip = {
  employeeId: string;
  employeeName: string;
  reason: string;
};

/**
 * Хэнд илгээх вэ. `only` өгвөл зөвхөн тэдгээр ажилтан (хуудасгүй нь
 * алгасагдсан гэж ИЛ буцна — чимээгүй орхихгүй).
 */
export function planPayslipRecipients(input: {
  payslips: { employeeId: string; employeeName: string }[];
  emails: Record<string, string | null | undefined>;
  only?: string[];
}): { send: PayslipRecipient[]; skipped: PayslipSkip[] } {
  const send: PayslipRecipient[] = [];
  const skipped: PayslipSkip[] = [];
  const wanted = input.only ? new Set(input.only) : null;

  for (const slip of input.payslips) {
    if (wanted && !wanted.has(slip.employeeId)) continue;
    wanted?.delete(slip.employeeId);
    const email = input.emails[slip.employeeId]?.trim() ?? "";
    if (!email) {
      skipped.push({ ...pick(slip), reason: "И-мэйл хаяг бүртгэгдээгүй" });
      continue;
    }
    if (!isValidEmail(email)) {
      skipped.push({ ...pick(slip), reason: `И-мэйл хаяг буруу: ${email}` });
      continue;
    }
    send.push({ ...pick(slip), email });
  }
  for (const employeeId of wanted ?? [])
    skipped.push({
      employeeId,
      employeeName: "—",
      reason: "Энэ сарын цалингийн хуудас байхгүй",
    });
  return { send, skipped };
}

function pick(slip: { employeeId: string; employeeName: string }) {
  return { employeeId: slip.employeeId, employeeName: slip.employeeName };
}

/** 2026-09 → «2026 оны 9-р сар» (гарчиг, биед). */
function periodText(periodMonth: string) {
  const [year, month] = periodMonth.split("-");
  return `${year} оны ${Number(month)}-р сар`;
}

/** Хавсралтын нэр — ASCII (зарим мэйл клиент кирилл файлын нэрийг эвддэг). */
export function payslipFileName(periodMonth: string) {
  return `payslip-${periodMonth}.pdf`;
}

/**
 * Resend-ийн payload. Гарчиг, биед ДҮН БАЙХГҮЙ — цалин нь хувийн мэдээлэл,
 * мэйлийн урьдчилан харах / мэдэгдлийн баннерт харагдах ёсгүй; дүн зөвхөн
 * PDF хавсралтад.
 */
export function buildPayslipEmailPayload(args: {
  companyName: string;
  periodMonth: string;
  employeeName: string;
  to: string;
  from: string;
  replyTo?: string;
  pdf: Buffer;
}) {
  const period = periodText(args.periodMonth);
  return {
    from: args.from,
    to: args.to,
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    subject: `Цалингийн хуудас — ${period} — ${args.companyName}`,
    text: [
      `Сайн байна уу, ${args.employeeName},`,
      ``,
      `${args.companyName}-ийн ${period}-ын таны цалингийн хуудсыг PDF хэлбэрээр хавсаргав.`,
      `Асуух зүйл байвал энэ мэйлд хариу бичнэ үү.`,
      ``,
      `Энэ мэйл зөвхөн танд зориулагдсан — бусдад дамжуулахгүй байхыг хүсье.`,
    ].join("\n"),
    attachments: [
      {
        filename: payslipFileName(args.periodMonth),
        content: args.pdf.toString("base64"),
      },
    ],
  };
}
