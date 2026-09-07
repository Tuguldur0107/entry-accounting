// custom/ бүртгэлийн ЦЭВЭР шалгалт — DB, Next.js хамааралгүй (тесттэй).
// Loader build/эхлэх үед энийг дуудаж, алдаатай бол монгол текстээр зогсоно.

import type { EntryCustomization } from "./types";

const TOOL_NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;

/**
 * Хэд хэдэн багцыг нэг customization болгон нийлүүлнэ (custom/index.ts-д
 * `mergeCustomizations(pkgA, pkgB)`). Hook-ууд дарааллаараа ажиллана:
 * before-hook аль нэг нь {ok:false} буцаавал тэр даруй зогсоно.
 */
export function mergeCustomizations(
  ...packages: EntryCustomization[]
): EntryCustomization {
  const tools = packages.flatMap((p) => p.tools ?? []);
  const befores = packages.map((p) => p.hooks?.beforeJournalPost).filter(isDefined);
  const afters = packages.map((p) => p.hooks?.afterJournalPost).filter(isDefined);
  const closes = packages.map((p) => p.hooks?.beforePeriodClose).filter(isDefined);
  const names = packages.map((p) => p.name).filter(isDefined);
  return {
    name: names.length > 0 ? names.join(" + ") : undefined,
    tools,
    hooks: {
      beforeJournalPost:
        befores.length > 0
          ? async (ctx) => {
              for (const hook of befores) {
                const result = await hook(ctx);
                if (!result.ok) return result;
              }
              return { ok: true };
            }
          : undefined,
      afterJournalPost:
        afters.length > 0
          ? async (ctx) => {
              for (const hook of afters) await hook(ctx);
            }
          : undefined,
      beforePeriodClose:
        closes.length > 0
          ? async (ctx) => {
              for (const hook of closes) {
                const result = await hook(ctx);
                if (!result.ok) return result;
              }
              return { ok: true };
            }
          : undefined,
    },
  };
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value != null;
}

/**
 * Алдааны жагсаалт буцаана (хоосон = зөв). Шалгах зүйлс:
 *   - tool нэр хэлбэр, давхардал (custom дотроо), core-той давхцал
 *   - description, inputSchema (object төрөлтэй), execute функц
 *   - hooks нь функц
 */
export function validateCustomization(
  customization: EntryCustomization,
  coreToolNames: Iterable<string>
): string[] {
  const errors: string[] = [];
  const core = new Set(coreToolNames);
  const seen = new Set<string>();

  for (const [index, tool] of (customization.tools ?? []).entries()) {
    const label = `tools[${index}]`;
    const name = typeof tool?.name === "string" ? tool.name : "";
    if (!TOOL_NAME_RE.test(name))
      errors.push(
        `${label}: нэр "${name}" буруу — жижиг латин үсэг, тоо, _ (3–64 тэмдэгт, үсгээр эхэлнэ)`
      );
    else if (core.has(name))
      errors.push(`${label}: "${name}" нь core tool-ийн нэр — өөр нэр сонгоно уу`);
    else if (seen.has(name)) errors.push(`${label}: "${name}" нэр давхардсан`);
    seen.add(name);

    if (typeof tool?.description !== "string" || tool.description.trim().length < 10)
      errors.push(`${label} (${name}): description дор хаяж 10 тэмдэгт байх ёстой`);
    const schema = tool?.inputSchema as { type?: unknown } | undefined;
    if (!schema || typeof schema !== "object" || schema.type !== "object")
      errors.push(`${label} (${name}): inputSchema нь { type: "object", ... } байх ёстой`);
    if (typeof tool?.execute !== "function")
      errors.push(`${label} (${name}): execute функц дутуу`);
  }

  const hooks = customization.hooks ?? {};
  for (const key of ["beforeJournalPost", "afterJournalPost", "beforePeriodClose"] as const) {
    const value = hooks[key];
    if (value !== undefined && typeof value !== "function")
      errors.push(`hooks.${key}: функц байх ёстой`);
  }

  return errors;
}
