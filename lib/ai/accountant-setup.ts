// «AI нягтлан» — хэрэглэгч өөрийн ChatGPT / Claude-ийн ТӨСӨЛД (Project
// instructions / Custom instructions) буулгах зааврын ЦЭВЭР бүтээгч +
// багцын төлөв. CLIENT-SAFE (DB-гүй) — tests/ai-accountant-setup.test.ts.
//
// Мэдлэгийн сан (docs/dev/knowledge.md §9e) SaaS-ийн нягтлан бодох багц бүрд
// ҮНЭГҮЙ дагалдана; энэ модуль түүнийг «идэвхжүүлэх» ЗАМ БИШ — багц/боломжийг
// зөвхөн Console шийднэ (billing дүрэм). Энд зөвхөн:
//   • төлөвийг ил харуулах (багцад багтсан эсэх, өнөөдрийн уншилт)
//   • хэрэглэгчийн AI-г «нягтлан» болгох зааврыг сонголтоор бүтээх
// Сонголт хэрэглэгчийн хөтчид л (localStorage) — сервер AI дуудахгүй, DB-д
// хадгалахгүй: заавар нь хэрэглэгчийн ӨӨРИЙН төсөлд амьдарна.

import type { AiWriteMode } from "@/lib/ai/write-mode";
import type { ConnectorClient } from "@/lib/ai/connector-clients";
import {
  featureUsable,
  hasFeature,
  KNOWLEDGE_READ_ONLY_MESSAGES,
  type Entitlements,
} from "@/lib/billing/entitlements";

/** Хэнд зориулж хариулах вэ. */
export type AccountantAudience = "accountant" | "owner";
/** Хариултын дэлгэрэнгүй. */
export type AccountantDetail = "brief" | "detailed";

export interface AccountantSetup {
  audience: AccountantAudience;
  detail: AccountantDetail;
}

export const DEFAULT_ACCOUNTANT_SETUP: AccountantSetup = { audience: "accountant", detail: "brief" };

export const ACCOUNTANT_AUDIENCE_LABELS: Record<AccountantAudience, string> = {
  accountant: "Нягтланд",
  owner: "Захирал, эзэнд",
};

export const ACCOUNTANT_DETAIL_LABELS: Record<AccountantDetail, string> = {
  brief: "Товч",
  detailed: "Дэлгэрэнгүй",
};

/**
 * ChatGPT-ийн Custom instructions талбарын хязгаар (1500 тэмдэгт) — заавар
 * аль ч сонголтод үүнд багтана (тест баталгаажуулна). Claude-ийн төслийн
 * заавар илүү урт хүлээдэг ч нэг л текст хоёуланд ажиллана.
 */
export const ACCOUNTANT_INSTRUCTIONS_MAX_CHARS = 1500;

/** Зааварт орох байгууллагын нэрийн дээд урт. */
const ORG_NAME_MAX = 80;

/**
 * Зааврыг хаана буулгах вэ — гадны бүтээгдэхүүний цэс тул өөрчлөгдвөл ЗӨВХӨН
 * энд засна (connector-ийн хаяг lib/ai/connector-clients.ts-д).
 */
export const ACCOUNTANT_PASTE_STEPS: Record<ConnectorClient, string[]> = {
  claude: [
    "claude.ai → Projects → шинэ төсөл (жишээ нь «Нягтлан») үүсгэнэ",
    "Төслийн Instructions хэсэгт доорх зааврыг буулгаж хадгална",
    "Тэр төсөл дотор чат нээж асууна — Entry connector асаалттай байна",
  ],
  chatgpt: [
    "ChatGPT → Projects → шинэ төсөл (жишээ нь «Нягтлан») үүсгэнэ",
    "Төслийн Instructions хэсэгт доорх зааврыг буулгаж хадгална",
    "Тэр төсөл дотор чат нээгээд «+» → Entry-г сонгож асууна",
  ],
};

function isAudience(value: unknown): value is AccountantAudience {
  return value === "accountant" || value === "owner";
}

function isDetail(value: unknown): value is AccountantDetail {
  return value === "brief" || value === "detailed";
}

/** Хөтчид хадгалсан сонголтыг (JSON) уншина — гажиг/хоосон бол анхдагч. */
export function parseAccountantSetup(raw: string | null | undefined): AccountantSetup {
  if (!raw) return { ...DEFAULT_ACCOUNTANT_SETUP };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return { ...DEFAULT_ACCOUNTANT_SETUP };
    const record = value as Record<string, unknown>;
    return {
      audience: isAudience(record.audience) ? record.audience : DEFAULT_ACCOUNTANT_SETUP.audience,
      detail: isDetail(record.detail) ? record.detail : DEFAULT_ACCOUNTANT_SETUP.detail,
    };
  } catch {
    return { ...DEFAULT_ACCOUNTANT_SETUP };
  }
}

function cleanOrgName(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").replace(/\s+/g, " ").replace(/[«»]/g, "").trim();
  if (!trimmed) return null;
  return trimmed.length > ORG_NAME_MAX ? `${trimmed.slice(0, ORG_NAME_MAX - 1)}…` : trimmed;
}

/**
 * Хэрэглэгчийн AI-д буулгах заавар. `accounting` = байгууллага нягтлан бодох
 * системийг ашигладаг (бичилт, тайлан MCP-ээр); үгүй бол зөвхөн мэдлэгийн
 * зөвлөгөө («AI нягтлан» багц). Бичилтийн горим нь §9-ийн human-in-the-loop-ийг
 * ИЛ давтана — AI шууд батлах горимыг заавраар ӨӨРЧЛӨХГҮЙ (тохиргоо Entry-д).
 */
export function buildAccountantInstructions(input: {
  orgName: string | null | undefined;
  accounting: boolean;
  writeMode: AiWriteMode;
  setup: AccountantSetup;
}): string {
  const org = cleanOrgName(input.orgName);
  const lines: string[] = [];

  lines.push(
    input.accounting
      ? `Та ${org ? `«${org}»-ийн` : "манай компанийн"} AI нягтлан. Entry Accounting системтэй MCP-ээр холбогдсон.`
      : "Та Монголын нягтлан бодох бүртгэл, татварын AI зөвлөх. Entry-ийн «AI нягтлан» мэдлэгийн сантай MCP-ээр холбогдсон."
  );
  lines.push("Дүрэм:");

  const rules: string[] = [
    "IFRS, Монголын татвар (НӨАТ, ААНОАТ, ХАОАТ), НДШ, цалингийн асуултад санах ойгоос ТААХГҮЙ — Entry-ийн list_knowledge_topics → read_knowledge_section-оор уншиж, стандарт, хуулийн ишлэлийг заавал дурдана.",
    "Татварын хувь, босго огноогоор өөрчлөгддөг — аль он, сарын тухай болохыг тодруулна.",
  ];
  if (input.accounting) {
    rules.push(
      "Компанийн тоо (үлдэгдэл, тайлан, авлага, өглөг)-г Entry-ийн tool-оос авна — тоо зохиохгүй.",
      "Данс, харилцагч, бараа нэрээр олдохгүй эсвэл олон таарвал таамаглахгүй — надаас асууна.",
      input.writeMode === "post"
        ? "Бичилт үүсгэхийн өмнө Дт/Кт, дүн, огноог харуулж батлуулна. Шууд бичих горим асаалттай ч батлах хязгаараас дээш, хаалт, цалин ноорог үлдэнэ."
        : "Бичилт үүсгэхийн өмнө Дт/Кт, дүн, огноог харуулж батлуулна. Бичилт ноорог болж орно — би Entry дээр шалгаад батална."
    );
  } else {
    rules.push("Энэ холболтоор бүртгэл хийхгүй — зөвлөгөө, тайлбар, тооцооны жишээ л өгнө.");
  }
  rules.forEach((rule, index) => lines.push(`${index + 1}. ${rule}`));

  const detail =
    input.setup.detail === "detailed"
      ? "Дэлгэрэнгүй — тооцооны жишээ, журналын бичилт (Дт/Кт), ишлэлтэй."
      : "Товч — гол дүгнэлт эхэнд, дараа нь ишлэл.";
  const audience =
    input.setup.audience === "owner"
      ? "Нягтлан биш хүнд ойлгомжтойгоор, мэргэжлийн үгийг тайлбарлаж ярина."
      : "Нягтланд зориулж мэргэжлийн нэр томьёогоор ярина.";
  lines.push(`Хариулт: ${detail} ${audience} Монгол хэлээр хариулна.`);

  return lines.join("\n");
}

export type AiAccountantTone = "success" | "warning" | "danger";

/** «AI нягтлан» хэсгийн төлөв — server талд бодоод client component-д дамжина. */
export interface AiAccountantStatus {
  /** Багцад мэдлэгийн сан байгаа эсэх (Console override-оор унтарч болно). */
  included: boolean;
  /** ОДОО ашиглаж болох эсэх (read-only төлөвт хаагдана). */
  usable: boolean;
  tone: AiAccountantTone;
  badge: string;
  /** Хэрэглэгчид харуулах нэг өгүүлбэр. */
  message: string;
  readsToday: number;
  dailyLimit: number;
  /** Сангийн хэсгийн тоо (0 = хоосон — sync хийгдээгүй). */
  sections: number;
}

/**
 * Багц + хэрэглээнээс төлөв. `accounting` багцад мэдлэг «үнэгүй багтсан»;
 * «AI нягтлан» (skills) багцад захиалгын төлөв нь SkillsHome-ийн төлбөрийн алхамд.
 */
export function aiAccountantStatus(input: {
  ent: Entitlements;
  readsToday: number;
  dailyLimit: number;
  sections: number;
}): AiAccountantStatus {
  const { ent, readsToday, dailyLimit, sections } = input;
  const included = hasFeature(ent, "knowledge");
  const usable = featureUsable(ent, "knowledge");
  const base = { included, usable, readsToday, dailyLimit, sections };
  if (!included) {
    return {
      ...base,
      tone: "danger",
      badge: "Идэвхгүй",
      message: "Энэ байгууллагын багцад AI нягтлан (мэдлэгийн сан) идэвхгүй байна — Entry багтай холбогдоно уу.",
    };
  }
  if (!usable) {
    return {
      ...base,
      tone: "danger",
      badge: "Хаалттай",
      message: ent.readOnlyReason
        ? KNOWLEDGE_READ_ONLY_MESSAGES[ent.readOnlyReason]
        : "Захиалга идэвхгүй тул AI нягтлан түр хаалттай байна.",
    };
  }
  if (readsToday >= dailyLimit) {
    return {
      ...base,
      tone: "warning",
      badge: "Өнөөдрийн хязгаар хүрсэн",
      message: `Сүүлийн 24 цагт ${dailyLimit} хэсэг уншсан — хязгаар 24 цагийн дотор аажмаар сэргэнэ.`,
    };
  }
  return {
    ...base,
    tone: "success",
    badge: hasFeature(ent, "accounting") ? "Үнэгүй · багцад багтсан" : "Идэвхтэй",
    message: hasFeature(ent, "accounting")
      ? "Таны багцад AI нягтлан үнэгүй багтсан — нэмэлт төлбөргүй, тусад нь захиалах шаардлагагүй."
      : "AI нягтлан идэвхтэй.",
  };
}
