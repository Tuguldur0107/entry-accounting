// Баримтын цонхны АЛХМУУД (кассын «Алхамаар хэвлэх» горим) — ЦЭВЭР, client-safe
// (tests/pos-receipt-steps.test.ts). ① Борлуулалт батлагдсан → ② eBarimt ТЕГ-д
// олгогдсон (эсвэл олгохгүй) → ③ Хэвлэх. Хэвлэх алхам eBarimt-ийн алхам
// шийдэгдсэний (амжсан / олгохгүй) ДАРАА л идэвхжинэ — сугалаа, QR нэг л удаа
// хэвлэгддэг тул eBarimt-гүй хэвлэлт нь ил баталгаажуулалттай (receipt-preview).

export type ReceiptStepState = "done" | "active" | "error" | "skipped" | "waiting";

export interface ReceiptStep {
  key: "sale" | "ebarimt" | "print";
  label: string;
  state: ReceiptStepState;
  /** Дэлгэцэнд л — ДДТД, сугалаа, алдааны шалтгаан г.м. */
  detail: string | null;
}

export interface ReceiptStepInput {
  documentNo: string;
  ebarimtStatus: string | null;
  ebarimtId: string | null;
  ebarimtLottery: string | null;
  ebarimtError: string | null;
  /** «Дахин илгээх» явж байна. */
  sending: boolean;
  /** Browser горим: кассын PC-ийн PosAPI-ийн хариуг хүлээж байна. */
  waitingForBrowser: boolean;
  printed: boolean;
}

function ebarimtStep(input: ReceiptStepInput): ReceiptStep {
  const base = { key: "ebarimt" as const, label: "eBarimt" };
  switch (input.ebarimtStatus) {
    case "sent":
      return {
        ...base,
        label: "eBarimt олгогдсон",
        state: "done",
        detail: [input.ebarimtId && `ДДТД ${input.ebarimtId}`, input.ebarimtLottery && `Сугалаа ${input.ebarimtLottery}`]
          .filter(Boolean)
          .join(" · ") || null,
      };
    case "manual":
      return { ...base, label: "eBarimt (гараар)", state: "done", detail: input.ebarimtId ? `ДДТД ${input.ebarimtId}` : null };
    case "skipped":
      return { ...base, label: "eBarimt олгохгүй", state: "skipped", detail: "Кассчин энэ борлуулалтад илгээхгүй гэж сонгосон" };
    case "cancelled":
      return { ...base, label: "eBarimt цуцлагдсан", state: "skipped", detail: input.ebarimtId ? `ДДТД ${input.ebarimtId}` : null };
    case "pending":
    case "failed":
      if (input.sending) return { ...base, label: "eBarimt илгээж байна…", state: "active", detail: null };
      if (input.waitingForBrowser && input.ebarimtStatus === "pending" && !input.ebarimtError)
        return { ...base, label: "eBarimt илгээж байна…", state: "active", detail: "Кассын PosAPI-ийн хариуг хүлээж байна" };
      return {
        ...base,
        label: "eBarimt олгогдоогүй",
        state: "error",
        detail: input.ebarimtError ?? "ТЕГ-ийн хариу хугацаандаа ирсэнгүй — «Дахин илгээх» дарна уу",
      };
    default:
      // null — eBarimt унтраалттай эсвэл НӨАТ-гүй борлуулалт.
      return { ...base, label: "eBarimt олгохгүй", state: "skipped", detail: "eBarimt унтраалттай эсвэл НӨАТ-гүй борлуулалт" };
  }
}

export function receiptSteps(input: ReceiptStepInput): ReceiptStep[] {
  const ebarimt = ebarimtStep(input);
  const ebarimtResolved = ebarimt.state === "done" || ebarimt.state === "skipped";
  return [
    { key: "sale", label: "Борлуулалт батлагдсан", state: "done", detail: input.documentNo },
    ebarimt,
    {
      key: "print",
      label: input.printed ? "Хэвлэсэн" : "Хэвлэх",
      state: input.printed ? "done" : ebarimtResolved ? "active" : "waiting",
      detail: null,
    },
  ];
}
