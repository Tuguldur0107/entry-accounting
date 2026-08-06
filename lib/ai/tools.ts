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

import { and, desc, eq, inArray, or } from "drizzle-orm";

import {
  createArApDocument,
  createCounterparty,
  deleteArApDocument,
  postArApDocument,
} from "@/lib/actions/arap";
import {
  createInvoiceLink,
  sendInvoiceEmail,
} from "@/lib/actions/invoice-send";
import {
  createCashAccount,
  createCashDocument,
  createCashOpeningVoucher,
  deleteCashDocument,
  postCashDocument,
  reverseCashDocument,
} from "@/lib/actions/cash";
import {
  activateFixedAsset,
  createFixedAsset,
  deleteFixedAsset,
  postDepreciationEntries,
  reverseDepreciationEntry,
  runDepreciation,
} from "@/lib/actions/fa";
import {
  createAccount,
  createVoucher,
  deleteVoucher,
  postVoucher,
  unpostVoucher,
  updateVoucher,
} from "@/lib/actions/gl";
import {
  confirmInventoryMovement,
  createInventoryItem,
  createInventoryMovement,
  createWarehouse,
  deleteInventoryMovement,
  recordInventoryCount,
  toggleInventoryItem,
  updateInventoryItem,
  updateInventoryMovement,
} from "@/lib/actions/inventory";
import { postCostEntries } from "@/lib/actions/costing";
import { computeMonthlyCosting } from "@/lib/actions/costing-period";
import { closePeriod, listPeriods, reopenPeriod } from "@/lib/actions/periods";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { loadClearingReconciliation } from "@/lib/costing/clearing-reconciliation";
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import { loadInventoryGlReconciliation } from "@/lib/costing/transaction-detail";
import { db } from "@/lib/db";
import {
  arApDocuments,
  arApSettlements,
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
  costEntries,
  counterparties,
  faDepreciationEntries,
  fixedAssets,
  inventoryIssueTypes,
  inventoryItems,
  inventoryMovements,
  journalVouchers,
  reportLineMappings,
  segmentConfigs,
  segmentValues,
  warehouses,
} from "@/lib/db/schema";
import {
  fmtAccountDisplay,
  normalizePastedAccount,
  parseSegParts,
} from "@/lib/grid/segments";
import {
  aggregateBalances,
  buildCashFlow,
  computeNetIncome,
  isBalanced,
} from "@/lib/reports/balances";
import { BS_LINES, type BsSection, type BsSign } from "@/lib/reports/bs-lines";

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
  /**
   * externalRef/давхардлаар алгасагдсан (шинэ бичлэг үүсээгүй, байгааг нь
   * буцаасан) — batch wrapper "skipped" гэж тоолно.
   */
  dedup?: boolean;
}

/**
 * Машинаар боловсруулагдах алдааны код — текстийн эхэнд [CODE] хэлбэрээр
 * залгагдана (спек: entry-mcp-tools §11). Модель болон MCP клиент кодоор
 * нь салгаж боловсруулна.
 */
function codedError(code: string, message: string): Error {
  return new Error(`[${code}] ${message}`);
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

/** Idempotency түлхүүр — гурван create tool ижил талбартай (спек §3). */
const EXTERNAL_REF_SCHEMA = {
  type: "string",
  description:
    "Гадаад системийн давтагдашгүй дугаар (eBarimt ДДТД, банкны гүйлгээний ID г.м). Ижил externalRef-тэй баримт байвал шинээр үүсгэхгүй, байгааг нь буцаана — retry аюулгүй.",
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
        externalRef: EXTERNAL_REF_SCHEMA,
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
        externalRef: EXTERNAL_REF_SCHEMA,
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
        externalRef: EXTERNAL_REF_SCHEMA,
        applyTo: {
          type: "array",
          description:
            "Энэ төлөлтөөр хаагдах АР/АП нэхэмжлэхүүд (батлагдсан). Σ amount нь төлөлтийн дүнгээс хэтрэхгүй; олон нэхэмжлэхэд хуваарилахад нэхэмжлэх тус бүрд тусдаа кассын баримт үүснэ. Өгөхгүй бол нэхэмжлэхтэй холбогдохгүй.",
          items: {
            type: "object",
            properties: {
              documentId: {
                type: "string",
                description: "Нэхэмжлэхийн ID, дугаар (AR-...), эсвэл externalRef",
              },
              amount: { type: "number", description: "Энэ нэхэмжлэхэд ноогдох дүн" },
            },
            required: ["documentId", "amount"],
          },
        },
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
      "Харилцагчдын жагсаалт (ID, нэр, ТТД/регистр, төрөл, төлбөрийн нөхцөл, default данс). Нэхэмжлэх үүсгэхийн өмнө яг нэр/ID-г шалгах, ТТД-гээр давхардлыг илрүүлэхэд ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Нэр эсвэл ТТД-гээр шүүх (сонголтоор)" },
        includeInactive: {
          type: "boolean",
          description: "Идэвхгүй харилцагчдыг ч оруулах (default false)",
        },
        limit: { type: "integer", description: "Max мөр (default 50, max 100)" },
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
      "Журнал устгана. Ноорог — аль ч горимд; БАТЛАГДСАНЫГ устгах нь 'Шууд бичих' горимд л зөвшөөрөгдөнө (GL-ээс бүрмөсөн хасна; дэд дэвтрийн баримттай холбоотой бол эх баримтаар нь устгуулна). Хэрэглэгч ил хүссэн үед л ашиглана.",
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
      "Мөнгөн хөрөнгийн баримт устгана. Ноорог — аль ч горимд; БАТЛАГДСАНЫГ устгах нь 'Шууд бичих' горимд — GL журнал нь хамт устаж, нэхэмжлэхийн төлөлт байсан бол үлдэгдэл сэргэнэ. Хэрэглэгч ил хүссэн үед л ашиглана.",
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

  // ── Мастер дата үүсгэх ────────────────────────────────────────────────────
  {
    name: "create_gl_account",
    description:
      "Дансны модонд шинэ GL данс нээнэ (8 оронтой дугаар, бүлгийн эхний цифр нь ангиллаа заана: 1 эргэлтийн хөрөнгө … 8 санхүүгийн зардал).",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "string", description: "8 оронтой дансны дугаар (жишээ нь 74000002)" },
        name: { type: "string", description: "Дансны нэр" },
      },
      required: ["number", "name"],
    },
  },
  {
    name: "create_counterparty",
    description:
      "Шинэ харилцагч бүртгэнэ (авлага/өглөгийн нэхэмжлэхэд ашиглагдана). Нэрийг нормчилж (илүү зай арилгана), ижил нэр (том/жижиг ялгахгүй) эсвэл ижил ТТД-тэй харилцагч байвал шинээр үүсгэхгүй — [CONFLICT] + байгаа харилцагчийн ID-г буцаана. Мастер дата тул аль ч горимд шууд идэвхтэй үүснэ.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Харилцагчийн нэр" },
        counterpartyType: {
          type: "string",
          enum: ["customer", "supplier", "both"],
          description: "customer=авлагын, supplier=өглөгийн, both=хоёулаа",
        },
        registerNo: { type: "string", description: "Регистрийн дугаар (сонголтоор)" },
        email: { type: "string", description: "И-мэйл (нэхэмжлэх илгээхэд ашиглагдана)" },
        defaultReceivableAccount: { type: "string", description: "Default авлагын данс (сонголтоор)" },
        defaultPayableAccount: { type: "string", description: "Default өглөгийн данс (сонголтоор)" },
        currency: { type: "string", description: "Default валют (default MNT)" },
        paymentTermsDays: { type: "integer", description: "Төлбөрийн нөхцөл, хоногоор (default 30)" },
      },
      required: ["name", "counterpartyType"],
    },
  },
  {
    name: "create_inventory_item",
    description: "Шинэ бараа бүртгэнэ (код нь давхардахгүй байх ёстой).",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Барааны код (жишээ нь ITEM-010)" },
        name: { type: "string", description: "Барааны нэр" },
        unit: { type: "string", description: "Хэмжих нэгж (default ш)" },
      },
      required: ["code", "name"],
    },
  },
  {
    name: "create_warehouse",
    description: "Шинэ агуулах бүртгэнэ.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Агуулахын код (жишээ нь WH-02)" },
        name: { type: "string", description: "Агуулахын нэр" },
      },
      required: ["code", "name"],
    },
  },

  {
    name: "update_counterparty",
    description:
      "Харилцагчийн мэдээлэл засна (нэр, төрөл, нөхцөл, default данс, и-мэйл, идэвх). Зөвхөн өгсөн талбарууд өөрчлөгдөнө.",
    inputSchema: {
      type: "object",
      properties: {
        counterparty: { type: "string", description: "Одоогийн нэр (олоход ашиглана)" },
        newName: { type: "string", description: "Шинэ нэр (сонголтоор)" },
        counterpartyType: {
          type: "string",
          enum: ["customer", "supplier", "both"],
          description: "Шинэ төрөл (сонголтоор)",
        },
        paymentTermsDays: { type: "integer", description: "Төлбөрийн нөхцөл, хоног (сонголтоор)" },
        defaultReceivableAccount: { type: "string", description: "Default авлагын данс (сонголтоор)" },
        defaultPayableAccount: { type: "string", description: "Default өглөгийн данс (сонголтоор)" },
        currency: { type: "string", description: "Default валют (сонголтоор)" },
        registerNo: { type: "string", description: "Регистр/ТТД (сонголтоор)" },
        email: { type: "string", description: "И-мэйл — нэхэмжлэх илгээхэд (сонголтоор)" },
        phone: { type: "string", description: "Утас (сонголтоор)" },
        address: { type: "string", description: "Хаяг (сонголтоор)" },
        isActive: { type: "boolean", description: "Идэвхтэй эсэх (сонголтоор)" },
      },
      required: ["counterparty"],
    },
  },
  {
    name: "send_invoice_email",
    description:
      "БИЧИГДСЭН (posted) авлагын нэхэмжлэхийг харилцагч руу и-мэйлээр илгээнэ — PDF хавсралт + онлайнаар үзэх линктэй. to өгөхгүй бол харилцагчийн бүртгэлтэй и-мэйл рүү явна. Хэрэглэгч ил хүссэн үед л ашиглана; ноорог нэхэмжлэх илгээгдэхгүй.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Нэхэмжлэхийн ID, дугаар (AR-...), эсвэл externalRef",
        },
        to: {
          type: "string",
          description: "Хүлээн авагчийн и-мэйл (default: харилцагчийн бүртгэлтэй и-мэйл)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "create_invoice_link",
    description:
      "БИЧИГДСЭН авлагын нэхэмжлэхийн public линк үүсгэнэ — и-мэйлгүй харилцагчид хуваалцахад (линкийг хэрэглэгч өөрөө дамжуулна).",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Нэхэмжлэхийн ID, дугаар (AR-...), эсвэл externalRef",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "update_inventory_item",
    description: "Барааны нэр, нэгж, идэвхийг засна (кодоор нь олно).",
    inputSchema: {
      type: "object",
      properties: {
        itemCode: { type: "string", description: "Барааны код" },
        name: { type: "string", description: "Шинэ нэр (сонголтоор)" },
        unit: { type: "string", description: "Шинэ нэгж (сонголтоор)" },
        isActive: { type: "boolean", description: "Идэвхтэй эсэх (сонголтоор)" },
      },
      required: ["itemCode"],
    },
  },
  {
    name: "update_inventory_movement",
    description:
      "НООРОГ хөдөлгөөнийг засна (огноо, тоо, тайлбар, бараа, агуулах). Зөвхөн өгсөн талбарууд өөрчлөгдөнө.",
    inputSchema: {
      type: "object",
      properties: {
        movementId: { type: "string", description: "Хөдөлгөөний ID (бүтэн эсвэл 8+ тэмдэгт)" },
        date: { type: "string", description: "Шинэ огноо YYYY-MM-DD (сонголтоор)" },
        quantity: { type: "number", description: "Шинэ тоо хэмжээ (сонголтоор)" },
        description: { type: "string", description: "Шинэ тайлбар (сонголтоор)" },
        itemCode: { type: "string", description: "Шинэ бараа (сонголтоор)" },
        warehouseCode: { type: "string", description: "Шинэ агуулах (сонголтоор)" },
        toWarehouseCode: { type: "string", description: "Шилжүүлэгт хүлээн авах агуулах (сонголтоор)" },
        issueType: { type: "string", description: "Зарлагын төрлийн нэр (сонголтоор)" },
      },
      required: ["movementId"],
    },
  },
  {
    name: "record_inventory_count",
    description:
      "Тооллого бүртгэнэ — агуулах дахь бараануудын тоолсон тоог өгөхөд системийн үлдэгдэлтэй зөрсөн зөрүүгээр тохируулгын НООРОГ хөдөлгөөн үүснэ.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Тооллогын огноо YYYY-MM-DD" },
        warehouseCode: { type: "string", description: "Агуулахын код" },
        counts: {
          type: "array",
          description: "Тоолсон бараанууд",
          items: {
            type: "object",
            properties: {
              itemCode: { type: "string", description: "Барааны код" },
              countedQty: { type: "number", description: "Тоолсон бодит тоо" },
            },
            required: ["itemCode", "countedQty"],
          },
        },
      },
      required: ["date", "warehouseCode", "counts"],
    },
  },
  {
    name: "create_cash_account",
    description: "Шинэ кассын/банкны данс бүртгэнэ.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Дансны нэр (жишээ нь 'Хаан банк MNT')" },
        accountType: { type: "string", enum: ["cash", "bank"] },
        bankName: { type: "string", description: "Банкны нэр (банкны дансанд)" },
        accountNumber: { type: "string", description: "Банкны дансны дугаар (сонголтоор)" },
        currency: { type: "string", description: "Валют (default MNT)" },
        glAccount: { type: "string", description: "Холбогдох GL данс (8 оронтой)" },
        openingBalance: { type: "number", description: "Нээлтийн үлдэгдэл (сонголтоор)" },
      },
      required: ["name", "accountType", "glAccount"],
    },
  },
  {
    name: "activate_fixed_asset",
    description:
      "НООРОГ хөрөнгийн картыг идэвхжүүлнэ (АП нэхэмжлэх/AI-аас үүссэн ноорог карт элэгдүүлж эхлэхийн өмнө). Өгсөн талбарууд картын утгыг дарж бичигдэнэ, бусад нь хэвээрээ.",
    inputSchema: {
      type: "object",
      properties: {
        assetCode: { type: "string", description: "Хөрөнгийн код (FA-...)" },
        name: { type: "string" },
        cost: { type: "number" },
        salvageValue: { type: "number" },
        usefulLifeMonths: { type: "integer" },
        custodian: { type: "string", description: "Хариуцагч" },
        depreciationStartMonth: { type: "string", description: "YYYY-MM" },
        assetAccountNumber: { type: "string" },
        accumDepAccountNumber: { type: "string" },
        depExpenseAccountNumber: { type: "string" },
      },
      required: ["assetCode"],
    },
  },
  {
    name: "delete_fixed_asset",
    description: "Хөрөнгийн карт устгана. Ноорог — аль ч горимд; ИДЭВХТЭЙГ устгах нь 'Шууд бичих' горимд, элэгдлийн бичилтгүй үед л. Хэрэглэгч ил хүссэн үед л ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        assetCode: { type: "string", description: "Хөрөнгийн код (FA-...)" },
      },
      required: ["assetCode"],
    },
  },
  {
    name: "reverse_fa_depreciation",
    description:
      "Тухайн сарын БАТЛАГДСАН элэгдлийн бичилтүүдийг буцаана (сторно). Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["month"],
    },
  },

  // ── GL нэмэлт ─────────────────────────────────────────────────────────────
  {
    name: "get_journal_voucher",
    description: "Нэг журналын дэлгэрэнгүй — толгой + мөрүүд (данс, дебет, кредит).",
    inputSchema: {
      type: "object",
      properties: {
        voucherId: { type: "string", description: "Журналын ID (бүтэн эсвэл эхний 8+ тэмдэгт)" },
      },
      required: ["voucherId"],
    },
  },
  {
    name: "update_journal_voucher",
    description:
      "НООРОГ журналыг засна (огноо, утга, мөрүүд). Мөр өгвөл хуучин мөрүүд БҮГД шинэчлэгдэнэ. Батлагдсан журнал засагдахгүй — эхлээд буцаана.",
    inputSchema: {
      type: "object",
      properties: {
        voucherId: { type: "string", description: "Журналын ID (бүтэн эсвэл эхний 8+ тэмдэгт)" },
        date: { type: "string", description: "Шинэ огноо YYYY-MM-DD (сонголтоор)" },
        description: { type: "string", description: "Шинэ утга (сонголтоор)" },
        lines: {
          type: "array",
          description: "Шинэ мөрүүд — өгвөл бүх мөр солигдоно (сонголтоор)",
          items: LINE_SCHEMA,
        },
      },
      required: ["voucherId"],
    },
  },
  {
    name: "reverse_journal_voucher",
    description:
      "Батлагдсан журналд буцаалтын (сторно) бичилт үүсгэнэ — эх журнал 'Буцаагдсан' төлөвт орно. Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        voucherId: { type: "string", description: "Журналын ID (бүтэн эсвэл эхний 8+ тэмдэгт)" },
      },
      required: ["voucherId"],
    },
  },
  {
    name: "get_trial_balance",
    description:
      "Гүйлгээ баланс — данс бүрийн эхний үлдэгдэл, гүйлгээ, эцсийн үлдэгдэл (нээлт нь from-оос өмнөх бүх бичилтээс).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },

  // ── Санхүүгийн тайлангууд ─────────────────────────────────────────────────
  {
    name: "get_income_statement",
    description:
      "Орлогын тайлан (үр дүнгийн тайлан) — орлого дансаар, зардал бүлгээр (COGS/үйл ажиллагааны/санхүүгийн), тайлант үеийн ЦЭВЭР АШИГ/АЛДАГДАЛ. Вэбийн тайлантай ижил тооцоо.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_balance_sheet",
    description:
      "Баланс тайлан (SAS/IAS 1 мөрүүдээр) — хөрөнгө, өр төлбөр, эздийн өмч + тайлант үеийн цэвэр ашиг; Актив = Пассив тэнцлийг шалгана. Хэрэглэгчийн мөрийн mapping (report_line_mappings) хэрэглэгдэнэ.",
    inputSchema: {
      type: "object",
      properties: {
        asOf: { type: "string", description: "Тайлант огноо YYYY-MM-DD" },
      },
      required: ["asOf"],
    },
  },
  {
    name: "get_cash_flow",
    description:
      "Мөнгөн гүйлгээний тайлан (шууд бус ангилал: үндсэн/хөрөнгө оруулалт/санхүүгийн үйл ажиллагаа) — мөнгөний эхний/эцсийн үлдэгдэлтэй тулгана.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_account_ledger",
    description:
      "Нэг дансны хуулга — эхний үлдэгдэл, хөдөлгөөн бүр (огноо, утга, Дт/Кт), гүйлгээний дараах явцын үлдэгдэл. Тайлангийн дүнг мөр хүртэл нь мөшгөхөд ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "Дансны 8 оронтой дугаар" },
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
        limit: { type: "integer", description: "Max мөр (default 50, max 200)" },
      },
      required: ["account", "from", "to"],
    },
  },
  {
    name: "create_year_end_closing",
    description:
      "Жилийн эцсийн хаалтын бичилтүүдийг НООРОГ-оор үүсгэнэ (12-31 огноогоор, 3 журнал): орлого → 44000099 Орлогын дүн, 44000099 → зардал, цэвэр дүн → 44000001 Хуримтлагдсан ашиг. Өмнө нь тухайн жилд хаалт хийгдсэн бол шинээр үүсгэхгүй. Урьдчилаад элэгдэл, өртөг, тулгалтаа дуусгасан байх ёстой — нягтланч ноорогуудыг вэбээс шалгаж батална.",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "string", description: "Хаах жил YYYY (жишээ нь 2026)" },
      },
      required: ["year"],
    },
  },

  // ── АР/АП нэмэлт ──────────────────────────────────────────────────────────
  {
    name: "list_arap_documents",
    description:
      "АР/АП нэхэмжлэхүүдийн жагсаалт (огноо, дугаар, харилцагч, нийт, төлөгдсөн, үлдэгдэл, төлөв, ID, externalRef).",
    inputSchema: {
      type: "object",
      properties: {
        documentType: { type: "string", enum: ["ar_invoice", "ap_bill"], description: "Төрлөөр шүүх" },
        counterparty: { type: "string", description: "Харилцагчийн нэрээр шүүх" },
        status: {
          type: "string",
          enum: ["draft", "posted", "partially_paid", "paid", "reversed"],
          description: "Төлвөөр шүүх",
        },
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
        openOnly: { type: "boolean", description: "Зөвхөн үлдэгдэлтэйг" },
        limit: { type: "integer", description: "Max мөр (default 20, max 50)" },
      },
    },
  },
  {
    name: "delete_arap_document",
    description:
      "АР/АП нэхэмжлэх устгана. Ноорог — аль ч горимд; БАТЛАГДСАНЫГ устгах нь 'Шууд бичих' горимд — GL журнал нь хамт устна (төлөлттэй бол татгалзана: эхлээд төлөлтийн баримтыг устгана; баталгаажсан бараа хөдөлгөөнтэй бол эхлээд цуцлана). Хэрэглэгч ил хүссэн үед л ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "string",
          description: "Баримтын ID (бүтэн эсвэл эхний 8+ тэмдэгт) эсвэл дугаар (AR-...)",
        },
      },
      required: ["documentId"],
    },
  },
  {
    name: "get_counterparty_balance",
    description:
      "Харилцагчийн авлага/өглөгийн үлдэгдэл (батлагдсан нэхэмжлэхээр, asOf огноогоор). Тулгалт болон aging (0-30/31-60/61-90/90+) задаргаанд ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        counterparty: { type: "string", description: "Харилцагчийн нэр — хоосон бол бүх харилцагч" },
        asOf: { type: "string", description: "YYYY-MM-DD (default өнөөдөр)" },
        aging: { type: "boolean", description: "Хугацааны задаргаатай (0-30/31-60/61-90/90+)" },
      },
    },
  },
  {
    name: "pay_arap_document",
    description:
      "Батлагдсан нэхэмжлэхийг мөнгөн хөрөнгөөр төлнө/хаана — АР бол орлого, АП бол зарлагын кассын баримт үүсч нэхэмжлэхтэй холбогдоно. Дүн өгөхгүй бол үлдэгдлээр нь бүтэн төлнө.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Нэхэмжлэхийн ID эсвэл дугаар (AR-...)" },
        cashAccount: { type: "string", description: "Кассын/банкны дансны нэр" },
        date: { type: "string", description: "Төлсөн огноо YYYY-MM-DD" },
        amount: { type: "number", description: "Төлөх дүн (default: үлдэгдэл бүтнээрээ)" },
      },
      required: ["documentId", "cashAccount", "date"],
    },
  },

  // ── Касс нэмэлт ───────────────────────────────────────────────────────────
  {
    name: "list_cash_documents",
    description:
      "Мөнгөн хөрөнгийн баримтуудын жагсаалт (огноо, дугаар, төрөл, дүн, төлөв, ID, externalRef).",
    inputSchema: {
      type: "object",
      properties: {
        documentType: {
          type: "string",
          enum: ["receipt", "payment", "transfer"],
          description: "Төрлөөр шүүх",
        },
        status: {
          type: "string",
          enum: ["draft", "posted", "reversed"],
          description: "Төлвөөр шүүх",
        },
        from: { type: "string", description: "Эхлэх огноо YYYY-MM-DD" },
        to: { type: "string", description: "Дуусах огноо YYYY-MM-DD" },
        limit: { type: "integer", description: "Max мөр (default 20, max 50)" },
      },
    },
  },
  {
    name: "reverse_cash_document",
    description:
      "Батлагдсан кассын баримтыг буцаана (сторно журнал үүснэ). Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Баримтын ID (бүтэн эсвэл эхний 8+ тэмдэгт)" },
      },
      required: ["documentId"],
    },
  },

  // ── Бараа материал нэмэлт ─────────────────────────────────────────────────
  {
    name: "list_inventory_movements",
    description:
      "Бараа материалын хөдөлгөөнүүдийн жагсаалт (төрөл, бараа, тоо, төлөв).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "confirmed", "cancelled"],
          description: "Төлвөөр шүүх",
        },
        limit: { type: "integer", description: "Max мөр (default 20, max 50)" },
      },
    },
  },
  {
    name: "confirm_inventory_movement",
    description:
      "Ноорог хөдөлгөөнийг баталгаажуулна (үлдэгдэлд нөлөөлж эхэлнэ; өртөг нь сар хаахад бодогдоно). Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        movementId: { type: "string", description: "Хөдөлгөөний ID (бүтэн эсвэл эхний 8+ тэмдэгт)" },
      },
      required: ["movementId"],
    },
  },
  {
    name: "delete_inventory_movement",
    description: "Хөдөлгөөн устгана. Ноорог — аль ч горимд; БАТАЛГААЖСАНЫГ устгах нь 'Шууд бичих' горимд (үнэлэгдсэн бол эхлээд өртгийг буцаана; үлдэгдэл хасах болохоор бол татгалзана). Хэрэглэгч ил хүссэн үед л ашиглана.",
    inputSchema: {
      type: "object",
      properties: {
        movementId: { type: "string", description: "Хөдөлгөөний ID (бүтэн эсвэл эхний 8+ тэмдэгт)" },
      },
      required: ["movementId"],
    },
  },
  {
    name: "get_stock_balances",
    description:
      "Барааны үлдэгдэл (баталгаажсан хөдөлгөөнөөр, бараа × агуулах). Шүүлтгүй бол бүх үлдэгдэл.",
    inputSchema: {
      type: "object",
      properties: {
        itemCode: { type: "string", description: "Барааны кодоор шүүх (сонголтоор)" },
        warehouseCode: { type: "string", description: "Агуулахын кодоор шүүх (сонголтоор)" },
      },
    },
  },

  // ── Үндсэн хөрөнгө нэмэлт ─────────────────────────────────────────────────
  {
    name: "list_fixed_assets",
    description: "Үндсэн хөрөнгийн картуудын жагсаалт (код, нэр, өртөг, төлөв).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "active", "disposed"],
          description: "Төлвөөр шүүх",
        },
      },
    },
  },
  {
    name: "run_fa_depreciation",
    description:
      "Тухайн сарын элэгдлийг бүх идэвхтэй хөрөнгөд бодож НООРОГ бичилтүүд үүсгэнэ (аль хэдийн бодогдсон хөрөнгө алгасагдана).",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["month"],
    },
  },
  {
    name: "post_fa_depreciation",
    description:
      "Тухайн сарын НООРОГ элэгдлийн бичилтүүдийг бүгдийг нь баталж GL-д бичнэ. Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["month"],
    },
  },

  // ── Период ────────────────────────────────────────────────────────────────
  {
    name: "list_periods",
    description:
      "Тайлант үеүүдийн жагсаалт (сар, төлөв, бичилтийн тоо). Бүртгэгдээгүй сар = нээлттэй.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "close_period",
    description:
      "Сарыг хаана — хаагдсан тайлант үе рүү бичилт хийгдэхгүй болно. Ноорог бичилт үлдсэн бол татгалзана. Зөвхөн 'Шууд бичих' горимд; хаахын өмнө элэгдэл, өртөг тооцоо хийгдсэн эсэхийг хэрэглэгчээс лавлана.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Тайлант үе YYYY-MM" },
      },
      required: ["code"],
    },
  },
  {
    name: "reopen_period",
    description: "Хаагдсан сарыг дахин нээнэ. Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Тайлант үе YYYY-MM" },
      },
      required: ["code"],
    },
  },

  {
    name: "fix_cash_opening_balance",
    description:
      "Кассын дансны НЭЭЛТИЙН үлдэгдлийг GL-д бичих ноорог журнал үүсгэнэ (Дт данс / Кт эздийн өмч; сөрөгт эсрэгээр). reconcile_modules-д кассын зөрүү нь нээлтийн үлдэгдэлтэй тэнцүү гарсан үед ашиглана — журнал батлагдмагц зөрүү арилна.",
    inputSchema: {
      type: "object",
      properties: {
        cashAccount: { type: "string", description: "Кассын/банкны дансны нэр" },
        counterAccount: {
          type: "string",
          description: "Харьцах данс (default: 41100000 эздийн өмч)",
        },
      },
      required: ["cashAccount"],
    },
  },

  // ── Тулгалт ба ажлын урсгал ───────────────────────────────────────────────
  {
    name: "reconcile_modules",
    description:
      "Модуль хоорондын тулгалт — дэд дэвтэр бүрийг GL-тэй тулгаж зөрүүг илрүүлнэ: касс/банкны данс, авлага/өглөгийн хяналтын данс, бараа материалын үнэлгээ, клирингийн данс. Зөрүү олдвол магадлалт шалтгаан, засах алхмыг зааж өгнө. Сар хаахын ӨМНӨ заавал ажиллуулна.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Мужийн эхлэл YYYY-MM-DD (клиринг/бараанд)" },
        to: { type: "string", description: "Тулгах огноо YYYY-MM-DD (үлдэгдэл энэ өдрөөр)" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_workflow_guide",
    description:
      "Даалгаврыг модулиудын ЗӨВ ДАРААЛЛААР хийх заавар — аль tool-ыг ямар дэс дараатай дуудахыг алхам алхмаар өгнө. Олон модуль дамнасан ажил эхлэхийн өмнө үүнийг уншина.",
    inputSchema: {
      type: "object",
      properties: {
        workflow: {
          type: "string",
          enum: [
            "purchase_inventory",
            "sale",
            "payment",
            "month_end_close",
            "fix_discrepancy",
            "new_company_setup",
            "fixed_asset_lifecycle",
          ],
          description:
            "purchase_inventory=бараатай худалдан авалт, sale=борлуулалт, payment=нэхэмжлэх төлөх, month_end_close=сар хаалт, fix_discrepancy=зөрүү засах, new_company_setup=шинэ компанийн тохиргоо, fixed_asset_lifecycle=ҮХ-ийн амьдралын мөчлөг",
        },
      },
      required: ["workflow"],
    },
  },

  // ── Өртөг ─────────────────────────────────────────────────────────────────
  {
    name: "run_monthly_costing",
    description:
      "Сарын өртөг тооцно — зарлага/тохируулгыг сарын жигнэсэн дундажаар үнэлж НООРОГ өртгийн бичилтүүд үүсгэнэ/шинэчилнэ. Блоклогдсон бараа байвал шалтгаантай нь буцаана.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Тайлант үе YYYY-MM" },
      },
      required: ["period"],
    },
  },
  {
    name: "post_cost_entries",
    description:
      "Тухайн сарын НООРОГ өртгийн бичилтүүдийг бүгдийг нь баталж GL-д бичнэ. Зөвхөн 'Шууд бичих' горимд.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Сар YYYY-MM" },
      },
      required: ["month"],
    },
  },

  // ── Batch (бөөн оруулалт) ─────────────────────────────────────────────────
  {
    name: "create_counterparties_batch",
    description:
      "Олон харилцагчийг нэг дуудлагаар бүртгэнэ (max 100). Partial success: мөр бүрийн үр дүн тусдаа буцна — давхардсан нь алгасагдаж, алдаатай нь бусдад нөлөөлөхгүй.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "create_counterparty-ийн input-уудын жагсаалт",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              counterpartyType: { type: "string", enum: ["customer", "supplier", "both"] },
              registerNo: { type: "string" },
              defaultReceivableAccount: { type: "string" },
              defaultPayableAccount: { type: "string" },
              currency: { type: "string" },
              paymentTermsDays: { type: "integer" },
            },
            required: ["name", "counterpartyType"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "create_arap_invoices_batch",
    description:
      "Олон АР/АП нэхэмжлэхийг нэг дуудлагаар үүсгэнэ (max 100). Partial success + externalRef idempotency: давхардсан нь алгасагдана, алдаатай мөрийг л дахин явуулна.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "create_arap_invoice-ийн input-уудын жагсаалт",
          items: { type: "object" },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "create_cash_transactions_batch",
    description:
      "Олон мөнгөн хөрөнгийн гүйлгээг нэг дуудлагаар үүсгэнэ (max 100). Partial success + externalRef idempotency; applyTo дэмжинэ.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "create_cash_transaction-ийн input-уудын жагсаалт",
          items: { type: "object" },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "post_arap_documents_batch",
    description:
      "Олон ноорог АР/АП нэхэмжлэхийг бөөнөөр батална. Зөвхөн 'Шууд бичих' горимд; 10 сая ₮-с их дүнтэй нь алгасагдаж, вэб дээрээс батлах жагсаалт болж буцна.",
    inputSchema: {
      type: "object",
      properties: {
        documentIds: {
          type: "array",
          description: "Баримтын ID эсвэл дугаарууд (max 100)",
          items: { type: "string" },
        },
      },
      required: ["documentIds"],
    },
  },
  {
    name: "post_cash_documents_batch",
    description:
      "Олон ноорог кассын баримтыг бөөнөөр батална. Зөвхөн 'Шууд бичих' горимд; 10 сая ₮-с их дүнтэй нь алгасагдаж, вэб дээрээс батлах жагсаалт болж буцна.",
    inputSchema: {
      type: "object",
      properties: {
        documentIds: {
          type: "array",
          description: "Баримтын ID-ууд (max 100)",
          items: { type: "string" },
        },
      },
      required: ["documentIds"],
    },
  },
  {
    name: "post_journal_vouchers_batch",
    description:
      "Олон ноорог журналыг бөөнөөр батална. Зөвхөн 'Шууд бичих' горимд; 10 сая ₮-с их дүнтэй нь алгасагдаж, вэб дээрээс батлах жагсаалт болж буцна.",
    inputSchema: {
      type: "object",
      properties: {
        voucherIds: {
          type: "array",
          description: "Журналын ID-ууд (max 100)",
          items: { type: "string" },
        },
      },
      required: ["voucherIds"],
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
    throw codedError(
      "ACCOUNT_NOT_FOUND",
      `"${raw}" данс идэвхтэй жагсаалтад алга — list_gl_accounts tool-оор зөв дугаарыг хайна уу`
    );
  return { code, main };
}

/** Ойролцоо нэрсийг bigram давхцлаар эрэмбэлж санал болгоно (спек §11). */
function suggestNames(all: string[], query: string, max = 5): string[] {
  const compact = (value: string) => value.toLowerCase().replace(/\s+/g, "");
  const q = compact(query);
  if (q.length === 0) return [];
  const bigrams = new Set<string>();
  for (let i = 0; i < q.length - 1; i++) bigrams.add(q.slice(i, i + 2));
  return all
    .map((name) => {
      const n = compact(name);
      let score = n.includes(q) || q.includes(n) ? 3 : 0;
      for (let i = 0; i < n.length - 1; i++)
        if (bigrams.has(n.slice(i, i + 2))) score += 1;
      return { name, score };
    })
    .filter((entry) => entry.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((entry) => entry.name);
}

/** Нэрээр ганц тохирол шаардана — 0 эсвэл олон бол ойлгомжтой алдаа. */
function requireSingle<T>(
  matches: T[],
  labelOf: (entry: T) => string,
  what: string,
  query: string,
  opts?: { codePrefix?: string; allNames?: string[] }
): T {
  if (matches.length === 1) return matches[0];
  const prefix = opts?.codePrefix;
  if (matches.length === 0) {
    const similar = opts?.allNames ? suggestNames(opts.allNames, query) : [];
    throw codedError(
      prefix ? `${prefix}_NOT_FOUND` : "NOT_FOUND",
      `"${query}" нэртэй ${what} олдсонгүй${similar.length > 0 ? `. Ойролцоо: ${similar.map((name) => `"${name}"`).join(", ")}` : " — жагсаалтаас шалгана уу"}`
    );
  }
  throw codedError(
    prefix ? `${prefix}_AMBIGUOUS` : "AMBIGUOUS",
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
    externalRef?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const externalRef = input.externalRef?.trim() || undefined;
  if (externalRef) {
    const existing = await db.query.journalVouchers.findFirst({
      where: and(
        eq(journalVouchers.userId, userId),
        eq(journalVouchers.externalRef, externalRef)
      ),
      with: { lines: { columns: { debit: true } } },
    });
    if (existing) {
      const total = existing.lines.reduce((sum, line) => sum + Number(line.debit), 0);
      return {
        resultText: `Аль хэдийн үүссэн байна (externalRef таарсан). ID: ${existing.id}, ${existing.date} · ${existing.description}, ${fmt(total)}₮, төлөв: ${existing.status}`,
        action: {
          kind: "voucher",
          id: existing.id,
          title: existing.description || "Журнал",
          status: existing.status === "draft" ? "draft" : "posted",
        },
        dedup: true,
      };
    }
  }
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
    externalRef,
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
    externalRef?: string;
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const externalRef = input.externalRef?.trim() || undefined;
  if (externalRef) {
    const existing = await db.query.arApDocuments.findFirst({
      where: and(
        eq(arApDocuments.userId, userId),
        eq(arApDocuments.externalRef, externalRef)
      ),
    });
    if (existing) {
      return {
        resultText: `Аль хэдийн үүссэн байна (externalRef таарсан). ID: ${existing.id}, ${existing.documentNo}, ${fmt(Number(existing.totalAmount))}₮, төлөв: ${ARAP_STATUS_LABELS[existing.status] ?? existing.status}`,
        action: {
          kind: "arap",
          id: existing.id,
          title: existing.documentNo,
          status: existing.status === "draft" ? "draft" : "posted",
        },
        dedup: true,
      };
    }
  }
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
    input.counterparty,
    { codePrefix: "COUNTERPARTY", allNames: cpList.map((entry) => entry.name) }
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
    externalRef,
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
    externalRef?: string;
    applyTo?: { documentId: string; amount: number }[];
  },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const externalRef = input.externalRef?.trim() || undefined;
  if (externalRef) {
    // Split төлөлт (олон нэхэмжлэхэд хуваарилсан) ref#1 ref#2 ... болж
    // хадгалагддаг тул хоёуланг нь шалгана.
    const existing = await db.query.cashDocuments.findFirst({
      where: and(
        eq(cashDocuments.userId, userId),
        or(
          eq(cashDocuments.externalRef, externalRef),
          eq(cashDocuments.externalRef, `${externalRef}#1`)
        )
      ),
    });
    if (existing) {
      return {
        resultText: `Аль хэдийн үүссэн байна (externalRef таарсан). ID: ${existing.id}, ${existing.documentNo}, ${existing.date}, ${fmt(Number(existing.amount))}₮, төлөв: ${existing.status}`,
        action: {
          kind: "cash",
          id: existing.id,
          title: existing.description,
          status: existing.status === "draft" ? "draft" : "posted",
        },
        dedup: true,
      };
    }
  }

  const accounts = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.userId, userId), eq(cashAccounts.isActive, true)),
  });
  const findAccount = (query: string) =>
    requireSingle(
      nameMatches(accounts, (entry) => entry.name, query),
      (entry) => entry.name,
      "мөнгөн данс",
      query,
      { allNames: accounts.map((entry) => entry.name) }
    );

  const primary = findAccount(input.cashAccount);
  const secondary = input.toCashAccount ? findAccount(input.toCashAccount) : null;

  let counterAccountNumber: string | undefined;
  if (input.counterAccount) {
    const ctx = await accountContext(userId);
    counterAccountNumber = resolveAccount(input.counterAccount, ctx).main;
  }

  const totalAmount = Math.round(Number(input.amount) * 100) / 100;

  // ── applyTo: төлөлтийг нэхэмжлэхүүдэд холбох (спек §7) ──────────────────
  const applyTo = (input.applyTo ?? []).map((entry) => ({
    documentId: String(entry.documentId ?? "").trim(),
    amount: Math.round(Number(entry.amount) * 100) / 100,
  }));
  const allocations: {
    document: typeof arApDocuments.$inferSelect;
    amount: number;
  }[] = [];
  if (applyTo.length > 0) {
    if (input.documentType === "transfer")
      throw new Error("Шилжүүлэгт applyTo хэрэглэхгүй — орлого/зарлагад л нэхэмжлэх холбоно");
    const documents = await db.query.arApDocuments.findMany({
      where: eq(arApDocuments.userId, userId),
      orderBy: [desc(arApDocuments.createdAt)],
      limit: 1000,
    });
    for (const alloc of applyTo) {
      if (!(alloc.amount > 0))
        throw new Error("applyTo мөр бүрийн дүн 0-ээс их байх ёстой");
      const q = alloc.documentId.toLowerCase();
      const byNo = documents.filter((doc) => doc.documentNo.toLowerCase() === q);
      const byRef = documents.filter(
        (doc) => (doc.externalRef ?? "").toLowerCase() === q && q.length > 0
      );
      const document =
        byNo.length === 1
          ? byNo[0]
          : byRef.length === 1
            ? byRef[0]
            : resolveByIdPrefix(documents, alloc.documentId, "нэхэмжлэх");
      const balance =
        Number(document.totalAmount) - Number(document.paidAmount);
      if (alloc.amount > balance + 0.01)
        throw new Error(
          `${document.documentNo}: хуваарилах дүн (${fmt(alloc.amount)}₮) үлдэгдлээс (${fmt(balance)}₮) их байна`
        );
      allocations.push({ document, amount: alloc.amount });
    }
    const applied = allocations.reduce((sum, alloc) => sum + alloc.amount, 0);
    if (applied > totalAmount + 0.01)
      throw new Error(
        `applyTo нийлбэр (${fmt(applied)}₮) төлөлтийн дүнгээс (${fmt(totalAmount)}₮) их байна`
      );
  }

  const decidePost = (amount: number) => {
    if (mode !== "post") return { postNow: false, note: "" };
    if (amount > AI_POST_LIMIT_MNT)
      return {
        postNow: false,
        note: ` (${fmt(AI_POST_LIMIT_MNT)}₮-с их тул ноорог үлдэв)`,
      };
    return { postNow: true, note: "" };
  };
  const commonFields = (amount: number) => ({
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
    counterparty: input.counterparty,
    amount,
    exchangeRate: input.exchangeRate,
  });
  const typeLabel =
    input.documentType === "receipt"
      ? "Орлого"
      : input.documentType === "payment"
        ? "Зарлага"
        : "Шилжүүлэг";
  const controlMainOf = (doc: typeof arApDocuments.$inferSelect) =>
    parseSegParts(doc.controlAccountNumber, [3])[3] ?? doc.controlAccountNumber;

  const applied = allocations.reduce((sum, alloc) => sum + alloc.amount, 0);
  const remainder = Math.round((totalAmount - applied) * 100) / 100;

  // Энгийн зам: нэхэмжлэхгүй, эсвэл ГАНЦ нэхэмжлэх бүтэн дүнгээ авч байвал
  // нэг л баримт үүсгэнэ (settlement нь баримтын дүнгээр бүтнээр хийгддэг).
  if (allocations.length === 0 || (allocations.length === 1 && remainder <= 0.01)) {
    const linked = allocations[0]?.document;
    const { postNow, note } = decidePost(totalAmount);
    const { id } = await createCashDocument({
      ...commonFields(totalAmount),
      counterAccountNumber:
        counterAccountNumber ?? (linked ? controlMainOf(linked) : undefined),
      description: input.description,
      postNow,
      arApDocumentId: linked?.id,
      externalRef,
    });
    return {
      resultText: `Мөнгөн хөрөнгийн баримт үүслээ. ${typeLabel}, ${primary.name}, ${fmt(totalAmount)}₮${linked ? `, нэхэмжлэх: ${linked.documentNo}` : ""}, төлөв: ${postNow ? "батлагдсан" : "ноорог"}${note}`,
      action: {
        kind: "cash",
        id,
        title: `${typeLabel} · ${input.description}`.slice(0, 80),
        status: postNow ? "posted" : "draft",
      },
    };
  }

  // Хуваарилалттай зам: нэхэмжлэх бүрд (болон үлдэгдэлд) тусдаа баримт.
  // Settlement нь баримт бүрийн дүнгээр хийгддэг тул нэг баримтад олон
  // нэхэмжлэх холбох боломжгүй — хуваарилалт бүр өөрийн баримттай.
  if (remainder > 0.01 && !counterAccountNumber)
    throw new Error(
      `Хуваарилагдаагүй ${fmt(remainder)}₮ үлдэж байна — counterAccount өгнө үү (эсвэл applyTo нийлбэрийг дүнтэй тэнцүүлнэ)`
    );
  const created: string[] = [];
  let part = 0;
  for (const alloc of allocations) {
    part += 1;
    const { postNow, note } = decidePost(alloc.amount);
    await createCashDocument({
      ...commonFields(alloc.amount),
      counterAccountNumber: controlMainOf(alloc.document),
      description: `${input.description} (${alloc.document.documentNo})`,
      postNow,
      arApDocumentId: alloc.document.id,
      externalRef: externalRef ? `${externalRef}#${part}` : undefined,
    });
    created.push(
      `${alloc.document.documentNo} · ${fmt(alloc.amount)}₮ · ${postNow ? "батлагдсан" : "ноорог"}${note}`
    );
  }
  if (remainder > 0.01) {
    part += 1;
    const { postNow, note } = decidePost(remainder);
    await createCashDocument({
      ...commonFields(remainder),
      counterAccountNumber,
      description: `${input.description} (хуваарилагдаагүй)`,
      postNow,
      externalRef: externalRef ? `${externalRef}#${part}` : undefined,
    });
    created.push(
      `хуваарилагдаагүй · ${fmt(remainder)}₮ · ${postNow ? "батлагдсан" : "ноорог"}${note}`
    );
  }
  return {
    resultText: [
      `${typeLabel} ${fmt(totalAmount)}₮ (${primary.name}) ${part} баримтад хуваагдаж нэхэмжлэхүүдэд холбогдлоо:`,
      ...created.map((line) => `  ${line}`),
    ].join("\n"),
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
    throw codedError(
      "DIRECT_MODE_REQUIRED",
      "Батлах нь зөвхөн 'Шууд бичих' горимд зөвшөөрөгдөнө. Чатын доод талын toggle-оос горимоо солих эсвэл вэб дээрээс өөрөө батална уу."
    );
}

function assertPostLimit(total: number) {
  if (total > AI_POST_LIMIT_MNT)
    throw codedError(
      "AMOUNT_LIMIT_EXCEEDED",
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
  input: { voucherId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const vouchers = await db.query.journalVouchers.findMany({
    where: eq(journalVouchers.userId, userId),
    columns: { id: true, status: true, description: true, date: true },
    orderBy: [desc(journalVouchers.createdAt)],
    limit: 500,
  });
  const voucher = resolveByIdPrefix(vouchers, input.voucherId, "журнал");
  // Батлагдсан бичилтийг устгах нь эргэлт буцалтгүй — зөвхөн "Шууд бичих"
  // горимд зөвшөөрнө (ноорог устгалт аль ч горимд чөлөөтэй).
  if (voucher.status !== "draft") assertPostMode(mode);
  await deleteVoucher(voucher.id);
  return {
    resultText: `${voucher.status === "draft" ? "Ноорог журнал" : "Журнал GL-тэй нь хамт"} устгагдлаа: ${voucher.date} · ${voucher.description}`,
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
  input: { documentId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const documents = await db.query.cashDocuments.findMany({
    where: eq(cashDocuments.userId, userId),
    columns: { id: true, status: true, description: true, date: true },
    orderBy: [desc(cashDocuments.createdAt)],
    limit: 500,
  });
  const document = resolveByIdPrefix(documents, input.documentId, "кассын баримт");
  if (document.status !== "draft") assertPostMode(mode);
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
  input: { query?: string; includeInactive?: boolean; limit?: number }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const list = await db.query.counterparties.findMany({
    where: input.includeInactive
      ? eq(counterparties.userId, userId)
      : and(eq(counterparties.userId, userId), eq(counterparties.isActive, true)),
  });
  const q = input.query?.trim().toLowerCase();
  const filtered = q
    ? list.filter(
        (entry) =>
          entry.name.toLowerCase().includes(q) ||
          (entry.registerNo ?? "").toLowerCase().includes(q)
      )
    : list;
  if (filtered.length === 0) return { resultText: "Тохирох харилцагч олдсонгүй" };
  // Сегменттэй бүтэн кодыг биш зөвхөн 8 оронтой үндсэн дугаарыг харуулна.
  const mainOf = (code: string | null) =>
    code ? (parseSegParts(code, [3])[3] ?? code) : null;
  return {
    resultText: filtered
      .slice(0, limit)
      .map((entry) => {
        const ar = mainOf(entry.defaultReceivableAccountNumber);
        const ap = mainOf(entry.defaultPayableAccountNumber);
        return [
          entry.id.slice(0, 8),
          entry.name,
          entry.registerNo ? `ТТД ${entry.registerNo}` : null,
          entry.email || null,
          CP_TYPE_LABELS[entry.counterpartyType] ?? entry.counterpartyType,
          entry.defaultCurrency,
          `${entry.paymentTermsDays} хоног`,
          ar || ap
            ? [ar ? `Дт ${ar}` : null, ap ? `Кт ${ap}` : null]
                .filter(Boolean)
                .join(" / ")
            : null,
          entry.isActive ? null : "ИДЭВХГҮЙ",
        ]
          .filter(Boolean)
          .join(" · ");
      })
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

// ── Мастер дата гүйцэтгэгчид ────────────────────────────────────────────────

async function runCreateGlAccount(
  _userId: string,
  input: { number: string; name: string }
): Promise<AiToolResult> {
  const number = String(input.number ?? "").trim();
  if (!/^\d{8}$/.test(number))
    throw new Error("Дансны дугаар 8 оронтой тоо байх ёстой");
  const result = await createAccount({ number, name: String(input.name ?? "").trim() });
  if (result && "error" in result) throw new Error(result.error);
  return { resultText: `Данс нээгдлээ: ${number} — ${input.name}` };
}

const CP_TYPE_LABELS: Record<string, string> = {
  customer: "Авлага",
  supplier: "Өглөг",
  both: "Авлага/Өглөг",
};

async function runCreateCounterparty(
  userId: string,
  input: {
    name: string;
    counterpartyType: "customer" | "supplier" | "both";
    registerNo?: string;
    email?: string;
    defaultReceivableAccount?: string;
    defaultPayableAccount?: string;
    currency?: string;
    paymentTermsDays?: number;
  }
): Promise<AiToolResult> {
  // Нэр нормчлол: trim + доторх давхар зайг нэг болгоно ("Би  Ти Эф " → "Би Ти Эф").
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Харилцагчийн нэр оруулна уу");
  const registerNo = input.registerNo?.trim() || undefined;

  // Давхардлын шалгалт: нэр case-insensitive, ТТД яг таарлаар (идэвхгүйг ч
  // оруулна — идэвхгүй харилцагчтай ижил нэр DB unique-д унана).
  const existingList = await db.query.counterparties.findMany({
    where: eq(counterparties.userId, userId),
  });
  const duplicate = existingList.find(
    (entry) =>
      entry.name.toLowerCase() === name.toLowerCase() ||
      (registerNo != null && entry.registerNo === registerNo)
  );
  if (duplicate) {
    return {
      resultText: `[CONFLICT] Аль хэдийн бүртгэгдсэн байна. ID: ${duplicate.id}, "${duplicate.name}"${duplicate.registerNo ? ` (ТТД ${duplicate.registerNo})` : ""}, ${CP_TYPE_LABELS[duplicate.counterpartyType] ?? duplicate.counterpartyType}${duplicate.isActive ? "" : " — ИДЭВХГҮЙ (update_counterparty-аар идэвхжүүлж болно)"}`,
      dedup: true,
    };
  }

  // Сегмент дүрэм: default дансыг бүтэн 10-part 0-padded кодоор хадгална.
  let receivableCode: string | undefined;
  let payableCode: string | undefined;
  if (input.defaultReceivableAccount || input.defaultPayableAccount) {
    const ctx = await accountContext(userId);
    if (input.defaultReceivableAccount)
      receivableCode = resolveAccount(input.defaultReceivableAccount, ctx).code;
    if (input.defaultPayableAccount)
      payableCode = resolveAccount(input.defaultPayableAccount, ctx).code;
  }
  const { id } = await createCounterparty({
    name,
    counterpartyType: input.counterpartyType,
    registerNo,
    email: input.email,
    defaultReceivableAccountNumber: receivableCode,
    defaultPayableAccountNumber: payableCode,
    defaultCurrency: input.currency,
    paymentTermsDays: input.paymentTermsDays,
  });
  return {
    resultText: `Харилцагч үүслээ. ID: ${id}, "${name}"${registerNo ? ` (ТТД ${registerNo})` : ""}${input.email?.trim() ? ` · ${input.email.trim()}` : ""}, ${CP_TYPE_LABELS[input.counterpartyType]}, ${input.currency?.trim().toUpperCase() || "MNT"}, ${input.paymentTermsDays ?? 30} хоног`,
  };
}

async function runCreateItem(
  _userId: string,
  input: { code: string; name: string; unit?: string }
): Promise<AiToolResult> {
  await createInventoryItem({
    code: input.code,
    name: input.name,
    unit: input.unit ?? "ш",
  });
  return { resultText: `Бараа бүртгэгдлээ: ${input.code} — ${input.name}` };
}

async function runCreateWarehouse(
  _userId: string,
  input: { code: string; name: string }
): Promise<AiToolResult> {
  await createWarehouse({ code: input.code, name: input.name });
  return { resultText: `Агуулах бүртгэгдлээ: ${input.code} — ${input.name}` };
}

async function runUpdateCounterparty(
  userId: string,
  input: {
    counterparty: string;
    newName?: string;
    counterpartyType?: "customer" | "supplier" | "both";
    paymentTermsDays?: number;
    defaultReceivableAccount?: string;
    defaultPayableAccount?: string;
    currency?: string;
    registerNo?: string;
    email?: string;
    phone?: string;
    address?: string;
    isActive?: boolean;
  }
): Promise<AiToolResult> {
  const list = await db.query.counterparties.findMany({
    where: eq(counterparties.userId, userId),
  });
  const counterparty = requireSingle(
    nameMatches(list, (entry) => entry.name, input.counterparty),
    (entry) => entry.name,
    "харилцагч",
    input.counterparty
  );

  const changes: Record<string, unknown> = {};
  if (input.newName?.trim()) changes.name = input.newName.trim();
  if (input.counterpartyType) {
    if (!["customer", "supplier", "both"].includes(input.counterpartyType))
      throw new Error("Харилцагчийн төрөл буруу байна");
    changes.counterpartyType = input.counterpartyType;
  }
  if (input.paymentTermsDays != null)
    changes.paymentTermsDays = Math.max(0, Math.round(input.paymentTermsDays));
  if (input.currency?.trim())
    changes.defaultCurrency = input.currency.trim().toUpperCase();
  if (input.registerNo != null)
    changes.registerNo = input.registerNo.trim() || null;
  if (input.email != null) {
    const email = input.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("И-мэйл хаяг буруу байна");
    changes.email = email || null;
  }
  if (input.phone != null) changes.phone = input.phone.trim() || null;
  if (input.address != null) changes.address = input.address.trim() || null;
  if (input.isActive != null) changes.isActive = input.isActive;
  if (input.defaultReceivableAccount != null || input.defaultPayableAccount != null) {
    const ctx = await accountContext(userId);
    // Сегмент дүрэм: бүтэн 10-part 0-padded кодоор хадгална — UI-ийн
    // сегмент picker болон нэхэмжлэхийн default энэ форматыг хүлээдэг.
    if (input.defaultReceivableAccount)
      changes.defaultReceivableAccountNumber = resolveAccount(
        input.defaultReceivableAccount,
        ctx
      ).code;
    if (input.defaultPayableAccount)
      changes.defaultPayableAccountNumber = resolveAccount(
        input.defaultPayableAccount,
        ctx
      ).code;
  }
  if (Object.keys(changes).length === 0)
    throw new Error("Өөрчлөх талбар өгөгдөөгүй байна");

  await db
    .update(counterparties)
    .set(changes)
    .where(and(eq(counterparties.id, counterparty.id), eq(counterparties.userId, userId)));
  return {
    resultText: `Харилцагч шинэчлэгдлээ: ${counterparty.name}${input.newName ? ` → ${input.newName}` : ""} (${Object.keys(changes).join(", ")})`,
  };
}

async function runUpdateItem(
  userId: string,
  input: { itemCode: string; name?: string; unit?: string; isActive?: boolean }
): Promise<AiToolResult> {
  const items = await db.query.inventoryItems.findMany({
    where: eq(inventoryItems.userId, userId),
  });
  const item = requireSingle(
    nameMatches(items, (entry) => entry.code, input.itemCode),
    (entry) => `${entry.code} (${entry.name})`,
    "бараа",
    input.itemCode
  );
  if (input.name != null || input.unit != null)
    await updateInventoryItem(item.id, {
      name: input.name ?? item.name,
      unit: input.unit ?? item.unit,
    });
  if (input.isActive != null) await toggleInventoryItem(item.id, input.isActive);
  return { resultText: `Бараа шинэчлэгдлээ: ${item.code}` };
}

async function runUpdateMovement(
  userId: string,
  input: {
    movementId: string;
    date?: string;
    quantity?: number;
    description?: string;
    itemCode?: string;
    warehouseCode?: string;
    toWarehouseCode?: string;
    issueType?: string;
  }
): Promise<AiToolResult> {
  const movements = await db.query.inventoryMovements.findMany({
    where: eq(inventoryMovements.userId, userId),
    orderBy: [desc(inventoryMovements.createdAt)],
    limit: 500,
  });
  const movement = resolveByIdPrefix(movements, input.movementId, "хөдөлгөөн");
  if (movement.status !== "draft")
    throw new Error(`Зөвхөн ноорог хөдөлгөөнийг засна (төлөв: ${movement.status})`);

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
  const findItem = (code: string) =>
    requireSingle(
      nameMatches(items, (entry) => entry.code, code),
      (entry) => entry.code,
      "бараа",
      code
    );
  const findWh = (code: string) =>
    requireSingle(
      nameMatches(whList, (entry) => entry.code, code),
      (entry) => entry.code,
      "агуулах",
      code
    );

  const itemId = input.itemCode ? findItem(input.itemCode).id : movement.itemId;
  const warehouseId = input.warehouseCode
    ? findWh(input.warehouseCode).id
    : movement.warehouseId;
  if (!itemId || !warehouseId)
    throw new Error("Хөдөлгөөнд бараа/агуулах дутуу — itemCode, warehouseCode өгнө үү");

  let issueTypeId = movement.issueTypeId ?? undefined;
  if (input.issueType) {
    issueTypeId = requireSingle(
      nameMatches(
        issueTypes.filter((entry) => entry.isActive),
        (entry) => entry.name,
        input.issueType
      ),
      (entry) => entry.name,
      "зарлагын төрөл",
      input.issueType
    ).id;
  }

  await updateInventoryMovement(movement.id, {
    movementType: movement.movementType as
      | "receipt"
      | "issue"
      | "transfer"
      | "adjustment"
      | "return_in"
      | "return_out",
    date: input.date ?? movement.date,
    itemId,
    warehouseId,
    toWarehouseId: input.toWarehouseCode
      ? findWh(input.toWarehouseCode).id
      : (movement.toWarehouseId ?? undefined),
    quantity: input.quantity != null ? Number(input.quantity) : Number(movement.quantity),
    description: input.description ?? movement.description ?? undefined,
    issueTypeId,
  });
  return { resultText: `Ноорог хөдөлгөөн шинэчлэгдлээ: ${movement.documentNo}` };
}

async function runRecordCount(
  userId: string,
  input: {
    date: string;
    warehouseCode: string;
    counts: { itemCode: string; countedQty: number }[];
  }
): Promise<AiToolResult> {
  const [items, whList] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.userId, userId), eq(inventoryItems.isActive, true)),
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.userId, userId), eq(warehouses.isActive, true)),
    }),
  ]);
  const warehouse = requireSingle(
    nameMatches(whList, (entry) => entry.code, input.warehouseCode),
    (entry) => entry.code,
    "агуулах",
    input.warehouseCode
  );
  const counts = (input.counts ?? []).map((count) => ({
    itemId: requireSingle(
      nameMatches(items, (entry) => entry.code, count.itemCode),
      (entry) => entry.code,
      "бараа",
      count.itemCode
    ).id,
    countedQty: Number(count.countedQty),
  }));
  const result = await recordInventoryCount({
    date: input.date,
    warehouseId: warehouse.id,
    counts,
  });
  const created = "created" in result ? result.created : 0;
  return {
    resultText:
      created === 0
        ? "Тооллого системийн үлдэгдэлтэй яг таарч байна — тохируулга хэрэггүй"
        : `Тооллого бүртгэгдлээ: ${created} зөрүүнд тохируулгын НООРОГ хөдөлгөөн үүслээ — баталгаажуулахаар шалгана уу`,
  };
}

async function runCreateCashAccount(
  userId: string,
  input: {
    name: string;
    accountType: "cash" | "bank";
    bankName?: string;
    accountNumber?: string;
    currency?: string;
    glAccount: string;
    openingBalance?: number;
  }
): Promise<AiToolResult> {
  const ctx = await accountContext(userId);
  await createCashAccount({
    name: input.name,
    accountType: input.accountType,
    bankName: input.bankName,
    accountNumber: input.accountNumber,
    currency: input.currency?.trim().toUpperCase() || "MNT",
    glAccountNumber: resolveAccount(input.glAccount, ctx).main,
    openingBalance: input.openingBalance,
  });
  return { resultText: `Мөнгөн данс бүртгэгдлээ: ${input.name}` };
}

async function findAssetByCode(userId: string, assetCode: string) {
  const assets = await db.query.fixedAssets.findMany({
    where: eq(fixedAssets.userId, userId),
  });
  return requireSingle(
    nameMatches(assets, (entry) => entry.code, assetCode),
    (entry) => `${entry.code} (${entry.name})`,
    "хөрөнгө",
    assetCode
  );
}

async function runActivateFixedAsset(
  userId: string,
  input: {
    assetCode: string;
    name?: string;
    cost?: number;
    salvageValue?: number;
    usefulLifeMonths?: number;
    custodian?: string;
    depreciationStartMonth?: string;
    assetAccountNumber?: string;
    accumDepAccountNumber?: string;
    depExpenseAccountNumber?: string;
  }
): Promise<AiToolResult> {
  const asset = await findAssetByCode(userId, input.assetCode);
  if (asset.status !== "draft")
    throw new Error(`Зөвхөн ноорог картыг идэвхжүүлнэ (төлөв: ${asset.status})`);

  await activateFixedAsset(asset.id, {
    code: asset.code,
    name: input.name ?? asset.name,
    acquisitionDate: asset.acquisitionDate,
    cost: input.cost ?? Number(asset.cost),
    salvageValue: input.salvageValue ?? Number(asset.salvageValue),
    usefulLifeMonths: input.usefulLifeMonths ?? asset.usefulLifeMonths,
    depreciationMethod: asset.depreciationMethod as
      | "straight_line"
      | "declining_balance",
    // Ноорог картад хариуцагч/эхлэх сар хоосон байж болно — идэвхжүүлэхэд
    // заавал тул моделиос нөхөж өгөхийг шаардана.
    custodian:
      input.custodian ??
      asset.custodian ??
      (() => {
        throw new Error("Хариуцагч (custodian) өгнө үү — ноорог картад хоосон байна");
      })(),
    depreciationStartMonth:
      input.depreciationStartMonth ??
      asset.depreciationStartMonth ??
      (() => {
        throw new Error(
          "Элэгдэл эхлэх сар (depreciationStartMonth, YYYY-MM) өгнө үү — ноорог картад хоосон байна"
        );
      })(),
    assetAccountNumber: input.assetAccountNumber ?? asset.assetAccountNumber,
    accumDepAccountNumber: input.accumDepAccountNumber ?? asset.accumDepAccountNumber,
    depExpenseAccountNumber:
      input.depExpenseAccountNumber ?? asset.depExpenseAccountNumber,
  });
  return {
    resultText: `Хөрөнгө идэвхжлээ: ${asset.code} · ${input.name ?? asset.name} — элэгдэл ${input.depreciationStartMonth ?? asset.depreciationStartMonth} сараас бодогдоно`,
  };
}

async function runDeleteFixedAsset(
  userId: string,
  input: { assetCode: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const asset = await findAssetByCode(userId, input.assetCode);
  if (asset.status !== "draft") assertPostMode(mode);
  await deleteFixedAsset(asset.id);
  return { resultText: `Хөрөнгийн карт устгагдлаа: ${asset.code} · ${asset.name}` };
}

async function runReverseFaDepreciation(
  userId: string,
  input: { month: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const entries = await db.query.faDepreciationEntries.findMany({
    where: and(
      eq(faDepreciationEntries.userId, userId),
      eq(faDepreciationEntries.periodMonth, input.month),
      eq(faDepreciationEntries.status, "posted")
    ),
    columns: { id: true, amount: true },
  });
  if (entries.length === 0)
    return { resultText: `${input.month} сард батлагдсан элэгдлийн бичилт алга` };
  const total = entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
  assertPostLimit(total);
  for (const entry of entries) await reverseDepreciationEntry(entry.id);
  return {
    resultText: `${input.month} сарын элэгдэл буцаагдлаа: ${entries.length} бичилт, нийт ${fmt(total)}₮`,
  };
}

// ── GL нэмэлт гүйцэтгэгчид ──────────────────────────────────────────────────

async function loadVouchers(userId: string) {
  return db.query.journalVouchers.findMany({
    where: eq(journalVouchers.userId, userId),
    with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
    orderBy: [desc(journalVouchers.createdAt)],
    limit: 500,
  });
}

async function runGetJournal(
  userId: string,
  input: { voucherId: string }
): Promise<AiToolResult> {
  const ctx = await accountContext(userId);
  const voucher = resolveByIdPrefix(
    await loadVouchers(userId),
    input.voucherId,
    "журнал"
  );
  const statusLabels: Record<string, string> = {
    draft: "ноорог",
    posted: "батлагдсан",
    reversed: "буцаагдсан",
  };
  const lines = voucher.lines.map(
    (line) =>
      `  ${fmtAccountDisplay(line.accountNumber, ctx.activeSegIds)} ${ctx.enabledByMain.get(parseSegParts(line.accountNumber, [3])[3] ?? "") ?? ""} | Дт ${fmt(Number(line.debit))} | Кт ${fmt(Number(line.credit))} | ${line.description ?? ""}`
  );
  return {
    resultText: [
      `${voucher.date} · ${voucher.description} · ${statusLabels[voucher.status] ?? voucher.status} · ID ${voucher.id}`,
      ...lines,
    ].join("\n"),
  };
}

async function runUpdateJournal(
  userId: string,
  input: {
    voucherId: string;
    date?: string;
    description?: string;
    lines?: JournalLineInput[];
  }
): Promise<AiToolResult> {
  const ctx = await accountContext(userId);
  const voucher = resolveByIdPrefix(
    await loadVouchers(userId),
    input.voucherId,
    "журнал"
  );
  if (voucher.status !== "draft")
    throw new Error(`Зөвхөн ноорог журналыг засна (төлөв: ${voucher.status})`);

  const lines = input.lines
    ? input.lines.map((line) => {
        const { code } = resolveAccount(line.account, ctx);
        const debit = Number(line.debit ?? 0);
        const credit = Number(line.credit ?? 0);
        if (debit > 0 && credit > 0)
          throw new Error("Нэг мөрөнд дебет, кредит зэрэг байж болохгүй");
        return { account: code, debit, credit, description: line.description ?? "" };
      })
    : voucher.lines.map((line) => ({
        account: line.accountNumber,
        debit: Number(line.debit),
        credit: Number(line.credit),
        description: line.description ?? "",
      }));

  await updateVoucher(voucher.id, {
    date: input.date ?? voucher.date,
    description: input.description ?? voucher.description,
    lines,
    status: "draft",
  });
  return {
    resultText: `Ноорог журнал шинэчлэгдлээ (${input.date ?? voucher.date})`,
    action: {
      kind: "voucher",
      id: voucher.id,
      title: input.description ?? voucher.description ?? "Журнал",
      status: "draft",
    },
  };
}

async function runReverseJournal(
  userId: string,
  input: { voucherId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const voucher = resolveByIdPrefix(
    await loadVouchers(userId),
    input.voucherId,
    "журнал"
  );
  if (voucher.status !== "posted")
    throw new Error(`Зөвхөн батлагдсан журналыг буцаана (төлөв: ${voucher.status})`);
  const total = voucher.lines.reduce((sum, line) => sum + Number(line.debit), 0);
  assertPostLimit(total);
  await unpostVoucher(voucher.id);
  return {
    resultText: `Буцаалтын бичилт үүсч эх журнал "Буцаагдсан" боллоо: ${voucher.date} · ${voucher.description}`,
  };
}

async function runGetTrialBalance(
  userId: string,
  input: { from: string; to: string }
): Promise<AiToolResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(input.to ?? ""))
    throw new Error("from/to огноо YYYY-MM-DD форматтай байх ёстой");
  const [vouchers, accounts, configs] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.userId, userId),
        // GL тайлангийн хуудастай ижил: reversed нь эх + буцаалт хосоороо
        // тооцогдож нэт 0 болно.
        inArray(journalVouchers.status, ["posted", "reversed"])
      ),
      with: { lines: true },
    }),
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.userId, userId),
    }),
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.userId, userId) }),
  ]);
  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (def) => def.id === 3 || configMap.get(def.id)?.isEnabled === true
  ).map((def) => def.id);

  const rows = aggregateBalances(vouchers, accounts, activeSegIds, input.from, input.to);
  if (rows.length === 0) return { resultText: "Бичилт олдсонгүй" };

  const lines = rows.map(
    (row) =>
      `${row.activeKey} ${row.name} | Нээлт Дт ${fmt(row.totals.openDebit)} Кт ${fmt(row.totals.openCredit)} | Гүйлгээ Дт ${fmt(row.totals.periodDebit)} Кт ${fmt(row.totals.periodCredit)} | Хаалт Дт ${fmt(row.totals.closeDebit)} Кт ${fmt(row.totals.closeCredit)}`
  );
  const totalPeriodDebit = rows.reduce((sum, row) => sum + row.totals.periodDebit, 0);
  const totalPeriodCredit = rows.reduce((sum, row) => sum + row.totals.periodCredit, 0);
  return {
    resultText: [
      `Гүйлгээ баланс ${input.from} — ${input.to} (батлагдсан бичилтээр):`,
      ...lines,
      `НИЙТ гүйлгээ: Дт ${fmt(totalPeriodDebit)} / Кт ${fmt(totalPeriodCredit)}`,
    ].join("\n"),
  };
}

// ── Санхүүгийн тайлангийн гүйцэтгэгчид ──────────────────────────────────────
// Вэбийн тайлангуудтай (components/gl/*view.tsx) ИЖИЛ цэвэр функцуудыг
// (lib/reports/balances.ts, bs-lines.ts) ашиглана — тусдаа тооцооны зам гаргахгүй.

function assertDates(...values: string[]) {
  for (const value of values)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? ""))
      throw new Error("Огноо YYYY-MM-DD форматтай байх ёстой");
}

/** Тайлангийн түүхий дата — батлагдсан журнал + бүх данс (нэр тайлбарт хэрэгтэй). */
async function loadReportData(userId: string) {
  const [vouchers, accounts] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.userId, userId),
        inArray(journalVouchers.status, ["posted", "reversed"])
      ),
      with: { lines: true },
    }),
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.userId, userId),
    }),
  ]);
  return { vouchers, accounts };
}

const IS_EXPENSE_GROUPS = [
  { prefix: "6", label: "Борлуулсан бараа/үйлчилгээний өртөг" },
  { prefix: "7", label: "Үйл ажиллагааны зардал" },
  { prefix: "8", label: "Санхүүгийн зардал" },
] as const;

async function runIncomeStatement(
  userId: string,
  input: { from: string; to: string }
): Promise<AiToolResult> {
  assertDates(input.from, input.to);
  const { vouchers, accounts } = await loadReportData(userId);
  const rows = aggregateBalances(vouchers, accounts, [3], input.from, input.to);
  const pnl = computeNetIncome(rows);

  const out: string[] = [`ОРЛОГЫН ТАЙЛАН ${input.from} — ${input.to}`, "Орлого:"];
  const revenueRows = rows
    .filter((row) => row.cls === "revenue")
    .map((row) => ({
      row,
      amount: row.totals.periodCredit - row.totals.periodDebit,
    }))
    .filter((entry) => Math.abs(entry.amount) > 0.005);
  for (const entry of revenueRows)
    out.push(`  ${entry.row.mainAccount} ${entry.row.name} — ${fmt(entry.amount)}`);
  out.push(`  Нийт орлого: ${fmt(pnl.revenue)}`);

  for (const group of IS_EXPENSE_GROUPS) {
    const items = rows
      .filter((row) => row.mainAccount.startsWith(group.prefix))
      .map((row) => ({
        row,
        amount: row.totals.periodDebit - row.totals.periodCredit,
      }))
      .filter((entry) => Math.abs(entry.amount) > 0.005);
    if (items.length === 0) continue;
    out.push(`${group.label}:`);
    for (const entry of items)
      out.push(`  ${entry.row.mainAccount} ${entry.row.name} — ${fmt(entry.amount)}`);
    out.push(`  Дэд дүн: ${fmt(items.reduce((sum, entry) => sum + entry.amount, 0))}`);
  }
  out.push(`Нийт зардал: ${fmt(pnl.expense)}`);
  out.push(
    `ТАЙЛАНТ ҮЕИЙН ЦЭВЭР ${pnl.netIncome >= 0 ? "АШИГ" : "АЛДАГДАЛ"}: ${fmt(pnl.netIncome)}`
  );
  return { resultText: out.join("\n") };
}

// balance-sheet-view.tsx-ийн GROUP_META-тай ижил: custom мөрийн бүлэг →
// хэсэг + тэмдэг.
const BS_GROUP_META: Record<
  string,
  { section: BsSection; groupLabel: string; sign: BsSign }
> = {
  "current-assets": { section: "assets", groupLabel: "Эргэлтийн хөрөнгө", sign: "debit" },
  "non-current-assets": {
    section: "assets",
    groupLabel: "Эргэлтийн бус хөрөнгө",
    sign: "debit",
  },
  "current-liabilities": {
    section: "liabilities",
    groupLabel: "Богино хугацаат өр төлбөр",
    sign: "credit",
  },
  "non-current-liabilities": {
    section: "liabilities",
    groupLabel: "Урт хугацаат өр төлбөр",
    sign: "credit",
  },
  equity: { section: "equity", groupLabel: "Эздийн өмч", sign: "credit" },
};

async function runBalanceSheet(
  userId: string,
  input: { asOf: string }
): Promise<AiToolResult> {
  assertDates(input.asOf);
  const [{ vouchers, accounts }, mappings] = await Promise.all([
    loadReportData(userId),
    db.query.reportLineMappings.findMany({
      where: and(
        eq(reportLineMappings.userId, userId),
        eq(reportLineMappings.reportType, "balance-sheet")
      ),
    }),
  ]);
  const rows = aggregateBalances(vouchers, accounts, [3], "1900-01-01", input.asOf);
  const byMain = new Map(rows.map((row) => [row.mainAccount, row]));
  const mappingByKey = new Map(mappings.map((row) => [row.lineKey, row]));

  // Вэбийн resolvedLines-тай ижил: built-in мөр + override + custom мөрүүд.
  type Line = {
    section: BsSection;
    groupLabel: string;
    label: string;
    accountNumbers: string[];
    sign: BsSign;
  };
  const lines: Line[] = BS_LINES.map((line) => {
    const mapping = mappingByKey.get(line.key);
    const override = mapping?.accountNumbers
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    return {
      section: line.section,
      groupLabel: line.groupLabel,
      label: mapping?.customLabel?.trim() || line.label,
      accountNumbers:
        override !== undefined
          ? override
          : accounts
              .filter((account) =>
                line.defaultPrefixes.some((prefix) => account.number.startsWith(prefix))
              )
              .map((account) => account.number),
      sign: line.sign,
    };
  });
  for (const mapping of mappings) {
    if (!mapping.lineKey.startsWith("custom-")) continue;
    const meta = BS_GROUP_META[mapping.customGroup ?? "current-assets"];
    if (!meta) continue;
    lines.push({
      section: meta.section,
      groupLabel: meta.groupLabel,
      label: mapping.customLabel?.trim() || "Нэргүй мөр",
      accountNumbers: mapping.accountNumbers
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      sign: meta.sign,
    });
  }

  const amountOf = (line: Line) =>
    line.accountNumbers.reduce((sum, code) => {
      const row = byMain.get(code);
      if (!row) return sum;
      const debitNet = row.totals.closeDebit - row.totals.closeCredit;
      return sum + (line.sign === "debit" ? debitNet : -debitNet);
    }, 0);

  const pnl = computeNetIncome(rows);
  const out: string[] = [`БАЛАНС ${input.asOf}-ны байдлаар`];
  const sectionTotals: Record<BsSection, number> = { assets: 0, liabilities: 0, equity: 0 };
  for (const section of ["assets", "liabilities", "equity"] as const) {
    const label =
      section === "assets" ? "ХӨРӨНГӨ" : section === "liabilities" ? "ӨР ТӨЛБӨР" : "ЭЗДИЙН ӨМЧ";
    out.push(`${label}:`);
    let lastGroup = "";
    for (const line of lines.filter((entry) => entry.section === section)) {
      const amount = amountOf(line);
      sectionTotals[section] += amount;
      if (Math.abs(amount) <= 0.005) continue;
      if (line.groupLabel !== lastGroup) {
        out.push(`  ${line.groupLabel}:`);
        lastGroup = line.groupLabel;
      }
      out.push(`    ${line.label} — ${fmt(amount)}`);
    }
    if (section === "equity") {
      out.push(
        `    Тайлант үеийн цэвэр ${pnl.netIncome >= 0 ? "ашиг" : "алдагдал"} — ${fmt(pnl.netIncome)}`
      );
    }
  }
  const totalEquity = sectionTotals.equity + pnl.netIncome;
  const totalLiabAndEquity = sectionTotals.liabilities + totalEquity;
  out.push(`НИЙТ ХӨРӨНГӨ: ${fmt(sectionTotals.assets)}`);
  out.push(`НИЙТ ӨР ТӨЛБӨР: ${fmt(sectionTotals.liabilities)}`);
  out.push(`НИЙТ ЭЗДИЙН ӨМЧ: ${fmt(totalEquity)}`);
  out.push(`НИЙТ ӨР ТӨЛБӨР + ЭЗДИЙН ӨМЧ: ${fmt(totalLiabAndEquity)}`);
  out.push(
    isBalanced(sectionTotals.assets, totalLiabAndEquity)
      ? "Тэнцэл: ✓ Актив = Пассив"
      : `Тэнцэл: ✗ ЗӨРҮҮ ${fmt(sectionTotals.assets - totalLiabAndEquity)} — reconcile_modules-оор шалтгааныг хайна уу`
  );
  return { resultText: out.join("\n") };
}

async function runCashFlow(
  userId: string,
  input: { from: string; to: string }
): Promise<AiToolResult> {
  assertDates(input.from, input.to);
  const { vouchers, accounts } = await loadReportData(userId);
  const report = buildCashFlow(vouchers, accounts, [3], input.from, input.to);
  const sectionLabels = {
    operating: "Үндсэн үйл ажиллагаа",
    investing: "Хөрөнгө оруулалт",
    financing: "Санхүүгийн үйл ажиллагаа",
  } as const;
  const out: string[] = [`МӨНГӨН ГҮЙЛГЭЭНИЙ ТАЙЛАН ${input.from} — ${input.to}`];
  for (const section of ["operating", "investing", "financing"] as const) {
    const lines = report[section];
    out.push(`${sectionLabels[section]}: ${fmt(report.totals[section])}`);
    for (const line of lines)
      out.push(`  ${line.mainAccount} ${line.name} — ${fmt(line.amount)}`);
  }
  const open = report.cashOpenDebit - report.cashOpenCredit;
  const close = report.cashCloseDebit - report.cashCloseCredit;
  out.push(`ЦЭВЭР МӨНГӨН УРСГАЛ: ${fmt(report.totals.net)}`);
  out.push(`Мөнгөний эхний үлдэгдэл: ${fmt(open)} · эцсийн үлдэгдэл: ${fmt(close)}`);
  out.push(
    isBalanced(open + report.totals.net, close)
      ? "Тулгалт: ✓ эхний + урсгал = эцсийн"
      : `Тулгалт: ✗ зөрүү ${fmt(open + report.totals.net - close)}`
  );
  return { resultText: out.join("\n") };
}

async function runAccountLedger(
  userId: string,
  input: { account: string; from: string; to: string; limit?: number }
): Promise<AiToolResult> {
  assertDates(input.from, input.to);
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const ctx = await accountContext(userId);
  const { main } = resolveAccount(input.account, ctx);
  const { vouchers } = await loadReportData(userId);

  let opening = 0;
  const entries: {
    date: string;
    description: string;
    debit: number;
    credit: number;
  }[] = [];
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      if ((parseSegParts(line.accountNumber, [3])[3] ?? line.accountNumber) !== main)
        continue;
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      if (voucher.date < input.from) opening += debit - credit;
      else if (voucher.date <= input.to)
        entries.push({
          date: voucher.date,
          description: line.description || voucher.description,
          debit,
          credit,
        });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  const name = ctx.enabledByMain.get(main) ?? "";
  const out: string[] = [
    `ДАНСНЫ ХУУЛГА ${main} ${name} · ${input.from} — ${input.to}`,
    `Эхний үлдэгдэл: ${fmt(opening)}`,
  ];
  let running = opening;
  for (const entry of entries.slice(0, limit)) {
    running += entry.debit - entry.credit;
    out.push(
      `${entry.date} · ${entry.description} · Дт ${fmt(entry.debit)} / Кт ${fmt(entry.credit)} · үлдэгдэл ${fmt(running)}`
    );
  }
  if (entries.length > limit)
    out.push(`… ${entries.length - limit} мөр хасагдав (limit=${limit})`);
  const closing = entries.reduce((sum, entry) => sum + entry.debit - entry.credit, opening);
  out.push(`Эцсийн үлдэгдэл: ${fmt(closing)}`);
  return { resultText: out.join("\n") };
}

async function runYearEndClosing(
  userId: string,
  input: { year: string }
): Promise<AiToolResult> {
  const year = String(input.year ?? "").trim();
  if (!/^\d{4}$/.test(year)) throw new Error("Жил YYYY форматтай байх ёстой");
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const marker = `Жилийн хаалт ${year}`;

  const { vouchers, accounts } = await loadReportData(userId);
  // Idempotency: ноорог ч бай, батлагдсан ч бай — нэг жилд нэг л хаалт.
  const dupes = await db.query.journalVouchers.findMany({
    where: eq(journalVouchers.userId, userId),
    columns: { id: true, description: true, status: true },
  });
  const already = dupes.find((voucher) => voucher.description.startsWith(marker));
  if (already)
    return {
      resultText: `[CONFLICT] ${year} оны хаалтын бичилт аль хэдийн байна (ID ${already.id.slice(0, 8)}, төлөв: ${already.status}) — дахин үүсгэсэнгүй. Дахин хийх бол эхлээд хуучныг устгаж/буцаана уу.`,
      dedup: true,
    };

  const ctx = await accountContext(userId);
  const plSummary = resolveAccount("44000099", ctx);
  const retained = resolveAccount("44000001", ctx);

  const rows = aggregateBalances(vouchers, accounts, [3], from, to);
  const revenue = rows
    .map((row) => ({
      main: row.mainAccount,
      amount: row.totals.periodCredit - row.totals.periodDebit,
    }))
    .filter((entry) => entry.main.startsWith("5") && Math.abs(entry.amount) > 0.005);
  const expense = rows
    .map((row) => ({
      main: row.mainAccount,
      amount: row.totals.periodDebit - row.totals.periodCredit,
    }))
    .filter((entry) => /^[678]/.test(entry.main) && Math.abs(entry.amount) > 0.005);
  const totalRevenue = revenue.reduce((sum, entry) => sum + entry.amount, 0);
  const totalExpense = expense.reduce((sum, entry) => sum + entry.amount, 0);
  const net = Math.round((totalRevenue - totalExpense) * 100) / 100;
  if (revenue.length === 0 && expense.length === 0)
    throw new Error(`${year} онд хаах орлого/зардлын гүйлгээ алга`);

  // Сөрөг үлдэгдэлтэй данс талаа сольж бичигдэнэ (контра орлого г.м).
  const side = (amount: number, normal: "debit" | "credit") => {
    const debitSide = (normal === "debit") === (amount >= 0);
    return {
      debit: debitSide ? Math.abs(amount) : 0,
      credit: debitSide ? 0 : Math.abs(amount),
    };
  };

  const created: string[] = [];
  if (revenue.length > 0) {
    const { id } = await createVoucher({
      date: to,
      description: `${marker} 1/3: орлогын дансдыг хаав`,
      status: "draft",
      lines: [
        ...revenue.map((entry) => ({
          account: resolveAccount(entry.main, ctx).code,
          description: "Орлого хаах",
          ...side(entry.amount, "debit"),
        })),
        {
          account: plSummary.code,
          description: "Орлогын дүн",
          ...side(totalRevenue, "credit"),
        },
      ],
    });
    created.push(`1/3 орлого ${fmt(totalRevenue)} (ID ${id.slice(0, 8)})`);
  }
  if (expense.length > 0) {
    const { id } = await createVoucher({
      date: to,
      description: `${marker} 2/3: зардлын дансдыг хаав`,
      status: "draft",
      lines: [
        {
          account: plSummary.code,
          description: "Орлогын дүн",
          ...side(totalExpense, "debit"),
        },
        ...expense.map((entry) => ({
          account: resolveAccount(entry.main, ctx).code,
          description: "Зардал хаах",
          ...side(entry.amount, "credit"),
        })),
      ],
    });
    created.push(`2/3 зардал ${fmt(totalExpense)} (ID ${id.slice(0, 8)})`);
  }
  if (Math.abs(net) > 0.005) {
    const { id } = await createVoucher({
      date: to,
      description: `${marker} 3/3: цэвэр дүнг хуримтлагдсан ашигт`,
      status: "draft",
      lines: [
        {
          account: plSummary.code,
          description: "Орлогын дүн хаах",
          ...side(net, "debit"),
        },
        {
          account: retained.code,
          description: "Хуримтлагдсан ашиг",
          ...side(net, "credit"),
        },
      ],
    });
    created.push(`3/3 цэвэр дүн ${fmt(net)} (ID ${id.slice(0, 8)})`);
  }

  return {
    resultText: [
      `${year} оны хаалтын НООРОГ бичилтүүд ${to} огноогоор үүслээ:`,
      ...created.map((line) => `  ${line}`),
      `Нийт орлого ${fmt(totalRevenue)} − зардал ${fmt(totalExpense)} = ЦЭВЭР ${net >= 0 ? "АШИГ" : "АЛДАГДАЛ"} ${fmt(net)}`,
      "Нягтланч вэбээс (Ерөнхий журнал → Журналын жагсаалт) шалгаж батална.",
    ].join("\n"),
  };
}

// ── АР/АП нэмэлт гүйцэтгэгчид ───────────────────────────────────────────────

const ARAP_STATUS_LABELS: Record<string, string> = {
  draft: "ноорог",
  posted: "батлагдсан",
  partially_paid: "хэсэгчлэн төлсөн",
  paid: "төлсөн",
  reversed: "буцаагдсан",
};

async function runListArapDocuments(
  userId: string,
  input: {
    documentType?: string;
    counterparty?: string;
    status?: string;
    from?: string;
    to?: string;
    openOnly?: boolean;
    limit?: number;
  }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const documents = await db.query.arApDocuments.findMany({
    where: eq(arApDocuments.userId, userId),
    with: { counterparty: { columns: { name: true } } },
    orderBy: [desc(arApDocuments.date), desc(arApDocuments.createdAt)],
    limit: 400,
  });
  const cpQuery = input.counterparty?.trim().toLowerCase();
  const filtered = documents
    .filter((doc) => {
      const balance = Number(doc.totalAmount) - Number(doc.paidAmount);
      if (input.documentType && doc.documentType !== input.documentType) return false;
      if (input.status && doc.status !== input.status) return false;
      if (cpQuery && !(doc.counterparty?.name ?? "").toLowerCase().includes(cpQuery))
        return false;
      if (input.from && doc.date < input.from) return false;
      if (input.to && doc.date > input.to) return false;
      if (input.openOnly && !(balance > 0.01 && doc.status !== "draft" && doc.status !== "reversed"))
        return false;
      return true;
    })
    .slice(0, limit);
  if (filtered.length === 0) return { resultText: "Тохирох нэхэмжлэх олдсонгүй" };
  return {
    resultText: filtered
      .map((doc) => {
        const balance = Number(doc.totalAmount) - Number(doc.paidAmount);
        return `${doc.date} · ${doc.documentNo} · ${doc.counterparty?.name ?? "?"} · ${doc.documentType === "ar_invoice" ? "АР" : "АП"} · нийт ${fmt(Number(doc.totalAmount))} · төлөгдсөн ${fmt(Number(doc.paidAmount))} · үлдэгдэл ${fmt(balance)} · ${ARAP_STATUS_LABELS[doc.status] ?? doc.status} · ID ${doc.id.slice(0, 8)}${doc.externalRef ? ` · ref ${doc.externalRef}` : ""}`;
      })
      .join("\n"),
  };
}

async function runPayArap(
  userId: string,
  input: { documentId: string; cashAccount: string; date: string; amount?: number },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const documents = await db.query.arApDocuments.findMany({
    where: eq(arApDocuments.userId, userId),
    orderBy: [desc(arApDocuments.createdAt)],
    limit: 500,
  });
  const byNo = documents.filter(
    (doc) => doc.documentNo.toLowerCase() === input.documentId.trim().toLowerCase()
  );
  const document =
    byNo.length === 1
      ? byNo[0]
      : resolveByIdPrefix(documents, input.documentId, "нэхэмжлэх");
  if (!["posted", "partially_paid"].includes(document.status))
    throw new Error(
      `Зөвхөн батлагдсан/хэсэгчлэн төлсөн нэхэмжлэхийг төлнө (төлөв: ${ARAP_STATUS_LABELS[document.status] ?? document.status})`
    );

  const balance = Number(document.totalAmount) - Number(document.paidAmount);
  const amount = input.amount != null ? Number(input.amount) : balance;
  if (!(amount > 0)) throw new Error("Төлөх дүн 0-ээс их байх ёстой");
  if (amount > balance + 0.01)
    throw new Error(`Төлөх дүн үлдэгдлээс их байна (үлдэгдэл ${fmt(balance)}₮)`);

  const accounts = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.userId, userId), eq(cashAccounts.isActive, true)),
  });
  const cashAccount = requireSingle(
    nameMatches(accounts, (entry) => entry.name, input.cashAccount),
    (entry) => entry.name,
    "мөнгөн данс",
    input.cashAccount
  );

  const isAr = document.documentType === "ar_invoice";
  let postNow = false;
  let note = "";
  if (mode === "post") {
    if (amount > AI_POST_LIMIT_MNT)
      note = ` (${fmt(AI_POST_LIMIT_MNT)}₮-с их тул ноорог үлдэв)`;
    else postNow = true;
  }

  const { id } = await createCashDocument({
    documentType: isAr ? "receipt" : "payment",
    date: input.date,
    toCashAccountId: isAr ? cashAccount.id : undefined,
    fromCashAccountId: isAr ? undefined : cashAccount.id,
    counterAccountNumber: parseSegParts(document.controlAccountNumber, [3])[3] ??
      document.controlAccountNumber,
    description: `${document.documentNo} төлөлт`,
    amount,
    arApDocumentId: document.id,
    postNow,
  });

  return {
    resultText: `Төлбөрийн баримт үүслээ: ${document.documentNo}, ${fmt(amount)}₮, ${cashAccount.name}, төлөв: ${postNow ? "батлагдсан" : "ноорог"}${note}`,
    action: {
      kind: "cash",
      id,
      title: `${document.documentNo} төлөлт`,
      status: postNow ? "posted" : "draft",
    },
  };
}

/** АР/АП баримтыг ID, дугаар, эсвэл externalRef-ээр олно. */
async function findArapDocument(userId: string, idOrNo: string) {
  const documents = await db.query.arApDocuments.findMany({
    where: eq(arApDocuments.userId, userId),
    orderBy: [desc(arApDocuments.createdAt)],
    limit: 1000,
  });
  const query = idOrNo.trim().toLowerCase();
  const byNo = documents.filter((doc) => doc.documentNo.toLowerCase() === query);
  if (byNo.length === 1) return byNo[0];
  const byRef = documents.filter(
    (doc) => query.length > 0 && (doc.externalRef ?? "").toLowerCase() === query
  );
  if (byRef.length === 1) return byRef[0];
  return resolveByIdPrefix(documents, idOrNo, "нэхэмжлэх");
}

async function runSendInvoiceEmail(
  userId: string,
  input: { documentId: string; to?: string }
): Promise<AiToolResult> {
  const document = await findArapDocument(userId, input.documentId);
  let recipient = input.to?.trim();
  if (!recipient) {
    const counterparty = await db.query.counterparties.findFirst({
      where: and(
        eq(counterparties.id, document.counterpartyId),
        eq(counterparties.userId, userId)
      ),
      columns: { name: true, email: true },
    });
    recipient = counterparty?.email ?? undefined;
    if (!recipient)
      throw codedError(
        "EMAIL_MISSING",
        `"${counterparty?.name ?? "?"}" харилцагчид и-мэйл бүртгэгдээгүй — update_counterparty-гаар и-мэйл нэмэх эсвэл to параметр өгнө үү`
      );
  }
  // sendInvoiceEmail өөрөө "зөвхөн posted АР нэхэмжлэх" дүрмээ шалгана.
  const result = await sendInvoiceEmail(document.id, recipient);
  return {
    resultText: `Нэхэмжлэх и-мэйлээр илгээгдлээ: ${result.documentNo} → ${result.sentTo} (PDF хавсралт + онлайн линктэй)`,
  };
}

async function runCreateInvoiceLink(
  userId: string,
  input: { documentId: string }
): Promise<AiToolResult> {
  const document = await findArapDocument(userId, input.documentId);
  const { url } = await createInvoiceLink(document.id);
  return {
    resultText: `Нэхэмжлэхийн public линк үүслээ: ${document.documentNo} → ${url}`,
  };
}

async function runDeleteArap(
  userId: string,
  input: { documentId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const documents = await db.query.arApDocuments.findMany({
    where: eq(arApDocuments.userId, userId),
    columns: { id: true, status: true, documentNo: true, date: true, totalAmount: true },
    orderBy: [desc(arApDocuments.createdAt)],
    limit: 500,
  });
  const byNo = documents.filter(
    (doc) => doc.documentNo.toLowerCase() === input.documentId.trim().toLowerCase()
  );
  const document =
    byNo.length === 1
      ? byNo[0]
      : resolveByIdPrefix(documents, input.documentId, "нэхэмжлэх");
  // Батлагдсан бичилтийг устгах нь эргэлт буцалтгүй — зөвхөн "Шууд бичих"
  // горимд зөвшөөрнө (ноорог устгалт аль ч горимд чөлөөтэй).
  if (document.status !== "draft") assertPostMode(mode);
  await deleteArApDocument(document.id);
  return {
    resultText: `Ноорог нэхэмжлэх устгагдлаа: ${document.date} · ${document.documentNo} · ${fmt(Number(document.totalAmount))}₮`,
  };
}

// Хугацааны задаргааны багцууд (asOf − dueDate хоногоор).
const AGING_BUCKETS = [
  { label: "хугацаа болоогүй", min: -Infinity, max: -1 },
  { label: "0-30", min: 0, max: 30 },
  { label: "31-60", min: 31, max: 60 },
  { label: "61-90", min: 61, max: 90 },
  { label: "90+", min: 91, max: Infinity },
] as const;

async function runCounterpartyBalance(
  userId: string,
  input: { counterparty?: string; asOf?: string; aging?: boolean }
): Promise<AiToolResult> {
  const asOf = input.asOf?.trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf))
    throw new Error("asOf огноо YYYY-MM-DD форматтай байна");

  const [documents, settlements] = await Promise.all([
    db.query.arApDocuments.findMany({
      where: eq(arApDocuments.userId, userId),
      with: { counterparty: { columns: { id: true, name: true } } },
    }),
    db.query.arApSettlements.findMany({
      where: eq(arApSettlements.userId, userId),
    }),
  ]);
  // asOf-оор түүхэн үлдэгдэл: paidAmount биш settlement-ийн огноогоор тоолно.
  const paidAsOf = new Map<string, number>();
  for (const settlement of settlements) {
    if (settlement.settlementDate > asOf) continue;
    paidAsOf.set(
      settlement.documentId,
      (paidAsOf.get(settlement.documentId) ?? 0) + Number(settlement.amount)
    );
  }

  const cpQuery = input.counterparty?.trim().toLowerCase();
  const open = documents.filter((doc) => {
    if (doc.status === "draft" || doc.status === "reversed") return false;
    if (doc.date > asOf) return false;
    if (cpQuery && !(doc.counterparty?.name ?? "").toLowerCase().includes(cpQuery))
      return false;
    const balance = Number(doc.totalAmount) - (paidAsOf.get(doc.id) ?? 0);
    return balance > 0.01;
  });
  if (open.length === 0)
    return {
      resultText: `${asOf}-ны байдлаар ${cpQuery ? `"${input.counterparty}" харилцагчид` : ""} үлдэгдэлтэй нэхэмжлэх алга`,
    };

  const daysOverdue = (dueDate: string) =>
    Math.floor(
      (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000
    );
  const bucketOf = (dueDate: string) => {
    const days = daysOverdue(dueDate);
    return AGING_BUCKETS.find((bucket) => days >= bucket.min && days <= bucket.max)!;
  };

  const sections: string[] = [];
  for (const documentType of ["ar_invoice", "ap_bill"] as const) {
    const docs = open.filter((doc) => doc.documentType === documentType);
    if (docs.length === 0) continue;
    const label = documentType === "ar_invoice" ? "АВЛАГА" : "ӨГЛӨГ";
    const byCp = new Map<string, typeof docs>();
    for (const doc of docs) {
      const key = doc.counterparty?.name ?? "?";
      byCp.set(key, [...(byCp.get(key) ?? []), doc]);
    }
    const lines: string[] = [];
    let sectionTotal = 0;
    for (const [cpName, cpDocs] of [...byCp.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      const cpTotal = cpDocs.reduce(
        (sum, doc) => sum + Number(doc.totalAmount) - (paidAsOf.get(doc.id) ?? 0),
        0
      );
      sectionTotal += cpTotal;
      lines.push(`  ${cpName} — ${fmt(cpTotal)}₮`);
      for (const doc of cpDocs) {
        const balance = Number(doc.totalAmount) - (paidAsOf.get(doc.id) ?? 0);
        const partial = balance < Number(doc.totalAmount) - 0.01 ? ", хэсэгчилсэн" : "";
        lines.push(
          `    ${doc.date} · ${doc.documentNo} · үлдэгдэл ${fmt(balance)}₮${partial}${input.aging ? ` · ${bucketOf(doc.dueDate).label}` : ""}`
        );
      }
    }
    if (input.aging) {
      const bucketTotals = AGING_BUCKETS.map((bucket) => ({
        bucket,
        total: docs
          .filter((doc) => bucketOf(doc.dueDate) === bucket)
          .reduce(
            (sum, doc) => sum + Number(doc.totalAmount) - (paidAsOf.get(doc.id) ?? 0),
            0
          ),
      })).filter((entry) => entry.total > 0.01);
      lines.push(
        `  Задаргаа: ${bucketTotals.map((entry) => `${entry.bucket.label} ${fmt(entry.total)}₮`).join(" · ")}`
      );
    }
    sections.push(`${label} (${asOf}-ны байдлаар): нийт ${fmt(sectionTotal)}₮\n${lines.join("\n")}`);
  }
  return { resultText: sections.join("\n\n") };
}

// ── Batch (бөөн оруулалт) гүйцэтгэгчид ──────────────────────────────────────

/** Partial success: мөр бүр тусдаа — нэг мөрийн алдаа бусдыг унагахгүй (спек §9). */
async function runCreateBatch(
  items: unknown[] | undefined,
  runOne: (item: unknown, index: number) => Promise<AiToolResult>
): Promise<AiToolResult> {
  if (!Array.isArray(items) || items.length === 0)
    throw new Error("items хоосон байна");
  if (items.length > 100) throw new Error("Нэг batch-д хамгийн ихдээ 100 мөр");
  const lines: string[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const [index, item] of items.entries()) {
    try {
      const result = await runOne(item, index);
      if (result.dedup) {
        skipped += 1;
        lines.push(`#${index} алгассан — ${result.resultText}`);
      } else {
        created += 1;
        lines.push(`#${index} үүссэн — ${result.resultText}`);
      }
    } catch (caught) {
      failed += 1;
      lines.push(`#${index} АЛДАА — ${errorText(caught)}`);
    }
  }
  return {
    resultText: [
      `Нийт ${items.length} · үүссэн ${created} · алгассан ${skipped} · алдаатай ${failed}`,
      ...lines,
    ].join("\n"),
  };
}

/** Бөөнөөр батлах: хязгаараас хэтэрсэн нь вэб дээрээс батлах жагсаалт болно (спек §10). */
async function runPostBatch(
  ids: string[] | undefined,
  mode: AiWriteMode,
  postOne: (id: string) => Promise<AiToolResult>
): Promise<AiToolResult> {
  assertPostMode(mode);
  if (!Array.isArray(ids) || ids.length === 0)
    throw new Error("ID-ийн жагсаалт хоосон байна");
  if (ids.length > 100) throw new Error("Нэг batch-д хамгийн ихдээ 100 баримт");
  const lines: string[] = [];
  const needsManual: string[] = [];
  let posted = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const result = await postOne(String(id));
      posted += 1;
      lines.push(`${id} батлагдсан — ${result.resultText}`);
    } catch (caught) {
      const message = errorText(caught);
      failed += 1;
      if (message.startsWith("[AMOUNT_LIMIT_EXCEEDED]")) needsManual.push(String(id));
      lines.push(`${id} АЛДАА — ${message}`);
    }
  }
  const summary = [
    `Нийт ${ids.length} · батлагдсан ${posted} · алдаатай ${failed}`,
    ...lines,
  ];
  if (needsManual.length > 0)
    summary.push(
      `Вэб дээрээс нягтланч батлах шаардлагатай (${fmt(AI_POST_LIMIT_MNT)}₮-с их): ${needsManual.join(", ")}`
    );
  return { resultText: summary.join("\n") };
}

// ── Касс нэмэлт гүйцэтгэгчид ────────────────────────────────────────────────

async function runListCashDocuments(
  userId: string,
  input: {
    documentType?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
  }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const documents = await db.query.cashDocuments.findMany({
    where: eq(cashDocuments.userId, userId),
    orderBy: [desc(cashDocuments.date), desc(cashDocuments.createdAt)],
    limit: 400,
  });
  const typeLabels: Record<string, string> = {
    receipt: "орлого",
    payment: "зарлага",
    transfer: "шилжүүлэг",
  };
  const filtered = documents
    .filter((doc) => {
      if (input.documentType && doc.documentType !== input.documentType) return false;
      if (input.status && doc.status !== input.status) return false;
      if (input.from && doc.date < input.from) return false;
      if (input.to && doc.date > input.to) return false;
      return true;
    })
    .slice(0, limit);
  if (filtered.length === 0) return { resultText: "Тохирох баримт олдсонгүй" };
  return {
    resultText: filtered
      .map(
        (doc) =>
          `${doc.date} · ${doc.documentNo} · ${typeLabels[doc.documentType] ?? doc.documentType} · ${doc.description} · ${fmt(Number(doc.amount))} · ${doc.status} · ID ${doc.id.slice(0, 8)}${doc.externalRef ? ` · ref ${doc.externalRef}` : ""}`
      )
      .join("\n"),
  };
}

async function runReverseCash(
  userId: string,
  input: { documentId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const documents = await db.query.cashDocuments.findMany({
    where: eq(cashDocuments.userId, userId),
    columns: { id: true, status: true, description: true, date: true, amount: true, baseAmount: true },
    orderBy: [desc(cashDocuments.createdAt)],
    limit: 500,
  });
  const document = resolveByIdPrefix(documents, input.documentId, "кассын баримт");
  if (document.status !== "posted")
    throw new Error(`Зөвхөн батлагдсан баримтыг буцаана (төлөв: ${document.status})`);
  assertPostLimit(Number(document.baseAmount ?? document.amount));
  await reverseCashDocument(document.id);
  return {
    resultText: `Кассын баримт буцаагдлаа (сторно журнал үүссэн): ${document.date} · ${document.description}`,
  };
}

// ── Бараа материал нэмэлт гүйцэтгэгчид ──────────────────────────────────────

async function runListMovements(
  userId: string,
  input: { status?: string; limit?: number }
): Promise<AiToolResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
  const movements = await db.query.inventoryMovements.findMany({
    where: eq(inventoryMovements.userId, userId),
    with: {
      item: { columns: { code: true, name: true } },
      warehouse: { columns: { code: true } },
    },
    orderBy: [desc(inventoryMovements.date), desc(inventoryMovements.createdAt)],
    limit: 400,
  });
  const typeLabels: Record<string, string> = {
    receipt: "орлого",
    issue: "зарлага",
    transfer: "шилжүүлэг",
    adjustment: "тохируулга",
    return_in: "буцаан авалт",
    return_out: "буцаалт",
  };
  const filtered = movements
    .filter((movement) => !input.status || movement.status === input.status)
    .slice(0, limit);
  if (filtered.length === 0) return { resultText: "Тохирох хөдөлгөөн олдсонгүй" };
  return {
    resultText: filtered
      .map(
        (movement) =>
          `${movement.date} · ${typeLabels[movement.movementType] ?? movement.movementType} · ${movement.item?.code ?? "(бараагүй)"} × ${Number(movement.quantity)} · ${movement.warehouse?.code ?? "?"} · ${movement.status} · ID ${movement.id.slice(0, 8)}`
      )
      .join("\n"),
  };
}

async function runConfirmMovement(
  userId: string,
  input: { movementId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const movements = await db.query.inventoryMovements.findMany({
    where: eq(inventoryMovements.userId, userId),
    columns: { id: true, status: true, documentNo: true },
    orderBy: [desc(inventoryMovements.createdAt)],
    limit: 500,
  });
  const movement = resolveByIdPrefix(movements, input.movementId, "хөдөлгөөн");
  if (movement.status !== "draft")
    throw new Error(`Зөвхөн ноорог хөдөлгөөнийг баталгаажуулна (төлөв: ${movement.status})`);
  await confirmInventoryMovement(movement.id);
  return {
    resultText: `Хөдөлгөөн баталгаажлаа: ${movement.documentNo}. Өртгийн үнэлгээ сар хаахад хийгдэнэ.`,
  };
}

async function runDeleteMovement(
  userId: string,
  input: { movementId: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  const movements = await db.query.inventoryMovements.findMany({
    where: eq(inventoryMovements.userId, userId),
    columns: { id: true, status: true, documentNo: true },
    orderBy: [desc(inventoryMovements.createdAt)],
    limit: 500,
  });
  const movement = resolveByIdPrefix(movements, input.movementId, "хөдөлгөөн");
  if (movement.status !== "draft") assertPostMode(mode);
  await deleteInventoryMovement(movement.id);
  return { resultText: `Ноорог хөдөлгөөн устгагдлаа: ${movement.documentNo}` };
}

async function runGetStockBalances(
  userId: string,
  input: { itemCode?: string; warehouseCode?: string }
): Promise<AiToolResult> {
  const [movements, items, whList] = await Promise.all([
    db.query.inventoryMovements.findMany({
      where: and(
        eq(inventoryMovements.userId, userId),
        eq(inventoryMovements.status, "confirmed")
      ),
    }),
    db.query.inventoryItems.findMany({ where: eq(inventoryItems.userId, userId) }),
    db.query.warehouses.findMany({ where: eq(warehouses.userId, userId) }),
  ]);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const whById = new Map(whList.map((wh) => [wh.id, wh]));

  // item|warehouse → үлдэгдэл (transfer нь гарах талдаа хасагдаж, орох
  // талдаа нэмэгдэнэ).
  const balances = new Map<string, number>();
  for (const movement of movements) {
    if (!movement.itemId || !movement.warehouseId) continue;
    const qty = Number(movement.quantity);
    const add = (warehouseId: string, delta: number) => {
      const key = `${movement.itemId}|${warehouseId}`;
      balances.set(key, Math.round(((balances.get(key) ?? 0) + delta) * 10000) / 10000);
    };
    if (movement.movementType === "transfer" && movement.toWarehouseId) {
      add(movement.warehouseId, -qty);
      add(movement.toWarehouseId, qty);
    } else if (["receipt", "return_in"].includes(movement.movementType)) {
      add(movement.warehouseId, qty);
    } else if (["issue", "return_out"].includes(movement.movementType)) {
      add(movement.warehouseId, -qty);
    } else {
      // adjustment — тэмдэгтэйгээ (+ илүүдэл, − дутагдал).
      add(movement.warehouseId, qty);
    }
  }

  const rows = [...balances.entries()]
    .map(([key, qty]) => {
      const [itemId, warehouseId] = key.split("|");
      const item = itemById.get(itemId);
      const wh = whById.get(warehouseId);
      return { item, wh, qty };
    })
    .filter(
      (row) =>
        row.item &&
        row.wh &&
        (!input.itemCode ||
          row.item.code.toLowerCase().includes(input.itemCode.toLowerCase())) &&
        (!input.warehouseCode ||
          row.wh.code.toLowerCase().includes(input.warehouseCode.toLowerCase()))
    )
    .filter((row) => row.qty !== 0);
  if (rows.length === 0) return { resultText: "Үлдэгдэл олдсонгүй" };
  return {
    resultText: rows
      .slice(0, 100)
      .map((row) => `${row.item!.code} (${row.item!.name}) · ${row.wh!.code} · ${row.qty}`)
      .join("\n"),
  };
}

// ── Үндсэн хөрөнгө нэмэлт гүйцэтгэгчид ──────────────────────────────────────

async function runListFixedAssets(
  userId: string,
  input: { status?: string }
): Promise<AiToolResult> {
  const assets = await db.query.fixedAssets.findMany({
    where: eq(fixedAssets.userId, userId),
    orderBy: [desc(fixedAssets.createdAt)],
    limit: 200,
  });
  const filtered = assets.filter(
    (asset) => !input.status || asset.status === input.status
  );
  if (filtered.length === 0) return { resultText: "Хөрөнгө олдсонгүй" };
  return {
    resultText: filtered
      .map(
        (asset) =>
          `${asset.code} · ${asset.name} · өртөг ${fmt(Number(asset.cost))} · ${asset.usefulLifeMonths} сар · ${asset.status}`
      )
      .join("\n"),
  };
}

async function runFaDepreciation(
  _userId: string,
  input: { month: string }
): Promise<AiToolResult> {
  const result = await runDepreciation({ month: input.month });
  return {
    resultText:
      result.created === 0
        ? `${input.month} сард шинээр бодох элэгдэл алга (бүгд бодогдсон эсвэл идэвхтэй хөрөнгө байхгүй)`
        : `${input.month} сарын элэгдэл: ${result.created} хөрөнгөд НООРОГ бичилт үүслээ — /fa/depreciation дээрээс шалгаж батлана`,
  };
}

async function runPostFaDepreciation(
  userId: string,
  input: { month: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const entries = await db.query.faDepreciationEntries.findMany({
    where: and(
      eq(faDepreciationEntries.userId, userId),
      eq(faDepreciationEntries.periodMonth, input.month),
      eq(faDepreciationEntries.status, "draft")
    ),
    columns: { id: true, amount: true },
  });
  if (entries.length === 0)
    return { resultText: `${input.month} сард ноорог элэгдлийн бичилт алга` };
  const total = entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
  assertPostLimit(total);
  await postDepreciationEntries(entries.map((entry) => entry.id));
  return {
    resultText: `${input.month} сарын элэгдэл батлагдлаа: ${entries.length} бичилт, нийт ${fmt(total)}₮`,
  };
}

// ── Период гүйцэтгэгчид ─────────────────────────────────────────────────────

async function runListPeriods(): Promise<AiToolResult> {
  const periods = await listPeriods();
  if (periods.length === 0) return { resultText: "Тайлант үе бүртгэгдээгүй (бүх сар нээлттэй)" };
  return {
    resultText: periods
      .map(
        (period) =>
          `${period.code} · ${period.status === "closed" ? "ХААЛТТАЙ" : "нээлттэй"} · бичилт ${period.voucherCount} (ноорог ${period.draftVoucherCount})`
      )
      .join("\n"),
  };
}

async function runClosePeriod(
  _userId: string,
  input: { code: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const result = await closePeriod(input.code);
  if (!result.ok) {
    if (result.code === "has-drafts")
      throw new Error(
        `${input.code} сард ноорог бичилт үлдсэн тул хаагдахгүй — эхлээд ноорогуудыг батлах эсвэл устгана`
      );
    throw new Error(`Тайлант үе хаагдсангүй (${result.code})`);
  }
  return { resultText: `${input.code} тайлант үе ХААГДЛАА — цаашид энэ сар руу бичилт хийгдэхгүй` };
}

async function runReopenPeriod(
  _userId: string,
  input: { code: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  const result = await reopenPeriod(input.code);
  if (!result.ok) throw new Error(`Тайлант үе нээгдсэнгүй (${result.code})`);
  return { resultText: `${input.code} тайлант үе дахин НЭЭГДЛЭЭ` };
}

// ── Өртөг гүйцэтгэгчид ──────────────────────────────────────────────────────

async function runMonthlyCosting(
  _userId: string,
  input: { period: string }
): Promise<AiToolResult> {
  const result = await computeMonthlyCosting(input.period);
  if (!result.ok)
    throw new Error(result.message ?? `Өртөг тооцоо амжилтгүй (${result.code})`);
  const blockerText =
    result.blockers.length > 0
      ? `\nБЛОКЛОГДСОН (${result.blockers.length}): ${result.blockers
          .slice(0, 10)
          .map((blocker) => `${blocker.label} — ${blocker.reason}`)
          .join("; ")}`
      : "";
  return {
    resultText: `${input.period} сарын өртөг тооцогдлоо: шинээр үнэлэгдсэн ${result.valued}, өмнө нь үнэлэгдсэн ${result.alreadyValued}, тэг дүнтэй ${result.zeroValued}.${blockerText}`,
  };
}

async function runPostCostEntries(
  userId: string,
  input: { month: string },
  mode: AiWriteMode
): Promise<AiToolResult> {
  assertPostMode(mode);
  if (!/^\d{4}-\d{2}$/.test(input.month ?? ""))
    throw new Error("Сар YYYY-MM форматтай байх ёстой");
  const entries = await db.query.costEntries.findMany({
    where: and(eq(costEntries.userId, userId), eq(costEntries.status, "draft")),
    columns: { id: true, date: true, amount: true },
  });
  const monthEntries = entries.filter((entry) => entry.date.startsWith(input.month));
  if (monthEntries.length === 0)
    return { resultText: `${input.month} сард ноорог өртгийн бичилт алга` };
  const total = monthEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);
  assertPostLimit(total);
  const result = await postCostEntries(monthEntries.map((entry) => entry.id));
  const failures =
    "failures" in result && Array.isArray(result.failures) ? result.failures : [];
  return {
    resultText: `${input.month} сарын өртгийн бичилт: ${monthEntries.length - failures.length} батлагдав, нийт ${fmt(total)}₮${failures.length > 0 ? `; амжилтгүй ${failures.length}` : ""}`,
  };
}

async function runFixCashOpening(
  userId: string,
  input: { cashAccount: string; counterAccount?: string }
): Promise<AiToolResult> {
  const accounts = await db.query.cashAccounts.findMany({
    where: eq(cashAccounts.userId, userId),
  });
  const account = requireSingle(
    nameMatches(accounts, (entry) => entry.name, input.cashAccount),
    (entry) => entry.name,
    "мөнгөн данс",
    input.cashAccount
  );
  let counter: string | undefined;
  if (input.counterAccount) {
    const ctx = await accountContext(userId);
    counter = resolveAccount(input.counterAccount, ctx).main;
  }
  const result = await createCashOpeningVoucher({
    cashAccountId: account.id,
    counterAccountNumber: counter,
  });
  return {
    resultText: `Нээлтийн ноорог журнал үүслээ: ${account.name}, ${fmt(result.amount)}₮, харьцах данс ${result.counterAccountNumber}. Батлагдмагц тулгалтын зөрүү арилна.`,
    action: {
      kind: "voucher",
      id: result.id,
      title: `Нээлтийн үлдэгдэл — ${account.name}`,
      status: "draft",
    },
  };
}

// ── Тулгалт ─────────────────────────────────────────────────────────────────

/**
 * Журналын мөрүүдээс үндсэн данс бүрийн цэвэр үлдэгдэл (Дт−Кт).
 * "reversed" журнал GL-д тооцогдсон хэвээр (GL тайлантай ижил) — эх бичилт +
 * posted буцаалт нэт 0. Зөвхөн posted тоолбол буцаасан гүйлгээ бүр хий зөрүү
 * үзүүлдэг.
 */
async function glNetByMain(userId: string, upTo: string): Promise<Map<string, number>> {
  const vouchers = await db.query.journalVouchers.findMany({
    where: and(
      eq(journalVouchers.userId, userId),
      inArray(journalVouchers.status, ["posted", "reversed"])
    ),
    with: { lines: { columns: { accountNumber: true, debit: true, credit: true } } },
    columns: { date: true },
  });
  const net = new Map<string, number>();
  for (const voucher of vouchers) {
    if (voucher.date > upTo) continue;
    for (const line of voucher.lines) {
      const main = parseSegParts(line.accountNumber, [3])[3] ?? line.accountNumber;
      net.set(main, (net.get(main) ?? 0) + Number(line.debit) - Number(line.credit));
    }
  }
  return net;
}

async function runReconcileModules(
  userId: string,
  input: { from: string; to: string }
): Promise<AiToolResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(input.to ?? ""))
    throw new Error("from/to огноо YYYY-MM-DD форматтай байх ёстой");

  const EPS = 0.01;
  const sections: string[] = [];
  const problems: string[] = [];
  const glNet = await glNetByMain(userId, input.to);

  // 1. Касс/банк: GL данс vs модулийн үлдэгдэл (нээлт + батлагдсан баримт).
  {
    const [accounts, documents] = await Promise.all([
      db.query.cashAccounts.findMany({
        where: and(eq(cashAccounts.userId, userId), eq(cashAccounts.isActive, true)),
      }),
      db.query.cashDocuments.findMany({
        where: and(eq(cashDocuments.userId, userId), eq(cashDocuments.status, "posted")),
      }),
    ]);
    const moduleBalance = new Map<string, number>(
      accounts.map((account) => [account.id, Number(account.openingBalance ?? 0)])
    );
    for (const doc of documents) {
      if (doc.date > input.to) continue;
      const amount = Number(doc.baseAmount ?? doc.amount);
      if (doc.toCashAccountId)
        moduleBalance.set(doc.toCashAccountId, (moduleBalance.get(doc.toCashAccountId) ?? 0) + amount);
      if (doc.fromCashAccountId)
        moduleBalance.set(doc.fromCashAccountId, (moduleBalance.get(doc.fromCashAccountId) ?? 0) - amount);
    }
    const lines: string[] = [];
    for (const account of accounts) {
      const subledger = moduleBalance.get(account.id) ?? 0;
      const gl = glNet.get(account.glAccountNumber) ?? 0;
      const diff = Math.round((subledger - gl) * 100) / 100;
      if (Math.abs(diff) > EPS) {
        lines.push(
          `  ЗӨРҮҮ ${account.name}: модуль ${fmt(subledger)} vs GL(${account.glAccountNumber}) ${fmt(gl)} → зөрүү ${fmt(diff)}`
        );
        const opening = Number(account.openingBalance ?? 0);
        if (Math.abs(opening) > 0.005 && Math.abs(diff - opening) <= EPS)
          problems.push(
            `Касс "${account.name}": зөрүү нь НЭЭЛТИЙН үлдэгдэлтэй (${fmt(opening)}₮) тэнцүү — нээлтийн журнал GL-д бичигдээгүй. fix_cash_opening_balance tool-оор ноорог журнал үүсгээд батлана`
          );
        else
          problems.push(
            `Касс "${account.name}": ноорог кассын баримт батлагдаагүй, эсвэл GL-д гараар бичсэн бичилт байж магадгүй — list_cash_documents status=draft шалгаад батлах/устгах`
          );
      } else lines.push(`  OK ${account.name}: ${fmt(subledger)}`);
    }
    sections.push(`КАСС/БАНК (${input.to}-ний үлдэгдэл):\n${lines.join("\n") || "  данс алга"}`);
  }

  // 2. АР/АП: хяналтын данс vs нээлттэй баримтын үлдэгдэл.
  {
    const documents = await db.query.arApDocuments.findMany({
      where: eq(arApDocuments.userId, userId),
    });
    const open = documents.filter(
      (doc) =>
        ["posted", "partially_paid"].includes(doc.status) && doc.date <= input.to
    );
    const byControl = new Map<string, { type: string; sum: number }>();
    for (const doc of open) {
      const main =
        parseSegParts(doc.controlAccountNumber, [3])[3] ?? doc.controlAccountNumber;
      const balance = Number(doc.baseTotalAmount) - Number(doc.basePaidAmount);
      const slot = byControl.get(main) ?? { type: doc.documentType, sum: 0 };
      slot.sum += balance;
      byControl.set(main, slot);
    }
    const lines: string[] = [];
    for (const [main, slot] of byControl) {
      const gl = glNet.get(main) ?? 0;
      // АР дебет, АП кредит үлдэгдэлтэй — GL-ийн цэвэрийг тохирох тэмдэгтэй нь харна.
      const glSide = slot.type === "ar_invoice" ? gl : -gl;
      const diff = Math.round((slot.sum - glSide) * 100) / 100;
      if (Math.abs(diff) > EPS) {
        lines.push(
          `  ЗӨРҮҮ ${main}: нээлттэй баримтууд ${fmt(slot.sum)} vs GL ${fmt(glSide)} → зөрүү ${fmt(diff)}`
        );
        problems.push(
          `${slot.type === "ar_invoice" ? "Авлага" : "Өглөг"} ${main}: хяналтын дансанд гараар журнал бичсэн, эсвэл төлөлт нэхэмжлэхтэй холбогдоогүй байж магадгүй — get_trial_balance + list_arap_documents тулгах`
        );
      } else lines.push(`  OK ${main}: ${fmt(slot.sum)}`);
    }
    sections.push(`АВЛАГА/ӨГЛӨГ:\n${lines.join("\n") || "  нээлттэй баримт алга"}`);
  }

  // 3. Бараа материал: дэд дэвтрийн үнэлгээ vs GL (өртгийн тулгалтын тайлан).
  {
    const recon = await loadInventoryGlReconciliation(userId, {
      from: input.from,
      to: input.to,
    });
    const lines = recon.rows.map((row) =>
      Math.abs(row.difference) > EPS
        ? `  ЗӨРҮҮ ${row.accountNumber} ${row.accountName}: дэд дэвтэр ${fmt(row.subledgerAmount)} vs GL ${fmt(row.glAmount)} → ${fmt(row.difference)}${row.unlinkedGlLines > 0 ? ` (гараар бичсэн ${row.unlinkedGlLines} мөр ${fmt(row.unlinkedGlAmount)})` : ""}`
        : `  OK ${row.accountNumber} ${row.accountName}: ${fmt(row.glAmount)}`
    );
    for (const row of recon.rows)
      if (Math.abs(row.difference) > EPS)
        problems.push(
          `Бараа ${row.accountNumber}: өртгийн ноорог бичилт батлагдаагүй (${recon.pendingCount} хүлээгдэж буй, ${fmt(recon.pendingAmount)}₮) эсвэл run_monthly_costing ажиллаагүй — run_monthly_costing → post_cost_entries`
        );
    if (recon.pendingCount > 0)
      lines.push(`  Хүлээгдэж буй ноорог өртгийн бичилт: ${recon.pendingCount} (${fmt(recon.pendingAmount)}₮)`);
    sections.push(`БАРАА МАТЕРИАЛ (${input.from} — ${input.to}):\n${lines.join("\n") || "  тулгах данс алга"}`);
  }

  // 4. Клиринг: бизнес объектоор тулгаж хаагдаагүй үлдэгдлийг үзүүлнэ.
  {
    const clearing = await loadClearingReconciliation(userId, {
      from: input.from,
      to: input.to,
    });
    const openRows = clearing.rows.filter((row) => Math.abs(row.ending) > EPS);
    const lines = [
      ...openRows
        .slice(0, 15)
        .map(
          (row) =>
            `  ХААГДААГҮЙ ${row.account} · ${row.objectLabel}${row.componentLabel ? ` (${row.componentLabel})` : ""}: ${fmt(row.ending)}`
        ),
      ...(clearing.unknownCount > 0
        ? [`  ОБЪЕКТГҮЙ (гар журнал): ${clearing.unknownCount} мөр, ${fmt(clearing.unknownAmount)}₮`]
        : []),
    ];
    if (openRows.length > 0)
      problems.push(
        `Клиринг: ${openRows.length} объект хаагдаагүй — худалдан авалтын өртөг капиталжаагүй (run_monthly_costing → post_cost_entries) эсвэл орлого баталгаажаагүй байж магадгүй`
      );
    if (clearing.unknownCount > 0)
      problems.push(
        "Клирингийн дансанд объектгүй гар журнал бий — эдгээрийг олж буцаах эсвэл зөв дансанд шилжүүлэх"
      );
    sections.push(`КЛИРИНГ (${input.from} — ${input.to}):\n${lines.join("\n") || "  бүгд хаагдсан"}`);
  }

  return {
    resultText: [
      ...sections,
      problems.length === 0
        ? "\n✓ Модуль хоорондын зөрүү илрээгүй."
        : `\nИЛЭРСЭН АСУУДАЛ (${problems.length}):\n${problems.map((problem, index) => `${index + 1}. ${problem}`).join("\n")}`,
    ].join("\n\n"),
  };
}

// ── Ажлын урсгалын заавар ───────────────────────────────────────────────────

const WORKFLOW_GUIDES: Record<string, string> = {
  purchase_inventory: `БАРААТАЙ ХУДАЛДАН АВАЛТ — зөв дараалал:
1. list_counterparties / list_inventory — нийлүүлэгч, барааны кодоо шалгах (байхгүй бол create_counterparty / create_inventory_item)
2. create_arap_invoice (ap_bill, бараатай мөрөнд itemCode+quantity+warehouseCode) — данс автоматаар клирингт суана
3. post_arap_document — батлахад: GL-д Кт өглөг бичигдэж, бараа ОРЛОГЫН НООРОГ хөдөлгөөн автоматаар үүснэ
4. confirm_inventory_movement — орлого баталгаажиж үлдэгдэлд орно (өртөг нь худалдан авалтын үнээр шууд капиталжина)
5. Төлбөр: pay_arap_document (касс автоматаар холбогдоно)
Сар дуусахад run_monthly_costing клирингээс бараанд капиталжуулна — reconcile_modules-оор шалгана.`,
  sale: `БОРЛУУЛАЛТ — зөв дараалал:
1. create_arap_invoice (ar_invoice) — орлогын данс мөрөнд (51100000), бараатай бол itemCode+quantity+warehouseCode
2. post_arap_document — GL-д Дт авлага/Кт орлого бичигдэж, бараа ЗАРЛАГЫН НООРОГ үүснэ
3. confirm_inventory_movement — зарлага баталгаажина (тоо хэмжээ хасагдана; ӨРТӨГ нь сар хаахад сарын дундажаар COGS болно)
4. Төлбөр ирэхэд: pay_arap_document (орлогын кассын баримт үүснэ)
5. Сар хаалтад: run_monthly_costing → post_cost_entries — COGS бичигдэнэ
НӨАТ-тай бол: авлага = нийт, орлого = нийт/1.1, НӨАТ өглөг 31410000 = нийт×10/110 гэж мөр хуваана.`,
  payment: `НЭХЭМЖЛЭХ ТӨЛӨХ/ХААХ:
1. list_arap_documents status=posted (эсвэл partially_paid) — үлдэгдэлтэй баримтаа олох
2. list_cash_accounts — аль данснаас/данс руу
3. pay_arap_document {documentId, cashAccount, date, amount?} — amount өгөхгүй бол үлдэгдлээр бүтэн хаана; АР=орлого, АП=зарлага автоматаар
Кассын баримт нэхэмжлэхтэй холбогдож үлдэгдэл автоматаар хасагдана.`,
  month_end_close: `САР ХААЛТ — ЗААВАЛ энэ дарааллаар (сар: YYYY-MM):
1. list_journal_vouchers status=draft + list_cash_documents status=draft + list_inventory_movements status=draft — ноорогуудыг цэгцлэх (батлах эсвэл устгах; ноорог үлдвэл тайлант үе хаагдахгүй)
2. run_fa_depreciation {month} — элэгдэл бодох → post_fa_depreciation {month}
3. run_monthly_costing {period} — зарлага/тохируулгыг сарын дундажаар үнэлэх; блоклогдсон бараа гарвал шалтгааныг нь шийдэж ДАХИН ажиллуулах
4. post_cost_entries {month} — өртгийн бичилтүүд GL-д
5. reconcile_modules {from: сарын 1, to: сарын сүүлч} — зөрүү 0 болтол засах
6. get_trial_balance — эцсийн шалгалт (ΣДт=ΣКт)
7. close_period {code} — хаах
Алхам бүрийн үр дүнг хэрэглэгчид тайлагнаж, дараагийнхыг эхлэхийн өмнө бататгана.`,
  fix_discrepancy: `ЗӨРҮҮ ЗАСАХ — оношилгооны дараалал:
1. reconcile_modules — аль модульд, ямар дансанд, хэдээр зөрж байгааг тогтоох
2. Шалтгаан бүрийн засвар:
   - Касс зөрүү → list_cash_documents status=draft: батлагдаагүй баримт батлах/устгах; GL-д гараар бичсэн кассын бичилт байвал reverse_journal_voucher
   - АР/АП зөрүү → төлөлт нэхэмжлэхгүй бүртгэгдсэн (гар журнал) эсвэл нэхэмжлэх GL-гүй; get_trial_balance + list_arap_documents мөр мөрөөр тулгах
   - Бараа зөрүү → run_monthly_costing ажиллуулаагүй эсвэл post_cost_entries хийгээгүй; блоклогдсон бараа (өртөггүй орлого) байвал эх баримтыг нь засах
   - Клиринг хаагдаагүй → орлого capitalize хийгдээгүй (сар хаалт хүлээж буй бол хэвийн); объектгүй гар журналыг олж буцаах
3. Засвар бүрийн дараа reconcile_modules ДАХИН ажиллуулж 0 болсныг бататгах
Гараар тохируулгын журнал бичихээс ӨМНӨ эх баримтаар нь засахыг үргэлж эрмэлзэнэ.`,
  new_company_setup: `ШИНЭ КОМПАНИЙН ТОХИРГОО — дараалал:
1. list_gl_accounts — стандарт дансны мод байгаа эсэхийг шалгах; дутууг create_gl_account
2. create_cash_account — касс, банкны данснууд (нээлтийн үлдэгдэлтэй нь)
3. create_counterparty — үндсэн харилцагчид (default данс, нөхцөлтэй нь)
4. create_warehouse + create_inventory_item — агуулах, бараанууд
5. Эхний үлдэгдлүүд: create_journal_voucher-оор нээлтийн баланс (харьцах данс нь эздийн өмч 4XXXXXXX)
6. get_trial_balance — нээлтийн баланс тэнцэж буйг шалгах`,
  fixed_asset_lifecycle: `ҮНДСЭН ХӨРӨНГИЙН МӨЧЛӨГ:
1. Худалдан авалт: create_arap_invoice (ap_bill, хөрөнгийн данс 21XXXXXX мөртэй) → post — ноорог ҮХ карт автоматаар үүснэ; ЭСВЭЛ create_fixed_asset-ээр шууд
2. activate_fixed_asset — картыг бөглөж идэвхжүүлэх (хариуцагч, элэгдэл эхлэх сар заавал)
3. Сар бүр: run_fa_depreciation {month} → post_fa_depreciation {month} (Дт 70000001 / Кт 21000099)
4. Алдаатай бол: reverse_fa_depreciation {month}
Анхаар: актлах/борлуулах (disposal) функц системд одоогоор байхгүй — гарын журналаар шийдэж, хөрөнгөө идэвхгүй болгохыг хэрэглэгчид зөвлө.`,
};

function runWorkflowGuide(input: { workflow: string }): AiToolResult {
  const guide = WORKFLOW_GUIDES[input.workflow];
  if (!guide)
    return {
      resultText: `Ийм урсгал алга. Боломжит: ${Object.keys(WORKFLOW_GUIDES).join(", ")}`,
    };
  return { resultText: guide };
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
        return await runDeleteJournal(userId, args, mode);
      case "post_cash_document":
        return await runPostCash(userId, args, mode);
      case "delete_cash_document":
        return await runDeleteCash(userId, args, mode);
      case "post_arap_document":
        return await runPostArap(userId, args, mode);
      case "list_gl_accounts":
        return await runListGlAccounts(userId, args);
      case "list_cash_accounts":
        return await runListCashAccounts(userId);
      case "list_journal_vouchers":
        return await runListJournalVouchers(userId, args);
      case "create_gl_account":
        return await runCreateGlAccount(userId, args);
      case "create_counterparty":
        return await runCreateCounterparty(userId, args);
      case "create_inventory_item":
        return await runCreateItem(userId, args);
      case "create_warehouse":
        return await runCreateWarehouse(userId, args);
      case "update_counterparty":
        return await runUpdateCounterparty(userId, args);
      case "update_inventory_item":
        return await runUpdateItem(userId, args);
      case "update_inventory_movement":
        return await runUpdateMovement(userId, args);
      case "record_inventory_count":
        return await runRecordCount(userId, args);
      case "create_cash_account":
        return await runCreateCashAccount(userId, args);
      case "activate_fixed_asset":
        return await runActivateFixedAsset(userId, args);
      case "delete_fixed_asset":
        return await runDeleteFixedAsset(userId, args, mode);
      case "reverse_fa_depreciation":
        return await runReverseFaDepreciation(userId, args, mode);
      case "get_journal_voucher":
        return await runGetJournal(userId, args);
      case "update_journal_voucher":
        return await runUpdateJournal(userId, args);
      case "reverse_journal_voucher":
        return await runReverseJournal(userId, args, mode);
      case "get_trial_balance":
        return await runGetTrialBalance(userId, args);
      case "get_income_statement":
        return await runIncomeStatement(userId, args);
      case "get_balance_sheet":
        return await runBalanceSheet(userId, args);
      case "get_cash_flow":
        return await runCashFlow(userId, args);
      case "get_account_ledger":
        return await runAccountLedger(userId, args);
      case "create_year_end_closing":
        return await runYearEndClosing(userId, args);
      case "list_arap_documents":
        return await runListArapDocuments(userId, args);
      case "delete_arap_document":
        return await runDeleteArap(userId, args, mode);
      case "send_invoice_email":
        return await runSendInvoiceEmail(userId, args);
      case "create_invoice_link":
        return await runCreateInvoiceLink(userId, args);
      case "get_counterparty_balance":
        return await runCounterpartyBalance(userId, args);
      case "pay_arap_document":
        return await runPayArap(userId, args, mode);
      case "list_cash_documents":
        return await runListCashDocuments(userId, args);
      case "reverse_cash_document":
        return await runReverseCash(userId, args, mode);
      case "list_inventory_movements":
        return await runListMovements(userId, args);
      case "confirm_inventory_movement":
        return await runConfirmMovement(userId, args, mode);
      case "delete_inventory_movement":
        return await runDeleteMovement(userId, args, mode);
      case "get_stock_balances":
        return await runGetStockBalances(userId, args);
      case "list_fixed_assets":
        return await runListFixedAssets(userId, args);
      case "run_fa_depreciation":
        return await runFaDepreciation(userId, args);
      case "post_fa_depreciation":
        return await runPostFaDepreciation(userId, args, mode);
      case "list_periods":
        return await runListPeriods();
      case "close_period":
        return await runClosePeriod(userId, args, mode);
      case "reopen_period":
        return await runReopenPeriod(userId, args, mode);
      case "run_monthly_costing":
        return await runMonthlyCosting(userId, args);
      case "post_cost_entries":
        return await runPostCostEntries(userId, args, mode);
      case "fix_cash_opening_balance":
        return await runFixCashOpening(userId, args);
      case "reconcile_modules":
        return await runReconcileModules(userId, args);
      case "get_workflow_guide":
        return runWorkflowGuide(args);
      case "create_counterparties_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateCounterparty(userId, item as Parameters<typeof runCreateCounterparty>[1])
        );
      case "create_arap_invoices_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateArap(userId, item as Parameters<typeof runCreateArap>[1], mode)
        );
      case "create_cash_transactions_batch":
        return await runCreateBatch(args.items, (item) =>
          runCreateCash(userId, item as Parameters<typeof runCreateCash>[1], mode)
        );
      case "post_arap_documents_batch":
        return await runPostBatch(args.documentIds, mode, (id) =>
          runPostArap(userId, { documentId: id }, mode)
        );
      case "post_cash_documents_batch":
        return await runPostBatch(args.documentIds, mode, (id) =>
          runPostCash(userId, { documentId: id }, mode)
        );
      case "post_journal_vouchers_batch":
        return await runPostBatch(args.voucherIds, mode, (id) =>
          runPostJournal(userId, { voucherId: id }, mode)
        );
      default:
        return { resultText: `"${name}" гэдэг tool байхгүй` };
    }
  } catch (caught) {
    return { resultText: `Алдаа: ${errorText(caught)}` };
  }
}
