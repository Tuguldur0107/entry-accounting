// Харилцагчийн СУБЪЕКТИЙН төрөл — Байгууллага эсвэл Хувь хүн (ЦЭВЭР, client-safe).
//
// `counterparties.entityKind` нь `counterpartyType` (авлага/өглөгийн ЧИГЛЭЛ)-ээс
// ТУСДАА хэмжээс: байгууллага ч, хувь хүн ч авлагын/өглөгийн харилцагч байж болно.
// Регистрийн талбарын утга төрлөөс хамаарна — байгууллагад РД (7 орон) эсвэл ТТД
// (11/14 орон), хувь хүнд иргэний РД (2 кирилл үсэг + 8 орон). Шалгалт нь
// ЗӨВЛӨМЖ (хориг биш): гадаадын харилцагч өөр форматтай байж болно.

//
// ДИНАМИК ТӨРӨЛ (counterparty_entity_kinds): байгууллага бүр өөрийн төрөл нэмнэ
// (ж: «Төрийн байгууллага», «ТББ», «Гадаадын иргэн»). «Байгууллага» / «Хувь
// хүн» нь СИСТЕМИЙН төрөл — үргэлж бий, устгагдахгүй (нэрийг нь л засна).
// Шинэ төрөл бүр `baseKind`-тай («байгууллага шиг» / «хувь хүн шиг»);
// регистрийн шалгалт, eBarimt B2B зэрэг бизнесийн логик ЗӨВХӨН baseKind-аар
// ажиллана — код даяар шинэ төрлийн нэрийг/кодыг hardcode хийхгүй.

/** Бизнесийн логикийн СУУРЬ төрөл (систем). */
export const COUNTERPARTY_ENTITY_KINDS = ["organization", "individual"] as const;
export type CounterpartyEntityKind = (typeof COUNTERPARTY_ENTITY_KINDS)[number];
/** Суурь төрлийн нэр — `CounterpartyEntityKind`-тэй ижил (уншигдахуйц нэр). */
export type CounterpartyBaseKind = CounterpartyEntityKind;

export const COUNTERPARTY_ENTITY_KIND_LABELS: Record<CounterpartyEntityKind, string> = {
  organization: "Байгууллага",
  individual: "Хувь хүн",
};

export const DEFAULT_COUNTERPARTY_ENTITY_KIND: CounterpartyEntityKind = "organization";

/** Нэг төрөл — систем эсвэл байгууллагын нэмсэн. */
export interface EntityKindOption {
  /** `counterparties.entityKind`-д хадгалагдах код. */
  code: string;
  name: string;
  baseKind: CounterpartyBaseKind;
  /** Систем төрөл — устгагдахгүй, суурь нь өөрчлөгдөхгүй. */
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
}

export const SYSTEM_ENTITY_KINDS: readonly EntityKindOption[] = COUNTERPARTY_ENTITY_KINDS.map(
  (code, index) => ({
    code,
    name: COUNTERPARTY_ENTITY_KIND_LABELS[code],
    baseKind: code,
    isSystem: true,
    isActive: true,
    sortOrder: index,
  })
);

/** Байгууллагын нэмсэн төрлийн код — `kind_<n>` (систем кодтой давхцахгүй). */
export const CUSTOM_ENTITY_KIND_CODE_RE = /^kind_\d{1,6}$/;

export function isSystemEntityKind(code: unknown): code is CounterpartyEntityKind {
  return (COUNTERPARTY_ENTITY_KINDS as readonly unknown[]).includes(code);
}

/**
 * Хадгалсан мөрүүдийг системийн төрөлтэй нийлүүлнэ. Систем төрлийн мөр
 * (нэр засагдсан) нь зөвхөн НЭРИЙГ дарна — суурь, идэвх өөрчлөгдөхгүй.
 * Эрэмбэ: систем эхэнд, дараа нь sortOrder → нэр.
 */
export function resolveEntityKinds(
  rows: readonly {
    code: string;
    name: string;
    baseKind: string;
    isActive: boolean;
    sortOrder: number;
  }[] | null | undefined
): EntityKindOption[] {
  const byCode = new Map<string, EntityKindOption>(SYSTEM_ENTITY_KINDS.map((kind) => [kind.code, { ...kind }]));
  for (const row of rows ?? []) {
    const name = row.name.trim();
    if (isSystemEntityKind(row.code)) {
      if (name) byCode.get(row.code)!.name = name;
      continue;
    }
    if (!name) continue;
    byCode.set(row.code, {
      code: row.code,
      name,
      baseKind: row.baseKind === "individual" ? "individual" : "organization",
      isSystem: false,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    });
  }
  return [...byCode.values()].sort(
    (a, b) =>
      Number(b.isSystem) - Number(a.isSystem) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, "mn")
  );
}

/** Код → суурь төрөл. Танигдахгүй код → байгууллага (хамгийн болгоомжтой default). */
export function baseKindOf(
  code: string | null | undefined,
  kinds: readonly EntityKindOption[] = SYSTEM_ENTITY_KINDS
): CounterpartyBaseKind {
  if (isSystemEntityKind(code)) return code;
  return kinds.find((kind) => kind.code === code)?.baseKind ?? DEFAULT_COUNTERPARTY_ENTITY_KIND;
}

/** Код → харагдах нэр. Танигдахгүй бол кодыг өөрийг нь (нуухгүй). */
export function entityKindName(
  code: string | null | undefined,
  kinds: readonly EntityKindOption[] = SYSTEM_ENTITY_KINDS
): string {
  if (!code) return COUNTERPARTY_ENTITY_KIND_LABELS[DEFAULT_COUNTERPARTY_ENTITY_KIND];
  return kinds.find((kind) => kind.code === code)?.name ?? code;
}

/**
 * Харилцагчид оноох төрлийг шалгана: хоосон → default, байгууллагын
 * жагсаалтад ИДЭВХТЭЙ байх ёстой (идэвхгүй төрлийг `current` хэвээр
 * үлдээхийг зөвшөөрнө — засахад унахгүй). Буцаах: код эсвэл алдаа.
 */
export function resolveEntityKindCode(
  value: unknown,
  kinds: readonly EntityKindOption[],
  current?: string | null
): { code: string } | { error: string } {
  if (value == null || value === "") return { code: DEFAULT_COUNTERPARTY_ENTITY_KIND };
  const code = String(value).trim();
  const kind = kinds.find((entry) => entry.code === code || entry.name.toLowerCase() === code.toLowerCase());
  if (!kind)
    return {
      error: `Харилцагчийн төрөл «${code}» бүртгэлд алга — ${kinds
        .filter((entry) => entry.isActive)
        .map((entry) => `${entry.name} (${entry.code})`)
        .join(", ")}`,
    };
  if (!kind.isActive && kind.code !== current)
    return { error: `«${kind.name}» төрөл идэвхгүй болсон байна` };
  return { code: kind.code };
}

/** Дараагийн чөлөөт `kind_<n>` код. */
export function nextEntityKindCode(kinds: readonly { code: string }[]): string {
  let max = 0;
  for (const kind of kinds) {
    const match = /^kind_(\d+)$/.exec(kind.code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `kind_${max + 1}`;
}

/** Шинэ/засах төрлийн нэрийг шалгана (давхардал, урт). null = зөв. */
export function entityKindNameError(
  name: string,
  kinds: readonly EntityKindOption[],
  exceptCode?: string
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Төрлийн нэр оруулна уу";
  if (trimmed.length > 60) return "Төрлийн нэр 60 тэмдэгтээс ихгүй";
  const clash = kinds.find(
    (kind) => kind.code !== exceptCode && kind.name.toLowerCase() === trimmed.toLowerCase()
  );
  return clash ? `«${clash.name}» нэртэй төрөл бүртгэгдсэн байна` : null;
}

/** Иргэний регистрийн дугаар — 2 кирилл үсэг + 8 орон (ж: УУ12345678). */
export const CITIZEN_REGISTER_NO_RE = /^[А-ЯЁӨҮ]{2}\d{8}$/u;
/** Байгууллагын регистр (7 орон) эсвэл ТТД (11/14 орон). */
export const ORGANIZATION_REGISTER_NO_RE = /^(\d{7}|\d{11}|\d{14})$/;

/** Хоосон / буруу утгыг default руу (хуучин мөр, гадаад оролт). */
export function normalizeEntityKind(value: unknown): CounterpartyEntityKind {
  return value === "individual" ? "individual" : DEFAULT_COUNTERPARTY_ENTITY_KIND;
}

export function isCounterpartyEntityKind(value: unknown): value is CounterpartyEntityKind {
  return (COUNTERPARTY_ENTITY_KINDS as readonly unknown[]).includes(value);
}

export function entityKindLabel(value: unknown): string {
  return COUNTERPARTY_ENTITY_KIND_LABELS[normalizeEntityKind(value)];
}

/** Регистрийн талбарын шошго — төрлөөс хамаарна. */
export function registerNoLabel(kind: CounterpartyEntityKind): string {
  return kind === "individual" ? "Регистрийн дугаар" : "Регистр / ТТД";
}

export function registerNoPlaceholder(kind: CounterpartyEntityKind): string {
  return kind === "individual" ? "УУ12345678" : "2693518 эсвэл ТТД 11/14 орон";
}

/**
 * Регистрийн дугаараас төрлийг ТААНА — зөвхөн иргэний РД-ийн хэлбэр таарвал
 * `individual`, бусад тохиолдолд null (таамаглахгүй). UI регистр бичихэд санал
 * болгоно, preDeploy хуучин мөрийг нөхөхөд ашиглана.
 */
export function inferEntityKindFromRegisterNo(registerNo: string | null | undefined): CounterpartyEntityKind | null {
  const value = (registerNo ?? "").trim().toUpperCase();
  if (!value) return null;
  if (CITIZEN_REGISTER_NO_RE.test(value)) return "individual";
  if (ORGANIZATION_REGISTER_NO_RE.test(value)) return "organization";
  return null;
}

/**
 * Регистр нь төрөлтэйгээ зөрж байгаа эсэх — ЗӨВЛӨМЖИЙН текст (null = асуудалгүй).
 * Хориг биш: гадаадын харилцагч, түр дугаар зэрэгт хэрэглэгч хадгалж болно.
 */
export function registerNoMismatch(kind: CounterpartyEntityKind, registerNo: string | null | undefined): string | null {
  const inferred = inferEntityKindFromRegisterNo(registerNo);
  if (!inferred || inferred === kind) return null;
  return inferred === "individual"
    ? "Регистр нь иргэний РД хэлбэртэй байна — «Хувь хүн» гэж бүртгэх үү?"
    : "Регистр нь байгууллагын РД/ТТД хэлбэртэй байна — «Байгууллага» гэж бүртгэх үү?";
}

/**
 * Харилцагчийн ЧИГЛЭЛ ба баримтын төрлийн тааралт (SIM ENT-031 — «Авлага»
 * төрөлтэй харилцагч дээр АП нэхэмжлэх батлагдаж байв). Авлагын нэхэмжлэл →
 * customer|both, өглөгийн нэхэмжлэх → supplier|both. null = таарсан.
 */
export function counterpartyDirectionError(
  documentType: string,
  counterpartyType: string | null | undefined,
  counterpartyName = "Харилцагч"
): string | null {
  const type = counterpartyType ?? "both";
  if (documentType === "ap_bill" && type === "customer")
    return `[COUNTERPARTY_DIRECTION] ${counterpartyName} нь зөвхөн «Авлага» (худалдан авагч) төрөлтэй — өглөгийн нэхэмжлэх үүсгэхгүй. Харилцагчийн «Тооцоо»-г «Авлага/Өглөг» (both) болгоно уу`;
  if (documentType === "ar_invoice" && type === "supplier")
    return `[COUNTERPARTY_DIRECTION] ${counterpartyName} нь зөвхөн «Өглөг» (нийлүүлэгч) төрөлтэй — авлагын нэхэмжлэл үүсгэхгүй. Харилцагчийн «Тооцоо»-г «Авлага/Өглөг» (both) болгоно уу`;
  return null;
}
