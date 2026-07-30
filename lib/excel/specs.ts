// Импортын СПЕКҮҮД — цэвэр үйлдвэрүүд (контекстоо параметрээр авдаг,
// DB/DOM хамааралгүй, тесттэй).
//
// Данс: үндсэн 8 оронтой данс ЭСВЭЛ бүтэн цэгтэй сегмент код хүлээнэ;
// идэвхтэй жагсаалтад байгааг шалгаад default сегментүүдтэй бүтэн код
// болгож normalize хийнэ (сегментийн гэрээ — CLAUDE.md).

import { normalizePastedAccount, parseSegParts } from "@/lib/grid/segments";
import {
  parseAmountCell,
  parseDateCell,
  type ImportSpec,
} from "./import-spec";

export interface AccountContext {
  /** Идэвхтэй үндсэн данснууд (number → name). */
  accountsByMain: Map<string, string>;
  activeSegIds: number[];
  defaultSegments: Record<number, string>;
}

/**
 * Дансны нүд — paste-ийн урсгалтай ИЖИЛ normalize (normalizePastedAccount):
 * бүтэн 10-part код, active-only N-part код, эсвэл ганц 8 оронтой үндсэн
 * данс аль нь ч болно. Дараа нь үндсэн данс (сегмент 3) идэвхтэй
 * жагсаалтад байгааг шалгана.
 */
function parseAccountCell(
  raw: string,
  context: AccountContext
): { code: string } | { error: string } {
  if (!raw.trim()) return { error: "Данс хоосон байна" };
  const code = normalizePastedAccount(
    raw,
    context.activeSegIds,
    context.defaultSegments
  );
  const main = parseSegParts(code, [3])[3] ?? "";
  if (!context.accountsByMain.has(main))
    return { error: `"${raw.trim()}" данс идэвхтэй жагсаалтад алга` };
  return { code };
}

// ── 1. Журналын мөрүүд (нэг журналд олон мөр нэмэх) ─────────────────────────

export interface JournalLineImport {
  account: string;
  debit: number;
  credit: number;
  description: string;
}

export function journalLinesSpec(
  context: AccountContext
): ImportSpec<JournalLineImport> {
  return {
    slug: "entry-journal-lines",
    title: "Журналын мөрүүд — нээлттэй журналд нэмэгдэнэ",
    columns: [
      {
        key: "account",
        header: "Данс",
        required: true,
        hint: "Үндсэн данс (жишээ нь 11000001) эсвэл бүтэн сегмент код",
        example: "11000001",
      },
      {
        key: "debit",
        header: "Дебет",
        hint: "Дебет дүн — Кредиттэй зэрэг бөглөхгүй",
        example: "1500000",
      },
      {
        key: "credit",
        header: "Кредит",
        hint: "Кредит дүн — Дебеттэй зэрэг бөглөхгүй",
        example: "",
      },
      {
        key: "description",
        header: "Тайлбар",
        hint: "Мөрийн тайлбар (сонголтоор)",
        example: "Түрээсийн төлбөр",
      },
    ],
    parseRow: (record) => {
      const errors: string[] = [];
      const account = parseAccountCell(record.account, context);
      if ("error" in account) errors.push(account.error);

      const debit = parseAmountCell(record.debit);
      const credit = parseAmountCell(record.credit);
      if (debit === undefined) errors.push("Дебет дүн уншигдахгүй байна");
      if (credit === undefined) errors.push("Кредит дүн уншигдахгүй байна");
      const debitValue = debit === undefined ? 0 : (debit ?? 0);
      const creditValue = credit === undefined ? 0 : (credit ?? 0);
      if (debitValue < 0 || creditValue < 0)
        errors.push("Дүн сөрөг байж болохгүй");
      if (debitValue > 0 && creditValue > 0)
        errors.push("Нэг мөрөнд Дебет, Кредит зэрэг байж болохгүй");
      if (debitValue === 0 && creditValue === 0)
        errors.push("Дебет эсвэл Кредит дүн шаардлагатай");

      if (errors.length > 0) return { errors };
      return {
        value: {
          account: (account as { code: string }).code,
          debit: debitValue,
          credit: creditValue,
          description: record.description,
        },
      };
    },
  };
}

// ── 2. АР/АП баримтын мөрүүд ────────────────────────────────────────────────

export interface ArapLineContext extends AccountContext {
  /** code → {id, name} — бараа. */
  itemsByCode: Map<string, { id: string; name: string }>;
  /** code → {id, name} — агуулах. */
  warehousesByCode: Map<string, { id: string; name: string }>;
}

export interface ArapLineImport {
  account: string;
  description: string;
  amount: number;
  itemId: string | null;
  quantity: number | null;
  warehouseId: string | null;
}

export function arapLinesSpec(
  context: ArapLineContext
): ImportSpec<ArapLineImport> {
  return {
    slug: "entry-arap-lines",
    title: "АР/АП баримтын мөрүүд — нээлттэй баримтад нэмэгдэнэ",
    columns: [
      {
        key: "account",
        header: "Данс",
        required: true,
        hint: "Мөрийн данс. АП-ийн бараатай мөр клирингийн дансанд суана",
        example: "14000099",
      },
      {
        key: "amount",
        header: "Дүн",
        required: true,
        hint: "Мөрийн дүн (0-ээс их)",
        example: "2500000",
      },
      {
        key: "description",
        header: "Тайлбар",
        hint: "Мөрийн тайлбар (сонголтоор)",
        example: "Бараа материал",
      },
      {
        key: "itemCode",
        header: "Барааны код",
        hint: "Бараатай мөрөнд — барааны бүртгэлийн код",
        example: "ITEM-001",
      },
      {
        key: "quantity",
        header: "Тоо",
        hint: "Бараатай мөрөнд заавал (0-ээс их)",
        example: "100",
      },
      {
        key: "warehouseCode",
        header: "Агуулахын код",
        hint: "Бараатай мөрөнд — хүлээн авах агуулахын код",
        example: "WH-01",
      },
    ],
    parseRow: (record) => {
      const errors: string[] = [];
      const account = parseAccountCell(record.account, context);
      if ("error" in account) errors.push(account.error);

      const amount = parseAmountCell(record.amount);
      if (amount === undefined || amount === null)
        errors.push("Дүн шаардлагатай");
      else if (!(amount > 0)) errors.push("Дүн 0-ээс их байна");

      let itemId: string | null = null;
      let quantity: number | null = null;
      let warehouseId: string | null = null;
      if (record.itemCode) {
        const item = context.itemsByCode.get(record.itemCode);
        if (!item) errors.push(`"${record.itemCode}" бараа бүртгэлд алга`);
        else itemId = item.id;

        const parsedQty = parseAmountCell(record.quantity);
        if (parsedQty === undefined || parsedQty === null || !(parsedQty > 0))
          errors.push("Бараатай мөрөнд Тоо (0-ээс их) шаардлагатай");
        else quantity = parsedQty;

        if (record.warehouseCode) {
          const warehouse = context.warehousesByCode.get(record.warehouseCode);
          if (!warehouse)
            errors.push(`"${record.warehouseCode}" агуулах бүртгэлд алга`);
          else warehouseId = warehouse.id;
        } else errors.push("Бараатай мөрөнд Агуулахын код шаардлагатай");
      }

      if (errors.length > 0) return { errors };
      return {
        value: {
          account: (account as { code: string }).code,
          description: record.description,
          amount: amount as number,
          itemId,
          quantity,
          warehouseId,
        },
      };
    },
  };
}

// ── 3. Олон журнал багцаар (ноорог болж үүснэ) ──────────────────────────────

export interface VoucherRowImport {
  voucherKey: string;
  date: string;
  voucherDescription: string;
  account: string;
  debit: number;
  credit: number;
  lineDescription: string;
}

export function journalVouchersSpec(
  context: AccountContext
): ImportSpec<VoucherRowImport> {
  const lineSpec = journalLinesSpec(context);
  return {
    slug: "entry-journal-vouchers",
    title:
      "Олон журнал багцаар — 'Баримт №' ижил мөрүүд нэг журнал болж НООРОГ үүснэ",
    columns: [
      {
        key: "voucherKey",
        header: "Баримт №",
        required: true,
        hint: "Нэг журналын мөрүүдийг бүлэглэх түлхүүр (жишээ нь JE-001)",
        example: "JE-001",
      },
      {
        key: "date",
        header: "Огноо",
        required: true,
        hint: "YYYY-MM-DD (нэг баримтын бүх мөрөнд ижил)",
        example: "2026-07-15",
      },
      {
        key: "voucherDescription",
        header: "Гүйлгээний утга",
        hint: "Журналын ерөнхий утга (баримтын эхний мөрөөс уншина)",
        example: "7 сарын түрээс",
      },
      ...lineSpec.columns.map((column) =>
        column.key === "description"
          ? { ...column, header: "Мөрийн тайлбар" }
          : column
      ),
    ],
    parseRow: (record) => {
      const errors: string[] = [];
      if (!record.voucherKey) errors.push("Баримт № хоосон байна");
      const date = parseDateCell(record.date);
      if (!date) errors.push("Огноо буруу байна (YYYY-MM-DD)");

      const line = lineSpec.parseRow(record);
      if ("errors" in line) errors.push(...line.errors);

      if (errors.length > 0) return { errors };
      const lineValue = (line as { value: JournalLineImport }).value;
      return {
        value: {
          voucherKey: record.voucherKey,
          date: date!,
          voucherDescription: record.voucherDescription,
          account: lineValue.account,
          debit: lineValue.debit,
          credit: lineValue.credit,
          lineDescription: lineValue.description,
        },
      };
    },
  };
}

export interface GroupedVoucher {
  voucherKey: string;
  date: string;
  description: string;
  lines: { account: string; debit: number; credit: number; description: string }[];
  errors: string[];
}

/**
 * Зөв мөрүүдийг журнал болгож бүлэглэнэ. Баримт доторх зөрчил (олон огноо,
 * 2-оос цөөн мөр) баримтын түвшний алдаа болно.
 */
export function groupVoucherRows(rows: VoucherRowImport[]): GroupedVoucher[] {
  const byKey = new Map<string, VoucherRowImport[]>();
  for (const row of rows) {
    const list = byKey.get(row.voucherKey);
    if (list) list.push(row);
    else byKey.set(row.voucherKey, [row]);
  }

  return [...byKey.entries()].map(([voucherKey, group]) => {
    const errors: string[] = [];
    const dates = [...new Set(group.map((row) => row.date))];
    if (dates.length > 1)
      errors.push(`Нэг баримтад ${dates.length} өөр огноо байна`);
    if (group.length < 2) errors.push("Журналд дор хаяж 2 мөр хэрэгтэй");

    return {
      voucherKey,
      date: dates[0],
      description:
        group.find((row) => row.voucherDescription)?.voucherDescription ??
        voucherKey,
      lines: group.map((row) => ({
        account: row.account,
        debit: row.debit,
        credit: row.credit,
        description: row.lineDescription,
      })),
      errors,
    };
  });
}
