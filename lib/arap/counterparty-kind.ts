// Харилцагчийн СУБЪЕКТИЙН төрөл — Байгууллага эсвэл Хувь хүн (ЦЭВЭР, client-safe).
//
// `counterparties.entityKind` нь `counterpartyType` (авлага/өглөгийн ЧИГЛЭЛ)-ээс
// ТУСДАА хэмжээс: байгууллага ч, хувь хүн ч авлагын/өглөгийн харилцагч байж болно.
// Регистрийн талбарын утга төрлөөс хамаарна — байгууллагад РД (7 орон) эсвэл ТТД
// (11/14 орон), хувь хүнд иргэний РД (2 кирилл үсэг + 8 орон). Шалгалт нь
// ЗӨВЛӨМЖ (хориг биш): гадаадын харилцагч өөр форматтай байж болно.

export const COUNTERPARTY_ENTITY_KINDS = ["organization", "individual"] as const;
export type CounterpartyEntityKind = (typeof COUNTERPARTY_ENTITY_KINDS)[number];

export const COUNTERPARTY_ENTITY_KIND_LABELS: Record<CounterpartyEntityKind, string> = {
  organization: "Байгууллага",
  individual: "Хувь хүн",
};

export const DEFAULT_COUNTERPARTY_ENTITY_KIND: CounterpartyEntityKind = "organization";

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
