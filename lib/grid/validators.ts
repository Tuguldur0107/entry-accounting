import type { CellValidator, CellValidationResult } from "./types";

const ok: CellValidationResult = { ok: true };

export const required: CellValidator = (v) =>
  v === null || v === undefined || v === ""
    ? { ok: false, errorMn: "Утга заавал бөглөнө" }
    : ok;

export const nonNegativeNumber: CellValidator = (v) => {
  if (v === "" || v == null) return ok;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return { ok: false, errorMn: "Тоо биш" };
  if (n < 0) return { ok: false, errorMn: "Сөрөг утга оруулах боломжгүй" };
  return ok;
};

export function debitXorCredit(
  row: { debit?: unknown; credit?: unknown } | undefined
): CellValidationResult {
  if (!row) return ok;
  const d = parseFloat(String(row.debit ?? "")) || 0;
  const c = parseFloat(String(row.credit ?? "")) || 0;
  if (d > 0 && c > 0) {
    return { ok: false, errorMn: "Дебет ба Кредит хоёулаа байж болохгүй" };
  }
  return ok;
}

export function segmentCodeShape(code: unknown): CellValidationResult {
  if (!code) return { ok: false, errorMn: "Данс хоосон" };
  const s = String(code);
  const parts = s.split(".");
  if (parts.length !== 10 && parts.length !== 1) {
    return { ok: false, errorMn: "Дансны код буруу хэлбэртэй" };
  }
  return ok;
}

export function accountExists(knownCodes: Set<string>): CellValidator {
  return (v) => {
    if (!v) return ok;
    const code = String(v);
    const parts = code.split(".");
    const mainAccount = parts.length === 10 ? parts[2] : code;
    if (!mainAccount || !knownCodes.has(mainAccount)) {
      return { ok: false, errorMn: "Данс олдсонгүй" };
    }
    return ok;
  };
}

export const dateISO: CellValidator = (v) => {
  if (!v) return { ok: false, errorMn: "Огноо хоосон" };
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, errorMn: "Огноо ISO биш (YYYY-MM-DD)" };
  return ok;
};

export function composeValidators(...validators: CellValidator[]): CellValidator {
  return (value, row) => {
    for (const v of validators) {
      const r = v(value, row);
      if (!r.ok) return r;
    }
    return ok;
  };
}
