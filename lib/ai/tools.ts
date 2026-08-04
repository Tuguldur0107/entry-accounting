// AI туслахын TOOL давхарга — бүх модульд өгөгдөл ОРУУЛАХ болон лавлах
// хэрэгслүүд. Дүрэм (§9 human-in-the-loop):
//
//   - Бичилт үргэлж НООРОГ болж үүснэ. Хэрэглэгч "Шууд бичих" (post)
//     горимыг ил сонгосон үед л тэнцсэн, ≤10 сая ₮ бичилт шууд батлагдана.
//   - >10 сая ₮ бичилт post горимд ч НООРОГ болно (нягтланч шалгана).
//   - Гүйцэтгэгчид одоо байгаа server action-уудыг дуудна — бүх шалгалт
//     (период, данс, тэнцэл) нэг л газар байна; AI тусдаа зам гаргахгүй.
//
// Tool schema нь JSON Schema — Anthropic input_schema болон OpenAI
// function.parameters хоёуланд нь ИЖИЛ бүтцээр явна.

import { and, eq } from "drizzle-orm";

import { createArApDocument, postArApDocument } from "@/lib/actions/arap";
import {
  createCashDocument,
  deleteCashDocument,
  postCashDocument,
} from "@/lib/actions/cash";
import { createFixedAsset } from "@/lib/actions/fa";
import { createVoucher, deleteVoucher, postVoucher } from "@/lib/actions/gl";
import { createInventoryMovement } from "@/lib/actions/inventory";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import { db } from "@/lib/db";
import {
  arApDocuments,
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
  counterparties,
  inventoryIssueTypes,
  inventoryItems,
  journalVouchers,
  segmentConfigs,
  segmentValues,
  warehouses,
} from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { normalizePastedAccount, parseSegParts } from "@/lib/grid/segments";

import type { AiWriteMode } from "./models";

import type { AiAction } from "./action-markers";

/** Post горимд ч үүнээс их дүнтэй бичилт НООРОГ үлдэнэ (§9). */
export const AI_POST_LIMIT_MNT = 10_000_000;

export type { AiAction };

export interface AiToolResult {
  /** Модельд буцаах текст (tool_result). */
  resultText: string;
  /** Амжилттай үүссэн объект — чатад карт болж харагдана. */
  action?: AiAction;
}

export interface AiToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Чатад карт болгож үзүүлэх action-ий тэмдэглэгээ. Хариултын контентод
 * хадгалагддаг тул түүхээс дахин ачаалахад ч картууд харагдана; client
 * lib/ai/action-markers.ts-ээр задалж уншина.
 */
export function actionMarker(action: AiAction): string {
  return `\n[[EA_ACTION:${JSON.stringify(action)}]]\n`;
}

// ── Tool тодорхойлолтууд ────────────────────────────────────────────────────

const LINE_SCHEMA = {
  type: "object",
  properties: {
    account: {
      type: "string",
      description:
        "Дансны 8 оронтой үндсэн дугаар (жишээ нь 11000001) — идэвхтэй дансны жагсаалтаас",
    },
    debit: { type: "number", description: "Дебет дүн (₮). Кредиттэй зэрэг байж болохгүй" },
    credit: { type: "number", description: "Кредит дүн (₮). Дебеттэй зэрэг байж болохгүй" },
    description: { type: "string", description: "Мөрийн тайлбар" },
  },
  required: ["account"],
} as const;

export const AI_TOOLS: AiToolDef[] = [
  {
    name: "create_journal_voucher",
    description:
      "Ерөнхий журналын бичилт үүсгэнэ. Үргэлж ноорог болж үүсэх ба хэрэглэгч 'Шууд бичих' горим сонгосон үед тэнцсэн (ΣДт=ΣКт), 10 сая ₮-с хэтрэхгүй бичилт шууд батлагдана. Дансыг зөвхөн хэрэглэгчийн идэвхтэй дансны жагсаалтаас ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Огноо YYYY-MM-DD" },
        description: { type: "string", description: "Гүйлгээний утга" },
        lines: {
          type: "array",
          description: "Журналын мөрүүд (дор хаяж 2)",
          items: LINE_SCHEMA,
        },
      },
      required: ["date", "description", "lines"],
    },
  },
  {
    name: "create_arap_invoice",
    description:
      "Авлагын нэхэмжлэл (ar_invoice) эсвэл өглөгийн нэхэмжлэх (ap_bill) үүсгэнэ. Харилцагчийг нэрээр нь заана — олдохгүй/олон таарвал алдаа буцаана (list_counterparties-оор шалгаж болно). Бараатай мөрөнд itemCode+quantity+warehouseCode өгвөл батлагдахад бараа материалын хөдөлгөөний ноорог автоматаар үүснэ.",
    inputSchema: {
      type: "object",
      properties: {
        documentType: { type: "string", enum: ["ar_invoice", "ap_bill"] },
        counterparty: { type: "string", description: "Харилцагчийн нэр" },
        date: { type: "string", description: "Огноо YYYY-MM-DD" },
        dueDate: {
          type: "string",
          description: "Төлөх огноо YYYY-MM-DD (хоосон бол харилцагчийн нөхцөлөөр)",
        },
        description: { type: "string", description: "Баримтын утга" },
        controlAccount: {
          type: "string",
          description:
            "Хяналтын данс (авлага/өглөгийн 8 оронтой данс). Хоосон бол харилцагчийн default данс",
        },
        currency: { type: "string", description: "Валют (default: харилцагчийнх, ихэвчлэн MNT)" },
        exchangeRate: { type: "number", description: "Валют MNT биш үед ханш" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              account: {
                type: "string",
                description:
                  "Мөрийн данс (8 оронтой). АП-ийн БАРААТАЙ мөрөнд орхи — клирингийн данс автоматаар орно",
              },
              description: { type: "string" },
              amount: { type: "number", description: "Мөрийн дүн (0-ээс их)" },
              itemCode: { type: "string", description: "Барааны код (бараатай мөрөнд)" },
              quantity: { type: "number", description: "Тоо хэмжээ (бараатай мөрөнд заавал)" },
              warehouseCode: { type: "string", description: "Агуулахын код (бараатай мөрөнд заавал)" },
            },
            required: ["amount"],
          },
        },
      },
      required: ["documentType", "counterparty", "date", "description", "lines"],
    },
  },
  {
    name: "create_cash_transaction",
    description:
      "Мөнгөн хөрөнгийн орлого (receipt), зарлага (payment), шилжүүлэг (transfer) үүсгэнэ. Кассын/банкны дансыг нэрээр заана (list_cash_accounts-оор шалгаж болно). counterAccount нь харьцах GL данс (орлогод кредитлэгдэх, зарлагад дебетлэгдэх тал).",
    inputSchema: {
      type: "object",
      properties: {
        documentType: { type: "string", enum: ["receipt", "payment", "transfer"] },
        date: { type: "string", description: "Огноо YYYY-MM-DD" },
        cashAccount: {
          type: "string",
          description: "Орлогод хүлээн авах, зарлагад гаргах, шилжүүлэгт ЭХЛЭХ дансны нэр",
        },
        toCashAccount: { type: "string", description: "Шилжүүлэгт хүлээн авах дансны нэр" },
        counterAccount: {
          type: "string",
          description: "Харьцах GL данс (8 оронтой) — шилжүүлэгт хэрэггүй",
        },
        amount: { type: "number", description: "Дүн (0-ээс их)" },
        description: { type: "string", description: "Гүйлгээний утга" },
        counterparty: { type: "string", description: "Харилцагчийн нэр (сонголтоор)" },
        exchangeRate: { type: "number", description: "Валютын данс бол ханш" },
      },
      required: ["documentType", "date", "cashAccount", "amount", "description"],
    },
  },
  {
    name: "create_inventory_movement",
    description:
      "Бараа материалын хөдөлгөөн үүсгэнэ (зөвхөн ТОО ХЭМЖЭЭ — үнэлгээг өртгийн модуль сар хаахад хийнэ). Төрөл: receipt=орлого, issue=зарлага, transfer=шилжүүлэг, adjustment=тохируулга, return_in=буцаан авалт, return_out=буцаалт. Бараа/агуулахыг кодоор нь заана (list_inventory-оор шалгаж болно).",
    inputSchema: {
      type: "object",
      properties: {
        movementType: {
          type: "string",
          enum: ["receipt", "issue", "transfer", "adjustment", "return_in", "return_out"],
        },
        date: { type: "string", description: "Огноо YYYY-MM-DD" },
        itemCode: { type: "string", description: "Барааны код" },
        warehouseCode: { type: "string", description: "Агуулахын код (зарлагад гаргах агуулах)" },
        toWarehouseCode: { type: "string", description: "Шилжүүлэгт хүлээн авах агуулахын код" },
        quantity: { type: "number", description: "Тоо хэмжээ (тохируулгад сөрөг байж болно)" },
        description: { type: "string", description: "Тайлбар" },
        issueType: {
          type: "string",
          description: "Зарлагын төрлийн нэр (issue үед — хоосон бол хэрэглэгч сонгоно)",
        },
      },
      required: ["movementType", "date", "itemCode", "warehouseCode", "quantity"],
    },
  },
  {
    name: "create_fixed_asset",
    description:
      "Үндсэн хөрөнгийн карт үүсгэнэ (ноорог — хэрэглэгч шалгаад идэвхжүүлнэ; 'Шууд бичих' горимд идэвхтэй үүснэ). Данснуудыг идэвхтэй дансны жагсаалтаас өгнө (хөрөнгө 2101…, хуримтлагдсан элэгдэл 2100…, элэгдлийн зардал 7000…).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Хөрөнгийн нэр" },
        acquisitionDate: { type: "string", description: "Худалдан авсан огноо YYYY-MM-DD" },
        cost: { type: "number", description: "Өртөг (₮, 0-ээс их)" },
        salvageValue: { type: "number", description: "Үлдэх өртөг (default 0)" },
        usefulLifeMonths: { type: "integer", description: "Ашиглалтын хугацаа (сараар)" },
        depreciationMethod: {
          type: "string",
          enum: ["straight_line", "declining_balance"],
          description: "Элэгдлийн арга (default straight_line)",
        },
        custodian: { type: "string", description: "Хариуцагч (овог нэр)" },
        depreciationStartMonth: {
          type: "string",
          description: "Элэгдэл эхлэх сар YYYY-MM (default: авсан сарын дараах сар)",
        },
        assetAccountNumber: { type: "string", description: "Хөрөнгийн данс (8 оронтой)" },
        accumDepAccountNumber: { type: "string", description: "Хуримтлагдсан элэгдлийн данс" },
        depExpenseAccountNumber: { type: "string", description: "Элэгдлийн зардлын данс" },
      },
      required: [
        "name",
        "acquisitionDate",
        "cost",
        "usefulLifeMonths",
        "custodian",
        "assetAccountNumber",
        "accumDepAccountNumber",
        "depExpenseAccountNumber",
      ],
    },
  },
  {
    name: "list_counterparties",
    description:
      "Идэвхтэй харилцагчдын жагсаалт (нэр, төрөл, төлбөрийн нөхцөл, default данс). Нэхэмжлэх үүсгэхийн өмнө харилцагчийн яг нэрийг шалгахад ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Нэрээр шүүх (сонголтоор)" },
      },
    },
  },
  {
    name: "list_inventory",
    description:
      "Идэвхтэй бараа (код, нэр), агуулах (код, нэр), зарлагын төрлүүдийн жагсаалт. Бараа материалын хөдөлгөөн, бараатай нэхэмжлэхийн өмнө кодуудыг шалгахад ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Барааны нэр/кодоор шүүх (сонголтоор)" },
      },
    },
  },
  {
    name: "list_cash_accounts",
    description: "Идэвхтэй кассын/банкны дансны жагсаалт (нэр, төрөл, валют, GL данс).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_gl_accounts",
    description:
      "Идэвхтэй GL дансны жагсаалт (дугаар, нэр). Данс таамаглахын ОРОНД үүгээр хайна — бичилт хийхийн өмнө зөв дугаараа олоход ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Нэр эсвэл дугаараар шүүх (жишээ нь 'түрээс', '7400'). Хоосон бол бүгд",
        },
      },
    },
  },
  {
    name: "post_journal_voucher",
    description:
      "Ноорог журналыг баталж GL-д бичнэ. Зөвхөн 'Шууд бичих' горимд, тэнцсэн, 10 сая ₮-с хэтрэхгүй бичилтэд зөвшөөрөгдөнө — бусад тохиолдолд вэб дээрээс батлахыг заана.",
    inputSchema: {
      type: "object",
      properties: {
        voucherId: {
          type: "string",
          description: "Журналын ID (бүтэн эсвэл эхний 8+ тэмдэгт)",
        },
      },
      required: ["voucherId"],
    },
  },
  {
    name: "delete_journal_voucher",
    description:
      "НООРОГ журналыг устгана (батлагдсан бичилт устгагдахгүй). Хэрэглэгч ил хүссэн үед л ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        voucherId: {
          type: "string",
          description: "Журналын ID (бүтэн эсвэл эхний 8+ тэмдэгт)",
        },
      },
      required: ["voucherId"],
    },
  },
  {
    name: "post_cash_document",
    description:
      "Ноорог мөнгөн хөрөнгийн баримтыг баталж GL журнал үүсгэнэ. Зөвхөн 'Шууд бичих' горимд, 10 сая ₮-с хэтрэхгүй дүнд зөвшөөрөгдөнө.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Баримтын ID (бүтэн эсвэл эхний 8+ тэмдэгт)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "delete_cash_document",
    description:
      "НООРОГ мөнгөн хөрөнгийн баримтыг устгана. Хэрэглэгч ил хүссэн үед л ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Баримтын ID (бүтэн эсвэл эхний 8+ тэмдэгт)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "post_arap_document",
    description:
      "Ноорог АР/АП нэхэмжлэхийг баталж GL журнал үүсгэнэ (бараатай мөрүүд нь бараа материалын ноорог хөдөлгөөн үүсгэнэ). Зөвхөн 'Шууд бичих' горимд, 10 сая ₮-с хэтрэхгүй дүнд зөвшөөрөгдөнө.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Баримтын ID эсвэл нэхэмжлэхийн дугаар (жишээ нь AR-20260712-18CFE0)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "list_journal_vouchers",
    description:
      "Журналын бичилтүүдийн жагсаалт (огноо, утга, дүн, төлөв) — сүүлийнх нь эхэндээ. Үүсгэсэн ноорогоо шалгах, тайлагнахад ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD (сонголтоор)" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD (сонголтоор)" },
        status: {
          type: "string",
          enum: ["draft", "posted", "reversed"],
          description: "Төлвөөр шүүх (сонголтоор)",
        },
        limit: { type: "integer", description: "Хамгийн ихдээ хэдэн мөр (default 20, max 50)" },
      },
    },
  },
];

// ── Туслах ──────────────────────────────────────────────────────────────────

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : "Тодорхойгүй алдаа";
}

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);

/** Журналын редактортой ижил сегментийн контекст. */
async function accountContext(userId: string) {
  const [configs, values, accounts] = await Promise.all([
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.userId, userId) }),
    db.query.segmentValues.findMany({ where: eq(segmentValues.userId, userId) }),
    db.query.chartOfAccounts.findMany({
      where: and(eq(chartOfAccounts.userId, userId), eq(chartOfAccounts.isEnabled, true)),
      columns: { number: true, name: true },
    }),
  ]);
  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (def) => def.id === 3 || configMap.get(def.id)?.isEnabled === true
  ).map((def) => def.id);
  const defaults: Record<number, string> = {};
  if (activeSegIds.includes(1)) {
    const s1 = values.filter((value) => value.segmentId === 1);
    if (s1.length === 1) defaults[1] = s1[0].code;
  }
  return {
    activeSegIds,
    defaults,
    enabledByMain: new Map(accounts.map((account) => [account.number, account.name])),
  };
}

type Ctx = Awaited<ReturnType<typeof accountContext>>;

/** 8 оронтой/бүтэн кодыг normalize хийж идэвхтэй эсэхийг шалгана. */
function resolveAccount(raw: string, ctx: Ctx): { code: string; main: string } {
  const code = normalizePastedAccount(String(raw).trim(), ctx.activeSegIds, ctx.defaults);
  const main = parseSegParts(code, [3])[3] ?? "";
  if (!ctx.enabledByMain.has(main))
    throw new Error(
      `"${raw}" данс идэвхтэй жагсаалтад алга — list_gl_accounts tool-оор зөв дугаарыг хайна уу`
    );
  return { code, main };
}

/** Нэрээр ганц тохирол шаардана — 0 эсвэл олон бол ойлгомжтой алдаа. */
function requireSingle<T>(
  matches: T[],
  labelOf: (entry: T) => string,
  what: string,
  query: string
): T {
  if (matches.length === 1) return matches[0];
  if (matches.length === 0)
    throw new Error(`"${query}" нэртэй ${what} олдсонгүй — жагсаалтаас шалгана уу`);
  throw new Error(
    `"${query}" гэхэд ${matches.length} ${what} таарлаа: ${matches
      .slice(0, 8)
      .map(labelOf)
      .join(", ")} — аль нь болохыг тодруулна уу`
  );
}

function nameMatches<T>(list: T[], nameOf: (entry: T) => string, query: string): T[] {
  const q = query.trim().toLowerCase();
  const exact = list.filter((entry) => nameOf(entry).toLowerCase() === q);
  if (exact.length > 0) return exact;
  return list.filter((entry) => nameOf(entry).toLowerCase().includes(q));
}

// ── Гүйцэтгэгчид ────────────────────────────────────────────────────────────

type JournalLineInput = {
  account: string;
  debit?: number;
  credit?: number;
  description?: string;
};

async function runCreateJournal(
  userId: string,
  input: {
    date: string;
    description: string;
    lines: JournalLineInput[];
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const ctx = await accountContext(userId);
  const lines = (input.lines ?? []).map((line) => {
    const { code } = resolveAccount(line.account, ctx);
    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);
    if (debit < 0 || credit < 0) throw new Error("Дүн сөрөг байж болохгүй");
    if (debit > 0 && credit > 0)
      throw new Error("Нэг мөрөнд дебет, кредит зэрэг байж болохгүй");
    return { account: code, debit, credit, description: line.description ?? "" };
  });
  if (lines.length < 2) throw new Error("Журналд дор хаяж 2 мөр хэрэгтэй");

  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) <= 0.01 && totalDebit > 0;

  let status: "draft" | "posted" = "draft";
  let note = "";
  if (mode === "post") {
    if (!balanced)
      note = ` (тэнцээгүй тул ноорог үлдэв: Дт ${fmt(totalDebit)} ≠ Кт ${fmt(totalCredit)})`;
    else if (totalDebit > AI_POST_LIMIT_MNT)
      note = ` (${fmt(AI_POST_LIMIT_MNT)}₮-с их тул ноорог үлдэв — нягтланч шалгаж батална)`;
    else status = "posted";
  }

  const { id } = await createVoucher({
    date: input.date,
    description: input.description,
    lines,
    status,
  });

  return {
    resultText: `Журнал үүслээ. ID: ${id}, төлөв: ${status}, Дт ${fmt(totalDebit)}₮ / Кт ${fmt(totalCredit)}₮${note}`,
    action: {
      kind: "voucher",
      id,
      title: input.description || "Журнал",
      status,
    },
  };
}

async function runCreateArap(
  userId: string,
  input: {
    documentType: "ar_invoice" | "ap_bill";
    counterparty: string;
    date: string;
    dueDate?: string;
    description: string;
    controlAccount?: string;
    currency?: string;
    exchangeRate?: number;
    lines: {
      account?: string;
      description?: string;
      amount: number;
      itemCode?: string;
      quantity?: number;
      warehouseCode?: string;
    }[];
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const ctx = await accountContext(userId);
  const [cpList, items, whList, costingAccounts] = await Promise.all([
    db.query.counterparties.findMany({
      where: and(eq(counterparties.userId, userId), eq(counterparties.isActive, true)),
    }),
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.userId, userId), eq(inventoryItems.isActive, true)),
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.userId, userId), eq(warehouses.isActive, true)),
    }),
    loadCostingAccountSettings(userId),
  ]);

  const counterparty = requireSingle(
    nameMatches(cpList, (entry) => entry.name, input.counterparty),
    (entry) => entry.name,
    "харилцагч",
    input.counterparty
  );

  const isAp = input.documentType === "ap_bill";
  const controlRaw =
    input.controlAccount?.trim() ||
    (isAp
      ? counterparty.defaultPayableAccountNumber
      : counterparty.defaultReceivableAccountNumber) ||
    "";
  if (!controlRaw)
    throw new Error(
      `${counterparty.name} харилцагчид default ${isAp ? "өглөгийн" : "авлагын"} данс алга — controlAccount параметрээр өгнө үү`
    );
  const control = resolveAccount(controlRaw, ctx);

  const itemsByCode = new Map(items.map((item) => [item.code.toLowerCase(), item]));
  const whByCode = new Map(whList.map((wh) => [wh.code.toLowerCase(), wh]));

  const lines = (input.lines ?? []).map((line) => {
    let itemId: string | undefined;
    let warehouseId: string | undefined;
    if (line.itemCode) {
      const item = itemsByCode.get(line.itemCode.trim().toLowerCase());
      if (!item) throw new Error(`"${line.itemCode}" кодтой бараа олдсонгүй (list_inventory-оор шалгана уу)`);
      itemId = item.id;
      if (!(Number(line.quantity) > 0))
        throw new Error(`"${item.name}" мөрөнд тоо хэмжээ 0-ээс их байх ёстой`);
      const wh = line.warehouseCode
        ? whByCode.get(line.warehouseCode.trim().toLowerCase())
        : undefined;
      if (!wh) throw new Error(`Бараатай мөрөнд агуулахын код заавал (list_inventory-оор шалгана уу)`);
      warehouseId = wh.id;
    }
    // АП-ийн бараатай мөр клирингт суана (JPR-006) — данс автоматаар.
    const accountRaw =
      itemId && isAp
        ? costingAccounts.clearingAccountNumber
        : line.account?.trim();
    if (!accountRaw)
      throw new Error("Мөр бүрд данс хэрэгтэй (АП-ийн бараатай мөрөөс бусад)");
    return {
      account: resolveAccount(accountRaw, ctx).code,
      description: line.description ?? "",
      amount: Number(line.amount),
      itemId,
      quantity: itemId ? Number(line.quantity) : undefined,
      warehouseId,
    };
  });

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  let postNow = false;
  let note = "";
  if (mode === "post") {
    if (total > AI_POST_LIMIT_MNT)
      note = ` (${fmt(AI_POST_LIMIT_MNT)}₮-с их тул ноорог үлдэв)`;
    else postNow = true;
  }

  const dueDate =
    input.dueDate?.trim() ||
    (() => {
      const date = new Date(`${input.date}T00:00:00`);
      date.setDate(date.getDate() + counterparty.paymentTermsDays);
      return date.toISOString().slice(0, 10);
    })();

  const { id, documentNo } = await createArApDocument({
    documentType: input.documentType,
    counterpartyId: counterparty.id,
    date: input.date,
    dueDate,
    currency: input.currency,
    exchangeRate: input.exchangeRate,
    controlAccountNumber: control.code,
    description: input.description,
    lines,
    postNow,
  });

  const label = isAp ? "Өглөгийн нэхэмжлэх" : "Авлагын нэхэмжлэл";
  return {
    resultText: `${label} үүслээ. Дугаар: ${documentNo}, харилцагч: ${counterparty.name}, дүн: ${fmt(total)}₮, төлөв: ${postNow ? "батлагдсан" : "ноорог"}${note}`,
    action: {
      kind: "arap",
      id,
      title: `${documentNo} · ${counterparty.name}`,
      status: postNow ? "posted" : "draft",
    },
  };
}

async function runCreateCash(
  userId: string,
  input: {
    documentType: "receipt" | "payment" | "transfer";
    date: string;
    cashAccount: string;
    toCashAccount?: string;
    counterAccount?: string;
    amount: number;
    description: string;
    counterparty?: string;
    exchangeRate?: number;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const accounts = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.userId, userId), eq(cashAccounts.isActive, true)),
  });
  const findAccount = (query: string) =>
    requireSingle(
      nameMatches(accounts, (entry) => entry.name, query),
      (entry) => entry.name,
      "мөнгөн данс",
      query
    );

  const primary = findAccount(input.cashAccount);
  const secondary = input.toCashAccount ? findAccount(input.toCashAccount) : null;

  let counterAccountNumber: string | undefined;
  if (input.counterAccount) {
    const ctx = await accountContext(userId);
    counterAccountNumber = resolveAccount(input.counterAccount, ctx).main;
  }

  let postNow = false;
  let note = "";
  if (mode === "post") {
    if (Number(input.amount) > AI_POST_LIMIT_MNT)
      note = ` (${fmt(AI_POST_LIMIT_MNT)}₮-с их тул ноорог үлдэв)`;
    else postNow = true;
  }

  const { id } = await createCashDocument({
    documentType: input.documentType,
    date: input.date,
    fromCashAccountId:
      input.documentType === "payment" || input.documentType === "transfer"
        ? primary.id
        : undefined,
    toCashAccountId:
      input.documentType === "receipt"
        ? primary.id
        : input.documentType === "transfer"
          ? secondary?.id
          : undefined,
    counterAccountNumber,
    counterparty: input.counterparty,
    description: input.description,
    amount: Number(input.amount),
    exchangeRate: input.exchangeRate,
    postNow,
  });

  const typeLabel =
    input.documentType === "receipt"
      ? "Орлого"
      : input.documentType === "payment"
        ? "Зарлага"
        : "Шилжүүлэг";
  return {
    resultText: `Мөнгөн хөрөнгийн баримт үүслээ. ${typeLabel}, ${primary.name}, ${fmt(Number(input.amount))}₮, төлөв: ${postNow ? "батлагдсан" : "ноорог"}${note}`,
    action: {
      kind: "cash",
      id,
      title: `${typeLabel} · ${input.description}`.slice(0, 80),
      status: postNow ? "posted" : "draft",
    },
  };
}

async function runCreateMovement(
  userId: string,
  input: {
    movementType: "receipt" | "issue" | "transfer" | "adjustment" | "return_in" | "return_out";
    date: string;
    itemCode: string;
    warehouseCode: string;
    toWarehouseCode?: string;
    quantity: number;
    description?: string;
    issueType?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const [items, whList, issueTypes] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.userId, userId), eq(inventoryItems.isActive, true)),
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.userId, userId), eq(warehouses.isActive, true)),
    }),
    db.query.inventoryIssueTypes.findMany({
      where: eq(inventoryIssueTypes.userId, userId),
    }),
  ]);

  const item = requireSingle(
    nameMatches(items, (entry) => entry.code, input.itemCode).length > 0
      ? nameMatches(items, (entry) => entry.code, input.itemCode)
      : nameMatches(items, (entry) => entry.name, input.itemCode),
    (entry) => `${entry.code} (${entry.name})`,
    "бараа",
    input.itemCode
  );
  const findWh = (query: string) =>
    requireSingle(
      nameMatches(whList, (entry) => entry.code, query).length > 0
        ? nameMatches(whList, (entry) => entry.code, query)
        : nameMatches(whList, (entry) => entry.name, query),
      (entry) => `${entry.code} (${entry.name})`,
      "агуулах",
      query
    );
  const warehouse = findWh(input.warehouseCode);
  const toWarehouse = input.toWarehouseCode ? findWh(input.toWarehouseCode) : null;

  let issueTypeId: string | undefined;
  if (input.movementType === "issue" && input.issueType) {
    const active = issueTypes.filter((entry) => entry.isActive);
    issueTypeId = requireSingle(
      nameMatches(active, (entry) => entry.name, input.issueType),
      (entry) => entry.name,
      "зарлагын төрөл",
      input.issueType
    ).id;
  }

  const confirmNow = mode === "post";
  const { id } = await createInventoryMovement({
    movementType: input.movementType,
    date: input.date,
    itemId: item.id,
    warehouseId: warehouse.id,
    toWarehouseId: toWarehouse?.id,
    quantity: Number(input.quantity),
    description: input.description,
    issueTypeId,
    confirmNow,
  });

  const typeLabels: Record<string, string> = {
    receipt: "Орлого",
    issue: "Зарлага",
    transfer: "Шилжүүлэг",
    adjustment: "Тохируулга",
    return_in: "Буцаан авалт",
    return_out: "Буцаалт",
  };
  return {
    resultText: `Бараа материалын хөдөлгөөн үүслээ. ${typeLabels[input.movementType]}, ${item.code} × ${input.quantity}, ${warehouse.code}${toWarehouse ? ` → ${toWarehouse.code}` : ""}, төлөв: ${confirmNow ? "баталгаажсан" : "ноорог"}. Өртгийн үнэлгээ сар хаахад хийгдэнэ.`,
    action: {
      kind: "inventory",
      id,
      title: `${typeLabels[input.movementType]} · ${item.code} × ${input.quantity}`,
      status: confirmNow ? "confirmed" : "draft",
    },
  };
}

async function runCreateFixedAsset(
  userId: string,
  input: {
    name: string;
    acquisitionDate: string;
    cost: number;
    salvageValue?: number;
    usefulLifeMonths: number;
    depreciationMethod?: "straight_line" | "declining_balance";
    custodian: string;
    depreciationStartMonth?: string;
    assetAccountNumber: string;
    accumDepAccountNumber: string;
    depExpenseAccountNumber: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const ctx = await accountContext(userId);
  const asDraft = mode !== "post";

  // Default: авсан сарын ДАРААХ сараас элэгдүүлж эхэлнэ.
  const startMonth =
    input.depreciationStartMonth?.trim() ||
    (() => {
      const [y, m] = input.acquisitionDate.slice(0, 7).split("-").map(Number);
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
      return next;
    })();

  const { id, code } = await createFixedAsset(
    {
      name: input.name,
      acquisitionDate: input.acquisitionDate,
      cost: Number(input.cost),
      salvageValue: Number(input.salvageValue ?? 0),
      usefulLifeMonths: Number(input.usefulLifeMonths),
      depreciationMethod: input.depreciationMethod ?? "straight_line",
      custodian: input.custodian,
      depreciationStartMonth: startMonth,
      assetAccountNumber: resolveAccount(input.assetAccountNumber, ctx).main,
      accumDepAccountNumber: resolveAccount(input.accumDepAccountNumber, ctx).main,
      depExpenseAccountNumber: resolveAccount(input.depExpenseAccountNumber, ctx).main,
    },
    { asDraft }
  );

  return {
    resultText: `Үндсэн хөрөнгийн карт үүслээ. Код: ${code}, ${input.name}, өртөг ${fmt(Number(input.cost))}₮, төлөв: ${asDraft ? "ноорог" : "идэвхтэй"}`,
    action: {
      kind: "fa",
      id,
      title: `${code} · ${input.name}`,
      status: asDraft ? "draft" : "active",
    },
  };
}

// ── Батлах / устгах гүйцэтгэгчид ────────────────────────────────────────────

/** ID-г бүтэн эсвэл угтвараар нь ГАНЦ тохирол болгож шийднэ. */
function resolveByIdPrefix<T extends { id: string }>(
  rows: T[],
  idOrPrefix: string,
  what: string
): T {
  const query = idOrPrefix.trim().toLowerCase();
  if (query.length < 6)
    throw new Error(`${what}-ийн ID дор хаяж 6 тэмдэгт байх ёстой`);
  const matches = rows.filter((row) => row.id.toLowerCase().startsWith(query));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0)
    throw new Error(`"${idOrPrefix}" ID-тай ${what} олдсонгүй`);
  throw new Error(`"${idOrPrefix}" гэхэд ${matches.length} ${what} таарлаа — бүтэн ID өгнө үү`);
}

/** Батлах үйлдэл зөвхөн "Шууд бичих" горимд — эс бөгөөс ойлгомжтой татгалзал. */
function assertPostMode(mode: AiWriteMode) {
  if (mode !== "post")
    throw new Error(
      "Батлах нь зөвхөн 'Шууд бичих' горимд зөвшөөрөгдөнө. Чатын доод талын toggle-оос горимоо солих эсвэл вэб дээрээс өөрөө батална уу."
    );
}

function assertPostLimit(total: number) {
  if (total > AI_POST_LIMIT_MNT)
    throw new Error(
      `${fmt(total)}₮ нь ${fmt(AI_POST_LIMIT_MNT)}₮-ийн хязгаараас их — нягтланч вэб дээрээс шалгаж батална уу`
    );
}

async function runPostJournal(
  userId: string,
  input: { voucherId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const vouchers = await db.query.journalVouchers.findMany({
    where: eq(journalVouchers.userId, userId),
    columns: { id: true, status: true, description: true, date: true },
    with: { lines: { columns: { debit: true } } },
    orderBy: [desc(journalVouchers.createdAt)],
    limit: 500,
  });
  const voucher = resolveByIdPrefix(vouchers, input.voucherId, "журнал");
  if (voucher.status !== "draft")
    throw new Error(`Журнал ноорог биш байна (төлөв: ${voucher.status})`);
  const total = voucher.lines.reduce((sum, line) => sum + Number(line.debit), 0);
  assertPostLimit(total);

  await postVoucher(voucher.id);
  return {
    resultText: `Журнал батлагдлаа. ${voucher.date} · ${voucher.description} · ${fmt(total)}₮`,
    action: {
      kind: "voucher",
      id: voucher.id,
      title: voucher.description || "Журнал",
      status: "posted",
    },
  };
}

async function runDeleteJournal(
  userId: string,
  input: { voucherId: string }
): Promise<AiToolResult> {
  const vouchers = await db.query.journalVouchers.findMany({
    where: eq(journalVouchers.userId, userId),
    columns: { id: true, status: true, description: true, date: true },
    orderBy: [desc(journalVouchers.createdAt)],
    limit: 500,
  });
  const voucher = resolveByIdPrefix(vouchers, input.voucherId, "журнал");
  // deleteVoucher өөрөө "зөвхөн ноорог" дүрмээ шалгана.
  await deleteVoucher(voucher.id);
  return {
    resultText: `Ноорог журнал устгагдлаа: ${voucher.date} · ${voucher.description}`,
  };
}

async function runPostCash(
  userId: string,
  input: { documentId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const documents = await db.query.cashDocuments.findMany({
    where: eq(cashDocuments.userId, userId),
    columns: {
      id: true,
      status: true,
      description: true,
      date: true,
      amount: true,
      baseAmount: true,
    },
    orderBy: [desc(cashDocuments.createdAt)],
    limit: 500,
  });
  const document = resolveByIdPrefix(documents, input.documentId, "кассын баримт");
  if (document.status !== "draft")
    throw new Error(`Баримт ноорог биш байна (төлөв: ${document.status})`);
  assertPostLimit(Number(document.baseAmount ?? document.amount));

  await postCashDocument(document.id);
  return {
    resultText: `Мөнгөн хөрөнгийн баримт батлагдаж GL-д бичигдлээ. ${document.date} · ${document.description}`,
    action: {
      kind: "cash",
      id: document.id,
      title: document.description,
      status: "posted",
    },
  };
}

async function runDeleteCash(
  userId: string,
  input: { documentId: string }
): Promise<AiToolResult> {
  const documents = await db.query.cashDocuments.findMany({
    where: eq(cashDocuments.userId, userId),
    columns: { id: true, status: true, description: true, date: true },
    orderBy: [desc(cashDocuments.createdAt)],
    limit: 500,
  });
  const document = resolveByIdPrefix(documents, input.documentId, "кассын баримт");
  // deleteCashDocument өөрөө "зөвхөн ноорог" дүрмээ шалгана.
  await deleteCashDocument(document.id);
  return {
    resultText: `Ноорог кассын баримт устгагдлаа: ${document.date} · ${document.description}`,
  };
}

async function runPostArap(
  userId: string,
  input: { documentId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const documents = await db.query.arApDocuments.findMany({
    where: eq(arApDocuments.userId, userId),
    columns: {
      id: true,
      status: true,
      documentNo: true,
      description: true,
      totalAmount: true,
      baseTotalAmount: true,
    },
    orderBy: [desc(arApDocuments.createdAt)],
    limit: 500,
  });
  // Нэхэмжлэхийн дугаараар ч, ID-гаар ч олно.
  const byNo = documents.filter(
    (doc) => doc.documentNo.toLowerCase() === input.documentId.trim().toLowerCase()
  );
  const document =
    byNo.length === 1
      ? byNo[0]
      : resolveByIdPrefix(documents, input.documentId, "нэхэмжлэх");
  if (document.status !== "draft")
    throw new Error(`Нэхэмжлэх ноорог биш байна (төлөв: ${document.status})`);
  assertPostLimit(Number(document.baseTotalAmount ?? document.totalAmount));

  await postArApDocument(document.id);
  return {
    resultText: `Нэхэмжлэх батлагдаж GL-д бичигдлээ: ${document.documentNo}`,
    action: {
      kind: "arap",
      id: document.id,
      title: document.documentNo,
      status: "posted",
    },
  };
}

// ── Лавлах гүйцэтгэгчид ─────────────────────────────────────────────────────

async function runListGlAccounts(
  userId: string,
  input: { query?: string }
): Promise<AiToolResult> {
  const accounts = await db.query.chartOfAccounts.findMany({
    where: and(eq(chartOfAccounts.userId, userId), eq(chartOfAccounts.isEnabled, true)),
    columns: { number: true, name: true },
    orderBy: (account, { asc }) => [asc(account.number)],
  });
  const query = input.query?.trim().toLowerCase();
  const filtered = query
    ? accounts.filter(
        (account) =>
          account.number.includes(query) ||
          account.name.toLowerCase().includes(query)
      )
    : accounts;
  if (filtered.length === 0)
    return {
      resultText: `"${input.query}" гэсэн данс олдсонгүй — query-гүйгээр бүх дансыг харна уу`,
    };
  return {
    resultText: filtered
      .slice(0, 100)
      .map((account) => `${account.number} — ${account.name}`)
      .join("\n"),
  };
}

async function runListCounterparties(
  userId: string,
  input: { query?: string }
): Promise<AiToolResult> {
  const list = await db.query.counterparties.findMany({
    where: and(eq(counterparties.userId, userId), eq(counterparties.isActive, true)),
  });
  const filtered = input.query ? nameMatches(list, (entry) => entry.name, input.query) : list;
  if (filtered.length === 0) return { resultText: "Идэвхтэй харилцагч олдсонгүй" };
  const typeLabel: Record<string, string> = {
    customer: "Авлага",
    supplier: "Өглөг",
    both: "Авлага/Өглөг",
  };
  return {
    resultText: filtered
      .slice(0, 30)
      .map(
        (entry) =>
          `${entry.name} — ${typeLabel[entry.counterpartyType] ?? entry.counterpartyType}, нөхцөл ${entry.paymentTermsDays} хоног, валют ${entry.defaultCurrency}${entry.defaultReceivableAccountNumber ? `, авлагын данс ${entry.defaultReceivableAccountNumber}` : ""}${entry.defaultPayableAccountNumber ? `, өглөгийн данс ${entry.defaultPayableAccountNumber}` : ""}`
      )
      .join("\n"),
  };
}

async function runListInventory(
  userId: string,
  input: { query?: string }
): Promise<AiToolResult> {
  const [items, whList, issueTypes] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.userId, userId), eq(inventoryItems.isActive, true)),
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.userId, userId), eq(warehouses.isActive, true)),
    }),
    db.query.inventoryIssueTypes.findMany({
      where: eq(inventoryIssueTypes.userId, userId),
    }),
  ]);
  const filteredItems = input.query
    ? items.filter(
        (item) =>
          item.code.toLowerCase().includes(input.query!.toLowerCase()) ||
          item.name.toLowerCase().includes(input.query!.toLowerCase())
      )
    : items;
  return {
    resultText: [
      `Бараа (${filteredItems.length}):`,
      ...filteredItems.slice(0, 40).map((item) => `  ${item.code} — ${item.name}`),
      `Агуулах (${whList.length}):`,
      ...whList.map((wh) => `  ${wh.code} — ${wh.name}`),
      `Зарлагын төрөл:`,
      ...issueTypes
        .filter((entry) => entry.isActive)
        .map((entry) => `  ${entry.name}`),
    ].join("\n"),
  };
}

async function runListJournalVouchers(
  userId: string,
  input: { from?: string; to?: string; status?: string; limit?: number }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const vouchers = await db.query.journalVouchers.findMany({
    where: eq(journalVouchers.userId, userId),
    with: { lines: { columns: { debit: true } } },
    orderBy: [desc(journalVouchers.date), desc(journalVouchers.createdAt)],
    // Огноогоор JS талд шүүх тул хангалттай нөөцтэй татна.
    limit: 400,
  });
  const statusLabels: Record<string, string> = {
    draft: "ноорог",
    posted: "батлагдсан",
    reversed: "буцаагдсан",
  };
  const filtered = vouchers
    .filter((voucher) => {
      if (input.from && voucher.date < input.from) return false;
      if (input.to && voucher.date > input.to) return false;
      if (input.status && voucher.status !== input.status) return false;
      return true;
    })
    .slice(0, limit);
  if (filtered.length === 0) return { resultText: "Тохирох журнал олдсонгүй" };
  return {
    resultText: filtered
      .map((voucher) => {
        const total = voucher.lines.reduce(
          (sum, line) => sum + Number(line.debit),
          0
        );
        return `${voucher.date} · ${voucher.description || "(утгагүй)"} · ${fmt(total)}₮ · ${statusLabels[voucher.status] ?? voucher.status} · ID ${voucher.id.slice(0, 8)}`;
      })
      .join("\n"),
  };
}

async function runListCashAccounts(userId: string): Promise<AiToolResult> {
  const accounts = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.userId, userId), eq(cashAccounts.isActive, true)),
  });
  if (accounts.length === 0) return { resultText: "Идэвхтэй мөнгөн данс олдсонгүй" };
  return {
    resultText: accounts
      .map(
        (entry) =>
          `${entry.name} — ${entry.accountType === "bank" ? `банк (${entry.bankName ?? "?"})` : "касс"}, ${entry.currency}, GL ${entry.glAccountNumber}`
      )
      .join("\n"),
  };
}

// ── Нэгдсэн диспетчер ───────────────────────────────────────────────────────

/**
 * Tool-ийг гүйцэтгэнэ. Алдааг ХЭЗЭЭ Ч шидэхгүй — модельд ойлгомжтой
 * монгол текстээр буцаана (модель засаад дахин оролдох эсвэл хэрэглэгчээс
 * тодруулах боломжтой).
 */
export async function executeAiTool(
  userId: string,
  name: string,
  input: unknown,
  mode: AiWriteMode
): Promise<AiToolResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = (input ?? {}) as any;
    switch (name) {
      case "create_journal_voucher":
        return await runCreateJournal(userId, args, mode);
      case "create_arap_invoice":
        return await runCreateArap(userId, args, mode);
      case "create_cash_transaction":
        return await runCreateCash(userId, args, mode);
      case "create_inventory_movement":
        return await runCreateMovement(userId, args, mode);
      case "create_fixed_asset":
        return await runCreateFixedAsset(userId, args, mode);
      case "list_counterparties":
        return await runListCounterparties(userId, args);
      case "list_inventory":
        return await runListInventory(userId, args);
      case "post_journal_voucher":
        return await runPostJournal(userId, args, mode);
      case "delete_journal_voucher":
        return await runDeleteJournal(userId, args);
      case "post_cash_document":
        return await runPostCash(userId, args, mode);
      case "delete_cash_document":
        return await runDeleteCash(userId, args);
      case "post_arap_document":
        return await runPostArap(userId, args, mode);
      case "list_gl_accounts":
        return await runListGlAccounts(userId, args);
      case "list_cash_accounts":
        return await runListCashAccounts(userId);
      case "list_journal_vouchers":
        return await runListJournalVouchers(userId, args);
      default:
        return { resultText: `"${name}" гэдэг tool байхгүй` };
    }
  } catch (caught) {
    return { resultText: `Алдаа: ${errorText(caught)}` };
  }
}
