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

// ── Ажилтны бүртгэл (цалин) ─────────────────────────────────────────────────

export interface EmployeeImport {
  name: string;
  lastName?: string;
  registerNo?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  homeAddress?: string;
  bankName?: string;
  bankAccountNo?: string;
  iban?: string;
  hireDate?: string;
  terminationDate?: string;
  department?: string;
  employmentType?: "primary" | "contract" | "hourly";
  position?: string;
  baseSalary: number;
  employerSiPercent: number;
  isActive?: boolean;
}

const EMPLOYMENT_TYPE_LABELS: Record<string, "primary" | "contract" | "hourly"> = {
  "үндсэн": "primary",
  "гэрээт": "contract",
  "цагийн": "hourly",
  primary: "primary",
  contract: "contract",
  hourly: "hourly",
};

export const employmentTypeLabelOf = (
  value: string
): "Үндсэн" | "Гэрээт" | "Цагийн" =>
  value === "contract" ? "Гэрээт" : value === "hourly" ? "Цагийн" : "Үндсэн";

/** Ажилтны импорт — РД таарвал байгаа ажилтныг шинэчилнэ (round-trip). */
export function employeesSpec(): ImportSpec<EmployeeImport> {
  return {
    slug: "entry-employees",
    title: "Ажилтны бүртгэл — РД таарвал байгаа ажилтныг шинэчилнэ",
    columns: [
      { key: "lastName", header: "Овог", hint: "Ажилтны овог", example: "Бат" },
      { key: "name", header: "Нэр", required: true, hint: "Ажилтны нэр", example: "Дорж" },
      {
        key: "registerNo",
        header: "Регистр",
        hint: "Байгууллага дотор давхцахгүй; өгвөл байгаа ажилтныг шинэчилнэ",
        example: "УК88010101",
      },
      { key: "position", header: "Албан тушаал", hint: "Сонголтоор", example: "Нягтлан бодогч" },
      { key: "department", header: "Хэлтэс", hint: "Сонголтоор", example: "Санхүү" },
      {
        key: "employmentType",
        header: "Ажил эрхлэлт",
        hint: "Үндсэн / Гэрээт / Цагийн (хоосон бол Үндсэн)",
        example: "Үндсэн",
      },
      {
        key: "hireDate",
        header: "Ажилд орсон",
        hint: "YYYY-MM-DD — ажилласан жил үүнээс автоматаар бодогдоно",
        example: "2022-03-01",
      },
      {
        key: "baseSalary",
        header: "Үндсэн цалин",
        required: true,
        hint: "Сарын үндсэн цалин ₮ (0-ээс багагүй)",
        example: "1500000",
      },
      {
        key: "employerSiPercent",
        header: "АО-НДШ %",
        hint: "Ажил олгогчийн нийт НДШ, ҮОМШӨ багтсан: оффис 12.5 · барилга 13.2 · уул уурхай 14.2–14.7 (хоосон бол 12.5)",
        example: "12.5",
      },
      { key: "bankName", header: "Банк", hint: "Цалин олгох банк", example: "Хаан банк" },
      { key: "bankAccountNo", header: "Дансны дугаар", hint: "Цалингийн данс", example: "5041234567" },
      {
        key: "iban",
        header: "IBAN",
        hint: "MN-ээр эхэлсэн 20 тэмдэгт (сонголтоор)",
        example: "MN580005005041234567",
      },
      { key: "phone", header: "Утас", hint: "Холбогдох утас", example: "99112233" },
      { key: "email", header: "И-мэйл", hint: "Сонголтоор", example: "dorj@company.mn" },
      { key: "homeAddress", header: "Гэрийн хаяг", hint: "Сонголтоор", example: "БЗД, 26-р хороо ..." },
      { key: "birthDate", header: "Төрсөн огноо", hint: "YYYY-MM-DD", example: "1988-01-01" },
      {
        key: "isActive",
        header: "Идэвхтэй",
        hint: "Тийм / Үгүй (хоосон бол Тийм)",
        example: "Тийм",
      },
    ],
    parseRow: (record) => {
      const errors: string[] = [];
      const name = record.name.trim();
      if (!name) errors.push("Нэр хоосон байна");

      const baseSalary = parseAmountCell(record.baseSalary);
      if (baseSalary == null || !(baseSalary >= 0))
        errors.push("Үндсэн цалин 0-ээс багагүй тоо байна");

      let employerSiPercent = 12.5;
      if (record.employerSiPercent.trim() !== "") {
        const parsed = Number(record.employerSiPercent.replaceAll(",", "."));
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 20)
          errors.push("АО-НДШ хувь 0–20%-ийн хооронд байна");
        else employerSiPercent = parsed;
      }

      const parseOptionalDate = (raw: string, label: string) => {
        if (raw.trim() === "") return undefined;
        const parsed = parseDateCell(raw);
        if (!parsed) {
          errors.push(`${label} буруу огноотой байна (YYYY-MM-DD)`);
          return undefined;
        }
        return parsed;
      };
      const hireDate = parseOptionalDate(record.hireDate, "Ажилд орсон");
      const birthDate = parseOptionalDate(record.birthDate, "Төрсөн огноо");

      let employmentType: "primary" | "contract" | "hourly" | undefined;
      const employmentRaw = record.employmentType.trim().toLowerCase();
      if (employmentRaw !== "") {
        employmentType = EMPLOYMENT_TYPE_LABELS[employmentRaw];
        if (!employmentType)
          errors.push("Ажил эрхлэлт нь Үндсэн / Гэрээт / Цагийн байна");
      }

      const activeRaw = record.isActive.trim().toLowerCase();
      const isActive =
        activeRaw === "" ||
        ["тийм", "yes", "true", "1", "идэвхтэй"].includes(activeRaw);

      if (errors.length > 0) return { errors };
      return {
        value: {
          name,
          lastName: record.lastName.trim() || undefined,
          registerNo: record.registerNo.trim() || undefined,
          birthDate,
          phone: record.phone.trim() || undefined,
          email: record.email.trim() || undefined,
          homeAddress: record.homeAddress.trim() || undefined,
          bankName: record.bankName.trim() || undefined,
          bankAccountNo: record.bankAccountNo.trim() || undefined,
          iban: record.iban.trim() || undefined,
          hireDate,
          department: record.department.trim() || undefined,
          employmentType,
          position: record.position.trim() || undefined,
          baseSalary: baseSalary as number,
          employerSiPercent,
          isActive,
        },
      };
    },
  };
}
