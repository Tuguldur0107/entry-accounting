// Кассын «НӨАТ» мөр — eBarimt худалдан авагчийн ЦЭВЭР дүрэм (tests/pos-ebarimt-buyer.test.ts).
// CLIENT-SAFE: кассын дэлгэц ба төлбөрийн диалог хоёулаа импортолно.
//
//   Хувь хүн (B2C)  — eBarimt хэрэглэгчийн дугаар (8 орон, сонголтоор)
//   ААН (B2B)       — байгууллагын РЕГИСТР (7 орон) → ТЕГ-ийн лавлахаас ТТД + НЭР
//                     (getTinInfo → getInfo, lib/ebarimt/lookup.ts); ТТД (11/14) шууд

import { CONSUMER_NO_RE, MERCHANT_TIN_RE } from "@/lib/ebarimt/constants";

/** eBarimt-ийн худалдан авагч (createPosSale-д дамжина). */
export interface EbarimtBuyerInput {
  ebarimtConsumerNo: string | null;
  ebarimtCustomerTin: string | null;
  ebarimtCustomerRegNo: string | null;
  /** «eBarimt илгээх» унтраалттай — энэ борлуулалт ТЕГ-д илгээгдэхгүй (статус skipped). */
  skipEbarimt: boolean;
}

export const EMPTY_BUYER: EbarimtBuyerInput = {
  ebarimtConsumerNo: null,
  ebarimtCustomerTin: null,
  ebarimtCustomerRegNo: null,
  skipEbarimt: false,
};

export type BuyerType = "individual" | "org";

/** Байгууллагын дугаарын хэлбэр: 7 оронтой регистр | 11/14 оронтой ТТД. */
export type OrgNoKind = "empty" | "register" | "tin" | "incomplete";

export const ORG_REGISTER_RE = /^\d{7}$/;

export function orgNoKind(raw: string): OrgNoKind {
  const value = raw.trim();
  if (!value) return "empty";
  if (ORG_REGISTER_RE.test(value)) return "register";
  if (MERCHANT_TIN_RE.test(value)) return "tin";
  return "incomplete";
}

/** Оролтыг цэвэрлэнэ — зөвхөн цифр, ≤14 (регистр 7, ТТД 11/14). */
export function sanitizeOrgNo(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 14);
}

export interface OrgLookupState {
  /** Лавлахаар олдсон (регистрт) — ТТД + нэр. */
  tin: string;
  name: string;
  status: "idle" | "loading" | "found" | "error";
  error: string;
}

export interface BuyerState {
  type: BuyerType;
  consumerNo: string;
  orgNo: string;
  lookup: OrgLookupState;
}

export const IDLE_LOOKUP: OrgLookupState = { tin: "", name: "", status: "idle", error: "" };

/**
 * Төлөх боломжтой эсэх + createPosSale-ийн оролт. ААН сонгосон бол дугаар
 * ЗААВАЛ: регистр → лавлах амжилттай байх (нэр/ТТД харагдсан), ТТД → шууд.
 */
export function resolveBuyer(state: BuyerState): { buyer: EbarimtBuyerInput; problem: string | null } {
  if (state.type === "individual") {
    const value = state.consumerNo.trim();
    if (value && !CONSUMER_NO_RE.test(value))
      return { buyer: EMPTY_BUYER, problem: "eBarimt хэрэглэгчийн дугаар 8 оронтой байна" };
    return { buyer: { ...EMPTY_BUYER, ebarimtConsumerNo: value || null }, problem: null };
  }
  const value = state.orgNo.trim();
  const kind = orgNoKind(value);
  if (kind === "empty") return { buyer: EMPTY_BUYER, problem: "Байгууллагын регистрийн дугаар (7 орон) оруулна уу" };
  if (kind === "incomplete")
    return { buyer: EMPTY_BUYER, problem: "Регистр 7 оронтой (эсвэл ТТД 11/14 оронтой) байна" };
  if (kind === "tin") return { buyer: { ...EMPTY_BUYER, ebarimtCustomerTin: value }, problem: null };
  if (state.lookup.status === "loading") return { buyer: EMPTY_BUYER, problem: "Байгууллагыг ТЕГ-ээс шалгаж байна…" };
  if (state.lookup.status !== "found" || !state.lookup.tin)
    return { buyer: EMPTY_BUYER, problem: state.lookup.error || "Байгууллага ТЕГ-ийн бүртгэлээс олдоогүй" };
  return {
    buyer: { ...EMPTY_BUYER, ebarimtCustomerTin: state.lookup.tin, ebarimtCustomerRegNo: value },
    problem: null,
  };
}
