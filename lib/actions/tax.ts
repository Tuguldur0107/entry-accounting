"use server";

// Татвар модулийн үйлдлүүд. Татварын тооцооны бичилт нь ЭНГИЙН GL журнал
// (createVoucher-ээр) — шалгалт (данс идэвхтэй, период нээлттэй, тэнцэл)
// нэг л газар үлдэнэ. Human-in-the-loop §9: тооцооны бичилт ЗААВАЛ ноорог
// үүснэ — нягтланч журналаас шалгаад батална.

import { createVoucher } from "@/lib/actions/gl";
import { ALL_SEG_IDS, SEG_DEFAULTS } from "@/lib/grid/segments";
import { actionError, type ActionResult } from "@/lib/action-result";

// Үндсэн данс (8 орон) → бүтэн 10 хэсэгт код. Бичигдээгүй сегмент бүр
// оронгийн тоогоор "0" default (S9="GL") — cash.ts-ийн fxPostingCode-той
// ижил fallback дүрэм.
function glPostingCode(main: string) {
  return ALL_SEG_IDS.map((id) => (id === 3 ? main : SEG_DEFAULTS[id] ?? "")).join(
    "."
  );
}

/**
 * Татварын тооцооны НООРОГ журнал: Dr {debitMain} / Cr {creditMain}.
 * Жишээ нь ААНОАТ: Dr зардал / Cr татварын өглөг. Данс идэвхтэй эсэх,
 * периодын хаалтыг createVoucher ДАХИН шалгана.
 */
export async function createTaxAccrualVoucher(data: {
  date: string;
  amount: number;
  description: string;
  debitMain: string;
  creditMain: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
      return { error: "Огноо буруу байна" };
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return { error: "Дүн 0-ээс их байна" };
    const description = data.description.trim();
    if (!description) return { error: "Гүйлгээний утга оруулна уу" };
    const debitMain = data.debitMain.trim();
    const creditMain = data.creditMain.trim();
    if (!/^\d{8}$/.test(debitMain) || !/^\d{8}$/.test(creditMain))
      return { error: "Данс 8 оронтой дугаар байна (жишээ нь 70000004)" };
    if (debitMain === creditMain)
      return { error: "Дебет, кредит данс ижил байж болохгүй" };

    return await createVoucher({
      date: data.date,
      description,
      status: "draft",
      lines: [
        {
          account: glPostingCode(debitMain),
          debit: amount,
          credit: 0,
          description,
        },
        {
          account: glPostingCode(creditMain),
          debit: 0,
          credit: amount,
          description,
        },
      ],
    });
  } catch (caught) {
    return actionError(
      "createTaxAccrualVoucher",
      caught,
      "Тооцооны бичилт үүсгэж чадсангүй"
    );
  }
}
