// custom/ өргөтгөлийн ачаалагч — core нь ЗӨВХӨН энэ файлаар custom/-той
// харьцана (custom/index.ts-ийн `customization` export).
//
// Build-time registry: Next.js-д дурын хавтас runtime-д dynamic import
// хийх найдваргүй тул custom/index.ts нэг entrypoint-оор бүгдийг export
// хийнэ. Шалгалт нэг л удаа (эхний хандалтад) хийгдэж, алдаатай бол
// монгол текстээр шидэгдэнэ — core эвдэрсэн байдалтай ажиллахгүй.

import type { AiToolDef, AiToolResult } from "@/lib/ai/tools";
import { customization } from "@/custom";

import type {
  CustomTool,
  CustomToolContext,
  EntryCustomization,
  HookResult,
  JournalHookContext,
  PeriodHookContext,
} from "./types";
import { validateCustomization } from "./validate";

let validated: EntryCustomization | null = null;

/** Core tool нэрсийг loader өөрөө import хийвэл цикл үүсдэг тул tools.ts дамжуулна. */
export function getCustomization(coreToolNames?: Iterable<string>): EntryCustomization {
  if (validated) return validated;
  const errors = validateCustomization(customization, coreToolNames ?? []);
  if (errors.length > 0)
    throw new Error(
      `custom/index.ts буруу бүртгэлтэй:\n - ${errors.join("\n - ")}\n(custom/CLAUDE.md-г уншина уу)`
    );
  validated = customization;
  return validated;
}

export function customToolDefs(coreToolNames: Iterable<string>): AiToolDef[] {
  return (getCustomization(coreToolNames).tools ?? []).map(
    ({ name, description, inputSchema }) => ({ name, description, inputSchema })
  );
}

export function findCustomTool(name: string): CustomTool | undefined {
  return getCustomization().tools?.find((tool) => tool.name === name);
}

export async function executeCustomTool(
  tool: CustomTool,
  ctx: CustomToolContext,
  input: unknown
): Promise<AiToolResult> {
  return tool.execute(ctx, input);
}

/** Тайлбарын товч мэдээлэл — /settings/system хуудас, health endpoint. */
export function customizationSummary(): {
  name: string | null;
  version: string | null;
  toolCount: number;
  hooks: string[];
} {
  const c = getCustomization();
  return {
    name: c.name ?? null,
    version: c.version ?? null,
    toolCount: c.tools?.length ?? 0,
    hooks: Object.entries(c.hooks ?? {})
      .filter(([, fn]) => typeof fn === "function")
      .map(([key]) => key),
  };
}

// ── Hook цэгүүд ─────────────────────────────────────────────────────────────
// Guardrail-ийн ДАРАА дуудагдана (lib/actions/gl.ts, periods.ts). Hook нь
// зөвхөн нэмэлт хориг тавьж чадна, байгаа хоригийг тойрч чадахгүй.

/** {ok:false} бол Error шидэж транзакцыг буцаана. */
export async function runBeforeJournalPost(ctx: JournalHookContext): Promise<void> {
  const hook = getCustomization().hooks?.beforeJournalPost;
  if (!hook) return;
  const result = await hook(ctx);
  if (!result.ok) throw new Error(result.reason || "Өргөтгөлийн hook батлахыг зогсоолоо");
}

/** Commit-ийн дараа — алдаа хэзээ ч бичилтийг унагахгүй. */
export async function runAfterJournalPost(ctx: JournalHookContext): Promise<void> {
  const hook = getCustomization().hooks?.afterJournalPost;
  if (!hook) return;
  try {
    await hook(ctx);
  } catch (caught) {
    console.error("[custom] afterJournalPost hook алдаа:", caught);
  }
}

export async function runBeforePeriodClose(ctx: PeriodHookContext): Promise<HookResult> {
  const hook = getCustomization().hooks?.beforePeriodClose;
  if (!hook) return { ok: true };
  return hook(ctx);
}
