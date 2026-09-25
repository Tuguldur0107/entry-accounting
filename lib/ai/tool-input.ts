// Tool-ийн оролтын НИЙТЛЭГ шалгалт (SIM2-016) — ЦЭВЭР (tests/sim2-tool-input.test.ts).
// Schema-д `required` гэж заасан талбар дутуу бол executor руу хүргэхгүй —
// «Cannot read properties of undefined (reading 'trim')» гэх мэт JS алдааны
// оронд талбарын НЭРТЭЙ ойлгомжтой алдаа буцаана. Төрлийн хувиргалтыг
// (тоо текстээр г.м.) executor-ууд өөрсдөө уян хатан хийдэг тул энд зөвхөн
// байх ёстой талбар ба объект хэлбэрийг шалгана.

export type ToolInputSchema = {
  type?: string;
  properties?: Record<string, { type?: string; description?: string }>;
  required?: readonly string[];
};

export function toolInputProblem(schema: ToolInputSchema | undefined, input: unknown): string | null {
  if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input)))
    return "оролт нь объект ({…}) байх ёстой";
  const args = (input ?? {}) as Record<string, unknown>;
  const missing = (schema?.required ?? []).filter((field) => {
    const value = args[field];
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  });
  if (missing.length === 0) return null;
  return `шаардлагатай талбар дутуу: ${missing
    .map((field) => {
      const description = schema?.properties?.[field]?.description;
      return description ? `${field} (${description.split(/[.—(]/)[0].trim()})` : field;
    })
    .join(", ")}`;
}
