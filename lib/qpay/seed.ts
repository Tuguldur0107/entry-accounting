// QPay асаахад «QPay» төлбөрийн хэлбэр + түр данс АВТОМАТААР бүрдэх ЦЭВЭР
// төлөвлөгч (DB-гүй, тесттэй) — ensurePosSettings-ийн ratified-seed зарчим:
// байгаа мөрийг ХӨНДӨХГҮЙ, зөвхөн дутууг нэмнэ. Хэрэглэгч зөвхөн dashboard-ын
// key/secret оруулна; хэлбэр ба данс нь тохиргоо болж ил үлдэнэ (засаж болно).

import { QPAY_PROVIDER } from "./constants";

/** Түр дансны стандарт GL (lib/constants/standard-accounts.ts «Харилцах дансны түр данс»). */
export const QPAY_CLEARING_GL_ACCOUNT = "11000099";
export const QPAY_CLEARING_ACCOUNT_NAME = "QPay түр данс";
export const QPAY_METHOD_CODE = "QPAY";
export const QPAY_METHOD_NAME = "QPay";
/**
 * QPay-ийн eBarimt төлбөрийн код — PosAPI 3.0 албан жагсаалт `BANK_TRANSFER_QPAY`
 * (developer портал 2026-08, docs/integrations/01 P1-4). Урьд «код тодорхойгүй» тул
 * null seed-лэдэг байв; одоо албан код тул seed-д оноож, кодгүй байгаа хэлбэрт нөхнө.
 */
export const QPAY_EBARIMT_CODE = "BANK_TRANSFER_QPAY";

export interface QpaySeedMethod {
  id: string;
  code: string;
  kind: string;
  provider: string | null;
  cashAccountId: string | null;
  isActive: boolean;
  /** pos_payment_methods.ebarimtCode — өгөхгүй бол шалгахгүй (хуучин дуудагч). */
  ebarimtCode?: string | null;
}

export interface QpaySeedCashAccount {
  id: string;
  name: string;
  accountType: string;
  currency: string;
  isActive: boolean;
}

export interface QpaySeedPlan {
  /** Шинэ түр данс үүсгэх (байхгүй бол). */
  createAccount: { name: string; glAccountNumber: string } | null;
  /** Шинэ хэлбэр үүсгэх — cashAccountId нь `createAccount` бол дараа нь оноогдоно. */
  createMethod: { code: string; name: string; cashAccountId: string | null; ebarimtCode: string } | null;
  /** Байгаа QPay хэлбэрийг засах: түр данс оноох / дахин идэвхжүүлэх / eBarimt код нөхөх. */
  updateMethod: { id: string; cashAccountId?: string | null; isActive?: true; ebarimtCode?: string } | null;
  /** Хэрэглэгчид ил тайлбар (юу үүссэн / өөрчлөгдсөн). */
  notes: string[];
}

/** QPay-д тохирох түр данс: нэрээрээ QPay гэсэн идэвхтэй MNT банкны данс. */
export function pickQpayClearingAccount(accounts: QpaySeedCashAccount[]): QpaySeedCashAccount | null {
  const candidates = accounts.filter(
    (a) => a.isActive && a.currency === "MNT" && a.accountType === "bank" && /qpay/i.test(a.name)
  );
  return candidates.find((a) => a.name === QPAY_CLEARING_ACCOUNT_NAME) ?? candidates[0] ?? null;
}

export function planQpaySeed(input: { methods: QpaySeedMethod[]; cashAccounts: QpaySeedCashAccount[] }): QpaySeedPlan {
  const notes: string[] = [];
  const qpayMethods = input.methods.filter((m) => m.provider === QPAY_PROVIDER);
  // Идэвхтэй ewallet QPay хэлбэрийг түрүүлж, дараа нь идэвхгүйг (дахин асаана).
  const method =
    qpayMethods.find((m) => m.kind === "ewallet" && m.isActive) ??
    qpayMethods.find((m) => m.kind === "ewallet") ??
    null;
  const account = pickQpayClearingAccount(input.cashAccounts);
  const createAccount = account ? null : { name: QPAY_CLEARING_ACCOUNT_NAME, glAccountNumber: QPAY_CLEARING_GL_ACCOUNT };
  if (createAccount) notes.push(`«${QPAY_CLEARING_ACCOUNT_NAME}» (банк, GL ${QPAY_CLEARING_GL_ACCOUNT}) үүсэв`);

  if (!method) {
    const codeTaken = input.methods.some((m) => m.code === QPAY_METHOD_CODE);
    notes.push(`«${QPAY_METHOD_NAME}» төлбөрийн хэлбэр (ewallet, провайдер QPay) үүсэв`);
    return {
      createAccount,
      createMethod: {
        code: codeTaken ? `${QPAY_METHOD_CODE}-${Date.now().toString(36).toUpperCase().slice(-4)}` : QPAY_METHOD_CODE,
        name: QPAY_METHOD_NAME,
        cashAccountId: account?.id ?? null,
        ebarimtCode: QPAY_EBARIMT_CODE,
      },
      updateMethod: null,
      notes,
    };
  }

  const update: QpaySeedPlan["updateMethod"] = { id: method.id };
  let changed = false;
  if (!method.cashAccountId) {
    update.cashAccountId = account?.id ?? null;
    changed = true;
    notes.push("QPay хэлбэрт түр данс оноов");
  } else if (createAccount) {
    // Хэлбэр аль хэдийн данстай — шинэ данс хэрэггүй.
    notes.pop();
    return { createAccount: null, createMethod: null, updateMethod: null, notes };
  }
  if (!method.isActive) {
    update.isActive = true;
    changed = true;
    notes.push("QPay хэлбэр дахин идэвхжив");
  }
  if (method.ebarimtCode !== undefined && !method.ebarimtCode?.trim()) {
    // Хэрэглэгчийн оноосон кодыг ХӨНДӨХГҮЙ — зөвхөн хоосныг албан кодоор нөхнө.
    update.ebarimtCode = QPAY_EBARIMT_CODE;
    changed = true;
    notes.push(`QPay хэлбэрт eBarimt код ${QPAY_EBARIMT_CODE} оноов`);
  }
  return { createAccount: changed && !method.cashAccountId ? createAccount : null, createMethod: null, updateMethod: changed ? update : null, notes };
}
