"use server";

// П8 — Банкны хуулгын дүрмийн CRUD. Дүрэм нь ЗӨВХӨН импортын мөрийг
// бөглөдөг (баримт үүсгэдэггүй) тул устгах/засахад бизнесийн урсгалд
// нөлөөгүй. Хүлээгдэх алдаа бүр { error } УТГААР буцна (lib/action-result.ts).

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth";
import { actionError, type ActionResult } from "@/lib/action-result";
import type {
  BankRule,
  BankRuleMode,
  BankRuleSide,
} from "@/lib/cash/bank-rules";
import { db } from "@/lib/db";
import { bankRules } from "@/lib/db/schema";

export type BankRuleInput = {
  name: string;
  matchText: string;
  side: BankRuleSide;
  minAmount: number | null;
  maxAmount: number | null;
  counterAccountNumber: string;
  setCounterparty: string | null;
  setDescription: string | null;
  mode: BankRuleMode;
  priority: number;
  isActive: boolean;
};

const SIDES: BankRuleSide[] = ["income", "expense", "any"];
const MODES: BankRuleMode[] = ["suggest", "auto"];

function cleanOptional(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

type RuleValues = Omit<
  typeof bankRules.$inferInsert,
  "id" | "userId" | "organizationId" | "createdAt"
>;

/** Оролтыг шалгаж DB-ийн insert/update утга болгоно; алдаанд текст буцна. */
function validateInput(
  data: BankRuleInput
): { error: string } | { values: RuleValues } {
  const name = data.name.trim();
  if (!name) return { error: "Дүрмийн нэр оруулна уу" };
  const matchText = data.matchText.trim();
  if (!matchText) return { error: "Таарах текст оруулна уу" };
  if (!SIDES.includes(data.side)) return { error: "Чиглэл буруу байна" };
  if (!MODES.includes(data.mode)) return { error: "Горим буруу байна" };
  const counterAccountNumber = data.counterAccountNumber.trim();
  if (!counterAccountNumber)
    return { error: "Харьцах данс сонгоно уу" };
  const minAmount = data.minAmount;
  const maxAmount = data.maxAmount;
  for (const amount of [minAmount, maxAmount])
    if (amount != null && (!Number.isFinite(amount) || amount < 0))
      return { error: "Дүнгийн хязгаар буруу байна" };
  if (minAmount != null && maxAmount != null && minAmount > maxAmount)
    return { error: "Доод дүн дээд дүнгээс их байж болохгүй" };
  const priority = Math.trunc(Number(data.priority));
  if (!Number.isFinite(priority))
    return { error: "Эрэмбэ бүхэл тоо байна" };
  return {
    values: {
      name,
      matchText,
      side: data.side,
      minAmount: minAmount == null ? null : String(minAmount),
      maxAmount: maxAmount == null ? null : String(maxAmount),
      counterAccountNumber,
      setCounterparty: cleanOptional(data.setCounterparty),
      setDescription: cleanOptional(data.setDescription),
      mode: data.mode,
      priority,
      isActive: data.isActive,
    },
  };
}

function toBankRule(row: typeof bankRules.$inferSelect): BankRule {
  return {
    id: row.id,
    name: row.name,
    matchText: row.matchText,
    side: row.side as BankRuleSide,
    minAmount: row.minAmount == null ? null : Number(row.minAmount),
    maxAmount: row.maxAmount == null ? null : Number(row.maxAmount),
    counterAccountNumber: row.counterAccountNumber,
    setCounterparty: row.setCounterparty,
    setDescription: row.setDescription,
    mode: row.mode as BankRuleMode,
    priority: row.priority,
    isActive: row.isActive,
  };
}

/** Байгууллагын БҮХ дүрэм (идэвхгүйг оролцуулаад) — удирдлагын жагсаалтад. */
export async function listBankRules(): Promise<
  ActionResult<{ rules: BankRule[] }>
> {
  try {
    const { orgId } = await requireRole("accountant");
    const rows = await db.query.bankRules.findMany({
      where: eq(bankRules.organizationId, orgId),
      orderBy: [asc(bankRules.priority), asc(bankRules.name)],
    });
    return { rules: rows.map(toBankRule) };
  } catch (caught) {
    return actionError(
      "listBankRules",
      caught,
      "Дүрмийн жагсаалт ачаалж чадсангүй"
    );
  }
}

export async function createBankRule(
  data: BankRuleInput
): Promise<ActionResult<{ rule: BankRule }>> {
  try {
    const { orgId, userId } = await requireRole("accountant");
    const checked = validateInput(data);
    if ("error" in checked) return checked;
    const [row] = await db
      .insert(bankRules)
      .values({ ...checked.values, userId, organizationId: orgId })
      .returning();
    revalidatePath("/cash/statements");
    return { rule: toBankRule(row) };
  } catch (caught) {
    return actionError("createBankRule", caught, "Дүрэм үүсгэж чадсангүй");
  }
}

export async function updateBankRule(
  id: string,
  data: BankRuleInput
): Promise<ActionResult<{ rule: BankRule }>> {
  try {
    const { orgId } = await requireRole("accountant");
    const checked = validateInput(data);
    if ("error" in checked) return checked;
    const [row] = await db
      .update(bankRules)
      .set(checked.values)
      .where(
        and(eq(bankRules.id, id), eq(bankRules.organizationId, orgId))
      )
      .returning();
    if (!row) return { error: "Дүрэм олдсонгүй" };
    revalidatePath("/cash/statements");
    return { rule: toBankRule(row) };
  } catch (caught) {
    return actionError("updateBankRule", caught, "Дүрэм хадгалж чадсангүй");
  }
}

export async function toggleBankRule(
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  try {
    const { orgId } = await requireRole("accountant");
    const [row] = await db
      .update(bankRules)
      .set({ isActive })
      .where(
        and(eq(bankRules.id, id), eq(bankRules.organizationId, orgId))
      )
      .returning({ id: bankRules.id });
    if (!row) return { error: "Дүрэм олдсонгүй" };
    revalidatePath("/cash/statements");
    return {};
  } catch (caught) {
    return actionError("toggleBankRule", caught, "Дүрэм солиж чадсангүй");
  }
}

export async function deleteBankRule(id: string): Promise<ActionResult> {
  try {
    const { orgId } = await requireRole("accountant");
    const [row] = await db
      .delete(bankRules)
      .where(
        and(eq(bankRules.id, id), eq(bankRules.organizationId, orgId))
      )
      .returning({ id: bankRules.id });
    if (!row) return { error: "Дүрэм олдсонгүй" };
    revalidatePath("/cash/statements");
    return {};
  } catch (caught) {
    return actionError("deleteBankRule", caught, "Дүрэм устгаж чадсангүй");
  }
}
