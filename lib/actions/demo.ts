"use server";

// П20 — Демо компани: бодит Монгол жишээ дататай (худалдааны компани,
// 2 сарын гүйлгээ, НӨАТ, цалин) тусдаа байгууллага үүсгэнэ. Шинэ хэрэглэгч
// өөрийн дата оруулахаас өмнө аюулгүй туршина (QBO test drive загвар).
//
// Бүх бичилт AI/MCP-тэй ИЖИЛ tool давхаргаар (lib/ai/tools.ts) ордог тул
// validation, НӨАТ задаргаа, settlement холбоос, idempotency бүгд системийн
// жинхэнэ урсгалаараа явна — гараар DB insert байхгүй. сеед амжилтгүй бол
// демо байгууллага бүхэлдээ устаж (cascade) цэвэр үлдэнэ.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { actionError, type ActionResult } from "@/lib/action-result";
import { executeAiTool } from "@/lib/ai/tools";
import { auth, createPersonalOrg, runAsOrg } from "@/lib/auth";
import { syncStandardAccounts } from "@/lib/actions/gl";
import { db } from "@/lib/db";
import { memberships, organizations } from "@/lib/db/schema";

// "use server" файл зөвхөн async функц export хийнэ — нэр нь локал const.
const DEMO_ORG_NAME = "Демо худалдааны компани";
const ORG_COOKIE = "ea-org";

/** Tool-ийн үр дүн алдаа мөн үү — executeAiTool алдааг текстээр буцаадаг. */
function toolError(resultText: string): string | null {
  if (resultText.startsWith("Алдаа")) return resultText;
  const coded = resultText.match(/^\[[A-Z_]+\]/);
  if (coded) return resultText;
  return null;
}

function monthCode(offset: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1));
  return d.toISOString().slice(0, 7);
}

export async function createDemoCompany(): Promise<
  ActionResult<{ orgId: string; existed?: boolean }>
> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return { error: "Нэвтрэх шаардлагатай" };

    // Idempotent: демо орг аль хэдийн байвал зөвхөн шилжинэ.
    const mine = await db
      .select({ orgId: memberships.organizationId, name: organizations.name })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId)
      )
      .where(
        and(eq(memberships.userId, userId), eq(organizations.name, DEMO_ORG_NAME))
      );
    if (mine.length > 0) {
      await activateOrg(mine[0].orgId);
      return { orgId: mine[0].orgId, existed: true };
    }

    const orgId = await createPersonalOrg(userId, DEMO_ORG_NAME);
    await db
      .update(organizations)
      .set({ registryNo: "9911223" })
      .where(eq(organizations.id, orgId));

    try {
      await runAsOrg({ userId, orgId }, () => seedDemoData(userId));
    } catch (seedError) {
      // Хагас дутуу демо үлдээхгүй — cascade бүх датаг нь устгана.
      await db.delete(organizations).where(eq(organizations.id, orgId));
      throw seedError;
    }

    await activateOrg(orgId);
    return { orgId };
  } catch (caught) {
    return actionError(
      "createDemoCompany",
      caught,
      "Демо компани үүсгэж чадсангүй"
    );
  }
}

async function activateOrg(orgId: string) {
  (await cookies()).set(ORG_COOKIE, orgId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}

/** Tool дуудаад алдаа бол шидэх — seed-ийн алхам бүр заавал амжилттай. */
async function tool(
  userId: string,
  name: string,
  input: unknown,
  mode: "draft" | "post" = "post"
) {
  const result = await executeAiTool(userId, name, input, mode);
  const failed = toolError(result.resultText);
  if (failed) throw new Error(`Демо сеед (${name}): ${failed}`);
  return result;
}

async function seedDemoData(userId: string): Promise<void> {
  // Сүүлийн 2 бүтэн сар — бүртгэлгүй сар нээлттэй тул хаалтад саадгүй.
  const A = monthCode(-2);
  const B = monthCode(-1);

  const accountsResult = await syncStandardAccounts();
  if (accountsResult.error)
    throw new Error(`Демо сеед (данс): ${accountsResult.error}`);

  // Мөнгөн хөрөнгийн дансууд
  await tool(userId, "create_cash_account", {
    name: "Касс",
    accountType: "cash",
    glAccount: "10000001",
  });
  await tool(userId, "create_cash_account", {
    name: "Голомт банк",
    accountType: "bank",
    bankName: "Голомт",
    accountNumber: "1105001122",
    glAccount: "11000001",
  });

  // Харилцагчид (зохиомол нэрс)
  await tool(userId, "create_counterparties_batch", {
    items: [
      { name: "Мөнх Трейд ХХК", counterpartyType: "customer", registerNo: "6183352" },
      { name: "Хангай Маркет ХХК", counterpartyType: "customer", registerNo: "5527419" },
      { name: "Түмэн Импекс ХХК", counterpartyType: "supplier", registerNo: "2074818" },
      { name: "Оффис Плюс ХХК", counterpartyType: "supplier", registerNo: "6641937" },
      { name: "Цахилгаан Түгээх ХХК", counterpartyType: "supplier", registerNo: "2550466" },
    ],
  });

  // Эздийн өмчийн оруулалт — кассын модуль болон GL нэг дүнтэй эхэлнэ
  await tool(userId, "create_cash_transaction", {
    documentType: "receipt",
    date: `${A}-01`,
    cashAccount: "Голомт банк",
    counterAccount: "41000001",
    amount: 5_000_000,
    description: "Эздийн өмчийн мөнгөн оруулалт",
  });
  await tool(userId, "create_cash_transaction", {
    documentType: "receipt",
    date: `${A}-01`,
    cashAccount: "Касс",
    counterAccount: "41000001",
    amount: 500_000,
    description: "Эздийн өмчийн мөнгөн оруулалт (касс)",
  });

  // Борлуулалт (АР, НӨАТ 10% exclusive)
  const inv1 = await tool(userId, "create_arap_invoice", {
    documentType: "ar_invoice",
    counterparty: "Мөнх Трейд ХХК",
    date: `${A}-10`,
    description: "Барааны борлуулалт",
    vatMode: "exclusive",
    lines: [
      { account: "51100000", description: "Барааны борлуулалт", amount: 2_200_000 },
    ],
  });
  const inv2 = await tool(userId, "create_arap_invoice", {
    documentType: "ar_invoice",
    counterparty: "Хангай Маркет ХХК",
    date: `${B}-05`,
    description: "Бөөний борлуулалт",
    vatMode: "exclusive",
    lines: [
      { account: "51100000", description: "Бөөний борлуулалт", amount: 3_300_000 },
    ],
  });
  await tool(userId, "create_arap_invoice", {
    documentType: "ar_invoice",
    counterparty: "Мөнх Трейд ХХК",
    date: `${B}-20`,
    description: "Барааны борлуулалт (нээлттэй)",
    vatMode: "exclusive",
    lines: [
      { account: "51100000", description: "Барааны борлуулалт", amount: 1_650_000 },
    ],
  });

  // Худалдан авалт (АП)
  const bill1 = await tool(userId, "create_arap_invoice", {
    documentType: "ap_bill",
    counterparty: "Түмэн Импекс ХХК",
    date: `${A}-08`,
    description: "Барааны худалдан авалт",
    vatMode: "exclusive",
    lines: [
      { account: "61100000", description: "Барааны худалдан авалт", amount: 1_800_000 },
    ],
  });
  await tool(userId, "create_arap_invoice", {
    documentType: "ap_bill",
    counterparty: "Оффис Плюс ХХК",
    date: `${B}-03`,
    description: "Оффисын түрээс",
    lines: [
      { account: "73100001", description: "Оффисын түрээс", amount: 450_000 },
    ],
  });
  const bill3 = await tool(userId, "create_arap_invoice", {
    documentType: "ap_bill",
    counterparty: "Цахилгаан Түгээх ХХК",
    date: `${B}-15`,
    description: "Цахилгааны төлбөр",
    lines: [
      { account: "73100001", description: "Цахилгааны төлбөр", amount: 145_000 },
    ],
  });

  // Төлөлтүүд — нэхэмжлэхтэй холбогдож settlement үүснэ
  if (inv1.action?.id)
    await tool(userId, "create_cash_transaction", {
      documentType: "receipt",
      date: `${A}-15`,
      cashAccount: "Голомт банк",
      counterAccount: "13110000",
      amount: 2_420_000,
      description: "Мөнх Трейд — нэхэмжлэхийн төлбөр",
      counterparty: "Мөнх Трейд ХХК",
      applyTo: [{ documentId: inv1.action.id, amount: 2_420_000 }],
    });
  if (inv2.action?.id)
    await tool(userId, "create_cash_transaction", {
      documentType: "receipt",
      date: `${B}-12`,
      cashAccount: "Голомт банк",
      counterAccount: "13110000",
      amount: 2_000_000,
      description: "Хангай Маркет — хэсэгчилсэн төлбөр",
      counterparty: "Хангай Маркет ХХК",
      applyTo: [{ documentId: inv2.action.id, amount: 2_000_000 }],
    });
  if (bill1.action?.id)
    await tool(userId, "create_cash_transaction", {
      documentType: "payment",
      date: `${A}-20`,
      cashAccount: "Голомт банк",
      counterAccount: "31000001",
      amount: 1_980_000,
      description: "Түмэн Импекс — нэхэмжлэхийн төлбөр",
      counterparty: "Түмэн Импекс ХХК",
      applyTo: [{ documentId: bill1.action.id, amount: 1_980_000 }],
    });
  if (bill3.action?.id)
    await tool(userId, "create_cash_transaction", {
      documentType: "payment",
      date: `${B}-18`,
      cashAccount: "Голомт банк",
      counterAccount: "31000001",
      amount: 145_000,
      description: "Цахилгааны төлбөр",
      counterparty: "Цахилгаан Түгээх ХХК",
      applyTo: [{ documentId: bill3.action.id, amount: 145_000 }],
    });

  // Цалин — бодолт + GL НООРОГ журнал (human-in-the-loop §9 үзүүлнэ)
  await tool(userId, "create_employee", {
    name: "Б.Болд",
    position: "Борлуулалтын менежер",
    baseSalary: 2_500_000,
  });
  await tool(userId, "create_employee", {
    name: "Д.Сараа",
    position: "Нягтлан бодогч",
    baseSalary: 1_800_000,
  });
  await tool(userId, "run_payroll", { period: B });
  await tool(userId, "create_payroll_voucher", { period: B });
}
