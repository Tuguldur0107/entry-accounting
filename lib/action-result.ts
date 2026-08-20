// Server action-ы үр дүнгийн нэгдсэн хэлбэр.
//
// Next.js PRODUCTION дээр server action-ы шидсэн алдааны мессежийг нууж
// (React #441 "An error occurred in the Server Components render...")
// хэрэглэгчид ойлгомжгүй алдаа үзүүлдэг. Тиймээс хүлээгдэх алдаа бүр
// throw биш { error: string } УТГААР буцах ёстой — энэ модуль тэр хэв
// маягийн туслахуудыг нэг газар тодорхойлно (загвар: lib/actions/mcp-tokens.ts).
//
// Энэ файлд "use server" директив БАЙХГЙ — синхрон туслах функцүүдийг
// action файлууд чөлөөтэй импортолж хэрэглэнэ.

/**
 * Action-ы үр дүн: амжилтад T (+ error байхгүй), алдаанд { error }.
 * Дуудагч `if (result.error) ...` гэж шалгана; өгөгдөлтэй үр дүнд
 * `const { id, error } = result; if (error || !id) ...` хэлбэр тохиромжтой.
 */
export type ActionResult<T extends object = Record<never, never>> =
  | (T & { error?: undefined })
  | ({ [K in keyof T]?: never } & { error: string });

/**
 * Барьсан алдааг хэрэглэгчид үзүүлэх { error } болгоно. DB/Drizzle-ийн
 * түүхий алдааг (SQLSTATE кодтой эсвэл SQL-дотоод үгтэй) хэрэглэгчид
 * задлахгүй — fallback текстээр орлуулж, жинхэнэ алдааг лог руу бичнэ
 * (lib/ai/tools.ts-ийн төв catch-тэй ижил дүрэм).
 */
export function actionError(
  context: string,
  caught: unknown,
  fallback: string
): { error: string } {
  const message = caught instanceof Error ? caught.message : "";
  const code = (caught as { code?: unknown } | null)?.code;
  const isSqlState = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code);
  const looksSqlish =
    /constraint|syntax error|column .* does not exist|relation .* does not exist|duplicate key/i.test(
      message
    );
  if (!message || isSqlState || looksSqlish) {
    console.error(`${context}:`, caught);
    return { error: fallback };
  }
  return { error: message };
}

/**
 * Server-талын дуудагчид (lib/ai/tools.ts г.м) зориулсан урвуу хувиргалт:
 * { error }-тэй үр дүнг буцааж throw болгоно — тэдгээрийн төв catch алдааг
 * модельд текстээр буцаадаг тул шидэлт хэвээр хэрэгтэй.
 */
export function unwrapAction<T extends { error?: string }>(
  result: T
): Extract<T, { error?: undefined }> {
  if (result.error !== undefined) throw new Error(result.error);
  return result as Extract<T, { error?: undefined }>;
}
