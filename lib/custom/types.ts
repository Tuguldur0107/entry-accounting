// custom/ өргөтгөлийн давхаргын төрлүүд — fork хийсэн хэрэглэгч core-д гар
// хүрэлгүй системээ өргөтгөх ЦОРЫН ГАНЦ гэрээ (docs/opensource/02).
//
// Хоёр хатуу дүрэм:
//   1. Хэрэглэгч зөвхөн custom/ дотор ажиллана
//   2. Upstream (core) custom/ дотор хэзээ ч бичихгүй
// Энэ файл бол core; custom/ талаас зөвхөн import хийнэ.

import type { AiToolDef, AiToolResult } from "@/lib/ai/tools";
import type { AiWriteMode } from "@/lib/ai/models";

/** Custom tool-ийн гүйцэтгэх контекст — MCP/чат хоёуланд ижил. */
export interface CustomToolContext {
  orgId: string;
  userId: string;
  /** Хэрэглэгчийн сонгосон бичилтийн горим (ноорог / шууд бичих). */
  mode: AiWriteMode;
}

/**
 * Custom AI/MCP tool. Core tools-той ИЖИЛ JSON schema; execute нь алдаа
 * шидвэл модель/MCP клиентэд "Алдаа: <текст>" болж буцна — ШИДЭЖ болно.
 * Нэр: ^[a-z][a-z0-9_]{2,63}$, core tool нэртэй давхцахгүй.
 */
export interface CustomTool extends AiToolDef {
  execute: (ctx: CustomToolContext, input: unknown) => Promise<AiToolResult>;
}

export type HookResult = { ok: true } | { ok: false; reason: string };

export interface JournalHookLine {
  account: string;
  debit: number;
  credit: number;
  description: string;
}

/** Журнал батлагдахын өмнө/дараах hook-ийн контекст. */
export interface JournalHookContext {
  orgId: string;
  userId: string;
  voucherId: string;
  date: string;
  description: string;
  lines: JournalHookLine[];
  totalDebit: number;
  /** post — ноорог батлагдаж байна; create_posted — шууд бичигдэж байна. */
  source: "post" | "create_posted";
}

export interface PeriodHookContext {
  orgId: string;
  userId: string;
  /** YYYY-MM */
  code: string;
  startDate: string;
  endDate: string;
}

export interface CustomHooks {
  /**
   * Журналын баланс, периодын хамгаалалт, эрхийн шалгалт БҮГД ажилласны
   * ДАРАА, транзакц дотор дуудагдана. {ok:false} буцаавал post зогсоно,
   * reason нь хэрэглэгчид монголоор харагдана. Байгаа хоригийг сулруулж
   * ЧАДАХГҮЙ — зөвхөн нэмэлт хориг.
   */
  beforeJournalPost?: (ctx: JournalHookContext) => Promise<HookResult>;
  /** Commit-ийн ДАРАА (webhook, sync г.м). Алдаа нь бичилтийг унагахгүй — логлогдоно. */
  afterJournalPost?: (ctx: JournalHookContext) => Promise<void>;
  /** Ноорог тооллого дууссаны дараа, хаалтын транзакц дотор. */
  beforePeriodClose?: (ctx: PeriodHookContext) => Promise<HookResult>;
}

/** Нэг багц (custom/packages/<name>) эсвэл custom/index.ts-ийн нийлбэр. */
export interface EntryCustomization {
  /** /settings/system хуудсанд харагдах нэр, хувилбар (сонголтоор). */
  name?: string;
  version?: string;
  tools?: CustomTool[];
  hooks?: CustomHooks;
}
