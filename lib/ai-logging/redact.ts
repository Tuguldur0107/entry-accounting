// jsonb доторх PII-г цэвэрлэх — ЦЭВЭР логик, ЗӨВХӨН WHITELIST зарчмаар.
//
// `@/lib/db` импорт ХИЙХГҮЙ.
//
// ЯАГААД WHITELIST (blacklist БИШ):
//   Blacklist ("эдгээр талбарыг хас") нь шинэ талбар нэмэгдэх бүрд чимээгүй
//   алдаж эхэлдэг — хөгжүүлэгч `supplierLegalName` нэмэхэд хуучин жагсаалт
//   түүнийг мэдэхгүй тул ГЛОБАЛ загвар руу шууд урсана. Whitelist нь эсрэгээр
//   ажиллана: МЭДЭГДЭЭГҮЙ бүх талбар DEFAULT-ААР redact хийгдэнэ, талбар
//   нэмэх бүрд хүн ухамсартайгаар энэ жагсаалтад бүртгэнэ.
//
// Хамрах хүрээ: `tenant_only` scope-д өгөгдөл БҮРЭН хэвээр (байгууллагын
// өөрийн өгөгдөл, tenant тусгаарлалтаар хамгаалагдсан). Redaction нь
// зөвхөн `industry` / `global` scope-д — өөрөөр хэлбэл өгөгдөл ӨӨРИЙН
// байгууллагаас ГАДАГШ гарахад л.

import {
  DEFAULT_TRAINING_SCOPE,
  type AiTrainingScope,
} from "./constants";

/** Цэвэрлэгдсэн утгын орлуулагч — сургалтад «мэдэгдэхгүй» гэж уншигдана. */
export const REDACTED = "[redacted]";

/**
 * ГЛОБАЛ/САЛБАРЫН scope руу гарч болох СКАЛЯР талбарууд.
 *
 * Зөвхөн ТООН, ОГНООН, АНГИЛЛЫН утга — таних мэдээлэл агуулах боломжгүй
 * талбарууд. Жагсаалтад БАЙХГҮЙ бүх скаляр `[redacted]` болно.
 *
 * ЗОРИУД ОРООГҮЙ (хэрэглэгчийн шийдвэрээр л нэмэгдэнэ):
 *   • дансны дугаар (accountNumber, postingCode) — сегментийн код нь
 *     компани / төсөл / МГ-ийн кодыг агуулдаг
 *   • харилцагч / нийлүүлэгчийн нэр, РД, ТТД, банкны данс
 *   • чөлөөт текст (description, memo, note, summary) — нэр агуулж болно
 *
 * Тэмдэглэл: дансны дугааргүйгээр `global` scope-ийн сургалтын үнэ цэнэ
 * хязгаарлагдмал — бодит хэрэглээ нь `tenant_only`. Дансны дугаарыг
 * нээх эсэх нь ТУСАД НЬ гаргах шийдвэр (docs/ai-logging.md §4).
 */
export const GLOBAL_SAFE_KEYS: ReadonlySet<string> = new Set([
  // Мөнгөн дүн, тоо хэмжээ
  "amount",
  "debit",
  "credit",
  "total",
  "subtotal",
  "quantity",
  "qty",
  "unitprice",
  "vatamount",
  "discountamount",
  "linecount",
  "count",
  // Огноо, тайлант үе
  "date",
  "duedate",
  "valuedate",
  "period",
  "periodcode",
  // Валют, ханш
  "currency",
  "exchangerate",
  "rate",
  "ratesource",
  // Ангилал / enum — таних мэдээлэл агуулдаггүй тогтмол үгсийн сан
  "kind",
  "type",
  "mode",
  "status",
  "direction",
  "vatmode",
  "adjustmenttype",
  "resolution",
  "source",
  "doctype",
  "issuetype",
  // Бүтцийн лавлагаа
  "index",
  "seq",
  "lineno",
]);

/**
 * PII хээ — whitelist давсан ч энэ хээнд тохирвол хасна.
 * ДАРААЛАЛ ЧУХАЛ: тодорхой хээ нь ерөнхийгөөсөө ӨМНӨ байна (эс бөгөөс
 * сегментийн код нь "long_digits" гэж буруу нэрлэгдэж оношлоход хүндрэнэ).
 */
const PII_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "email", re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  // Монгол иргэний РД: 2 кирилл үсэг + 8 орон (УБ12345678)
  { name: "register_no", re: /[Ѐ-ӿ]{2}\s?\d{8}/ },
  // Сегментийн цэгтэй код: 101.000000.11210000...
  { name: "segment_code", re: /\d+\.\d+\.\d+/ },
  // ТТД (7/11/14 орон), банкны данс, утас, 8 оронтой дансны код, IBAN
  { name: "long_digits", re: /\d{7,}/ },
];

type Json = unknown;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\s-]/g, "");
}

/** Скаляр утга нь PII хээнд тохирч байна уу (эхний тохирлын нэр). */
export function scalarPiiHit(value: Json): string | null {
  if (typeof value !== "string") return null;
  for (const { name, re } of PII_PATTERNS) if (re.test(value)) return name;
  return null;
}

/**
 * jsonb доторх PII-г ХАЙНА — цэвэрлэлт ажилласан эсэхийг НОТЛОХ зорилготой
 * (planTrainingScope-ийн хоёр дахь бүс). Зам бүрийг буцаана.
 */
export function findPii(value: Json, path = "$"): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value))
    return value.flatMap((item, i) => findPii(item, `${path}[${i}]`));
  if (typeof value === "object")
    return Object.entries(value as Record<string, Json>).flatMap(([k, v]) => {
      // ТҮЛХҮҮР ӨӨРӨӨ PII байж болно: `{ "УБ12345678": 5 }` гэх мэт
      // (данс / РД-г map-ийн түлхүүр болгосон payload). Зөвхөн утгыг
      // шалгавал энэ зам чимээгүй алдагдана.
      const keyHit = scalarPiiHit(k);
      return [
        ...(keyHit ? [`${path}.${k} <түлхүүр> (${keyHit})`] : []),
        ...findPii(v, `${path}.${k}`),
      ];
    });
  const hit = scalarPiiHit(value);
  return hit ? [`${path} (${hit})`] : [];
}

/**
 * Whitelist-ээр цэвэрлэнэ.
 *
 * Дүрэм:
 *  • ОБЪЕКТ / МАСSИВ — ҮРГЭЛЖ дотогш орно (бүтэц нь өөрөө PII биш).
 *    Тиймээс `lines: [{ accountNumber, debit }]` нь бүтнээрээ алга болохгүй,
 *    харин `accountNumber` нь redact, `debit` нь үлдэнэ.
 *  • СКАЛЯР — түлхүүр нь GLOBAL_SAFE_KEYS-д байвал ба PII хээнд тохирохгүй
 *    бол л үлдэнэ. ӨӨР БҮХ ТОХИОЛДОЛД `[redacted]`.
 *
 * Оролтыг ХЭЗЭЭ Ч мутац хийхгүй (шинэ бүтэц буцаана).
 */
export function redactValue(value: Json, keyContext = ""): Json {
  if (value === null || value === undefined) return value ?? null;

  if (Array.isArray(value))
    // Массивын элемент нь эцэг түлхүүрийнхээ контекстийг ӨВЛӨНӨ:
    // `codes: ["11210000"]` нь `codes` гэсэн түлхүүрээр шалгагдана.
    return value.map((item) => redactValue(item, keyContext));

  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, Json>)) {
      // ТҮЛХҮҮР нь өөрөө PII байвал (данс / РД-г map түлхүүр болгосон
      // payload) БҮТНЭЭР НЬ хасна — түлхүүрийг `[redacted]` болговол олон
      // оролт мөргөлдөж өгөгдөл чимээгүй алдагдана.
      if (scalarPiiHit(k)) continue;
      out[k] = redactValue(v, k);
    }
    return out;
  }

  // Скаляр: whitelist + PII хээний ХОЁУЛАНГ давна.
  if (!GLOBAL_SAFE_KEYS.has(normalizeKey(keyContext))) return REDACTED;
  if (scalarPiiHit(value)) return REDACTED;
  return value;
}

/** Scope-оос хамаарсан цэвэрлэлт — `tenant_only` бол хөндөхгүй. */
export function redactForScope(value: Json, scope: AiTrainingScope): Json {
  if (scope === "tenant_only") return value ?? null;
  return redactValue(value);
}

export type TrainingScopePlan = {
  scope: AiTrainingScope;
  /** Хүссэн scope буурсан бол шалтгаан, үгүй бол null. */
  downgradeReason: string | null;
};

/**
 * Хүссэн scope-ыг ШАЛГАЖ эцсийн scope-ыг шийднэ.
 *
 * ХАТУУ ДҮРЭМ: `tenant_only`-оос ДЭЭШ ХЭЗЭЭ Ч АВТОМАТААР өргөгдөхгүй —
 * `industry`/`global` нь дуудагчийн ИЛ параметрээр л ирнэ. Ирсэн ч
 * цэвэрлэлтийн ДАРАА PII үлдсэн бол `tenant_only` руу БУУРНА (шидэхгүй,
 * шалтгааныг бүртгэнэ) — бүртгэлийн давхарга бизнесийн урсгалыг унагахгүй.
 */
export function planTrainingScope(
  requested: AiTrainingScope | undefined,
  payloads: Json[]
): TrainingScopePlan {
  const scope = requested ?? DEFAULT_TRAINING_SCOPE;
  if (scope === "tenant_only") return { scope, downgradeReason: null };

  const leaks = payloads.flatMap((p) => findPii(redactForScope(p, scope)));
  if (leaks.length > 0)
    return {
      scope: DEFAULT_TRAINING_SCOPE,
      downgradeReason: `Цэвэрлэлтийн дараа PII үлдсэн тул ${scope} → tenant_only: ${leaks
        .slice(0, 5)
        .join(", ")}`,
    };
  return { scope, downgradeReason: null };
}
