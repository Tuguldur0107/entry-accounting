// И-мэйл илгээгчийн ЦЭВЭР логик (тесттэй) — Resend клиентээс хараат бус.
// Илгээгч хаягийн эрэмбэ: tenant тохиргоо → env default → алдаа. Sandbox
// (onboarding@resend.dev) fallback ХОРИОТОЙ — тохируулаагүй бол ил алдаа
// шидэж хэрэглэгчийг тохиргоо руу чиглүүлнэ.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** company_settings-ийн илгээгчийн талбарууд (null = тохируулаагүй). */
export type TenantEmailSettings = {
  invoiceFromEmail: string | null;
  invoiceReplyTo: string | null;
  emailDomainVerified: boolean;
  /** From-ийн display нэр болно (жишээ: "Жишээ ХХК <billing@...>"). */
  companyName?: string | null;
};

/** process.env-ээс уншигдах хэсэг — тестэд plain объект өгнө.
    Index signature нь process.env-ийг шууд өгөх боломж олгоно. */
export type SenderEnv = {
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
  RESEND_REPLY_TO?: string;
  /** Хуучин "Нэр <хаяг>" форматын тохиргоо — байвал хүндэтгэнэ. */
  RESEND_FROM?: string;
  [key: string]: string | undefined;
};

export const SENDER_NOT_CONFIGURED_MSG =
  "Илгээгч и-мэйл хаяг тохируулаагүй байна — Тохиргоо → Компанийн мэдээлэл " +
  "хэсэгт илгээгч хаягаа оруулах эсвэл серверийн RESEND_FROM_EMAIL " +
  "тохиргоог хийнэ үү.";

export const DOMAIN_NOT_VERIFIED_MSG =
  "Илгээгч домэйн баталгаажаагүй байна. resend.com/domains дээр домэйнээ " +
  "verify хийж, Тохиргоо → Компанийн мэдээлэл хэсэгт «Илгээгч домэйн " +
  "баталгаажсан»-ыг идэвхжүүлнэ үү.";

/** Display нэрнээс форматыг эвдэх тэмдэгтүүдийг цэвэрлэнэ. */
function sanitizeDisplayName(name: string) {
  return name.replace(/[<>"\r\n]/g, "").trim();
}

function formatFrom(email: string, name?: string | null) {
  const display = name ? sanitizeDisplayName(name) : "";
  return display ? `${display} <${email}>` : email;
}

/**
 * Нэхэмжлэхийн илгээгч хаягийг тодорхойлно.
 * Эрэмбэ: tenant (verify хийгдсэн үед л) → RESEND_FROM_EMAIL(+NAME) →
 * хуучин RESEND_FROM → алдаа. reply-to: tenant → RESEND_REPLY_TO.
 */
export function resolveInvoiceSender(
  tenant: TenantEmailSettings | null,
  env: SenderEnv
): { from: string; replyTo?: string } {
  const replyTo =
    tenant?.invoiceReplyTo?.trim() || env.RESEND_REPLY_TO?.trim() || undefined;
  if (replyTo && !EMAIL_RE.test(replyTo))
    throw new Error("Reply-to и-мэйл хаяг буруу байна: " + replyTo);

  const tenantFrom = tenant?.invoiceFromEmail?.trim();
  if (tenantFrom) {
    if (!EMAIL_RE.test(tenantFrom))
      throw new Error("Илгээгч и-мэйл хаяг буруу байна: " + tenantFrom);
    if (!tenant?.emailDomainVerified) throw new Error(DOMAIN_NOT_VERIFIED_MSG);
    return {
      from: formatFrom(tenantFrom, tenant.companyName),
      ...(replyTo ? { replyTo } : {}),
    };
  }

  const envFrom = env.RESEND_FROM_EMAIL?.trim();
  if (envFrom) {
    if (!EMAIL_RE.test(envFrom))
      throw new Error("RESEND_FROM_EMAIL хаяг буруу байна: " + envFrom);
    return {
      from: formatFrom(envFrom, env.RESEND_FROM_NAME),
      ...(replyTo ? { replyTo } : {}),
    };
  }

  // Хуучин тохиргоо — хэрэглэгч өөрөө зориуд тавьсан үед л (sandbox default
  // байхаа больсон).
  const legacy = env.RESEND_FROM?.trim();
  if (legacy) return { from: legacy, ...(replyTo ? { replyTo } : {}) };

  throw new Error(SENDER_NOT_CONFIGURED_MSG);
}

/**
 * Resend-ийн алдааг хэрэглэгчид ойлгомжтой монгол мессеж болгоно.
 * Sandbox/verify хийгдээгүй домэйныг таньж тусгай зөвлөмж өгнө; бусад
 * алдааны эх текстийг залгилгүй хамт үзүүлнэ.
 */
export function translateResendError(message: string): string {
  if (
    /only send testing emails|verify a domain|domain is not verified|not verified/i.test(
      message
    )
  ) {
    return (
      "Илгээгч домэйн Resend дээр баталгаажаагүй байна. resend.com/domains " +
      "дээр домэйнээ verify хийж, тохиргооноос илгээгч хаягаа шинэчилнэ үү. " +
      `(Resend: ${message})`
    );
  }
  return `И-мэйл илгээгдсэнгүй: ${message}`;
}

/** Нэхэмжлэхийн и-мэйлд хэрэгтэй өгөгдөл — payload-аас нарийссан хэлбэр. */
export type InvoiceEmailData = {
  documentNo: string;
  companyName: string;
  totalAmount: number;
  currency: string;
  dueDate: string;
  bankAccounts: { bankName: string; accountNo: string; accountName: string }[];
};

/**
 * Resend-д өгөх и-мэйлийн payload — PDF хавсралт + "онлайнаар үзэх" линк
 * ХОЁУЛАА орно (хавсралт спам шүүлтүүрт орвол линк нөөц зам). Файлын нэр
 * `{documentNo}.pdf` (жишээ: AR-20260915-CAD8E5.pdf).
 */
export function buildInvoiceEmailPayload(args: {
  invoice: InvoiceEmailData;
  to: string;
  from: string;
  replyTo?: string;
  viewUrl: string;
  pdf: Buffer;
}) {
  const { invoice } = args;
  return {
    from: args.from,
    to: args.to,
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    subject: `Нэхэмжлэх № ${invoice.documentNo} — ${invoice.companyName}`,
    text: [
      `Сайн байна уу,`,
      ``,
      `${invoice.companyName}-с илгээсэн № ${invoice.documentNo} нэхэмжлэхийг хавсаргав.`,
      ``,
      `Дүн: ${invoice.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${invoice.currency}`,
      `Төлөх огноо: ${invoice.dueDate}`,
      ``,
      `Онлайнаар үзэх: ${args.viewUrl}`,
      ``,
      invoice.bankAccounts.length
        ? `Төлбөр хүлээн авах данс:\n${invoice.bankAccounts
            .map(
              (account) =>
                `  ${account.bankName} · ${account.accountNo} · ${account.accountName}`
            )
            .join("\n")}`
        : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
    attachments: [
      {
        filename: `${invoice.documentNo}.pdf`,
        content: args.pdf.toString("base64"),
      },
    ],
  };
}
