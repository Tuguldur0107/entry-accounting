// AI/MCP/REST tool-ийн алдааг гадагш гаргахаас ӨМНӨ ангилна (ENT-070).
//
// Drizzle нь DB алдааг `DrizzleQueryError` болгон ороодог: мессеж нь
// «Failed query: select … params: <org UUID>, …» бөгөөд SQLSTATE код нь
// ЗӨВХӨН `cause` (PostgresError)-д байдаг. Урьд нь зөвхөн гадна талын
// `code`-ыг шалгадаг байсан тул бүтэн SQL + байгууллагын UUID гадны MCP
// клиентэд ил гарч байв. Энд cause гинжийг бүхэлд нь шалгана.
//
// ЦЭВЭР модуль (DB импортгүй) — tests/ai-error-sanitize.test.ts.

export type ToolErrorClass =
  | { internal: true; logId: string }
  | { internal: false; message: string };

const SQLSTATE_RE = /^[0-9A-Z]{5}$/;

/** SQL/драйверийн дотоод мессежийн шинж — хэрэглэгчийн текст биш. */
const SQLISH_RE =
  /failed query|params:|constraint|syntax error|column .* does not exist|relation .* does not exist|duplicate key|violates|\bselect\b[\s\S]*\bfrom\b|\binsert into\b|\bupdate\b[\s\S]*\bset\b|\bdelete from\b|postgres|drizzle|ECONNREFUSED|ETIMEDOUT|connection terminated/i;

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object" && "message" in value)
    return String((value as { message: unknown }).message ?? "");
  return "";
}

/** Алдаа эсвэл түүний cause гинжийн аль нэг нь DB-ийн дотоод алдаа мөн эсэх. */
export function isInternalDbError(caught: unknown): boolean {
  let current: unknown = caught;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && SQLSTATE_RE.test(code)) return true;
    const name = (current as { name?: unknown }).name;
    if (name === "DrizzleQueryError" || name === "PostgresError") return true;
    if (SQLISH_RE.test(messageOf(current))) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Лог ба хэрэглэгчийн мессежийг холбох богино лавлах код. */
export function newLogId(random: () => number = Math.random): string {
  return Math.floor(random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0")
    .toUpperCase();
}

export function classifyToolError(
  caught: unknown,
  random?: () => number
): ToolErrorClass {
  if (isInternalDbError(caught)) return { internal: true, logId: newLogId(random) };
  const message = messageOf(caught);
  return { internal: false, message: message || "Тодорхойгүй алдаа" };
}

/** Хэрэглэгчид харуулах ерөнхий текст — SQL, UUID, параметр агуулахгүй. */
export function internalErrorText(logId: string): string {
  return `Дотоод алдаа гарлаа — дахин оролдоно уу (лавлах код: ${logId})`;
}
