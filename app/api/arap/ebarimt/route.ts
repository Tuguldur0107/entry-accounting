// П24 — eBarimt/PDF/зураг → АП нэхэмжлэхийн НООРОГ (Odoo-гийн OCR-ийн
// Монгол хувилбар). Урсгал:
//   файл → Anthropic vision задаргаа (lib/arap/ebarimt.ts prompt/parse)
//   → create_counterparty (байвал [CONFLICT] — хэвийн)
//   → create_arap_invoice tool, mode="draft" (§9 — хэрэглэгч панельд шалгана)
// ДДТД → externalRef "ebarimt:<ддтд>" тул нэг баримт ХОЁР удаа орохгүй
// (idempotent, tools-ийн бэлэн dedup зам).

import Anthropic from "@anthropic-ai/sdk";
import { requireAnyModuleAction } from "@/lib/auth";
import { executeAiTool } from "@/lib/ai/tools";
import {
  EBARIMT_EXTRACTION_PROMPT,
  parseEbarimtExtraction,
} from "@/lib/arap/ebarimt";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_BYTES = 8_000_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
/** Задаргаанд ашиглах модель — хурдан, vision чадвартай. */
const EXTRACTION_MODEL = "claude-sonnet-5";
/** Ноорог мөрүүдийн default зардлын данс — хэрэглэгч панельд өөрчилнө. */
const DEFAULT_EXPENSE_ACCOUNT = "73100001";

function errorJson(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await requireAnyModuleAction([["ar", "write"], ["ap", "write"]]));
  } catch {
    return errorJson("Нэвтрэх эсвэл бичих эрх шаардлагатай", 401);
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("file");
    file = entry instanceof File ? entry : null;
  } catch {
    return errorJson("Файл уншигдсангүй");
  }
  if (!file) return errorJson("Файл сонгоно уу");
  if (file.size > MAX_FILE_BYTES)
    return errorJson("Файл 8MB-с ихгүй байх ёстой");
  const mediaType = file.type;
  if (mediaType !== "application/pdf" && !IMAGE_TYPES.has(mediaType))
    return errorJson("PDF эсвэл зураг (PNG/JPG/WEBP) оруулна уу");

  // Түлхүүр — ЗӨВХӨН серверийн env (Entry-ийн өөрийн Anthropic түлхүүр; апп
  // доторх чат + BYO түлхүүр 2026-09-25-нд хасагдсан). Vision + PDF тул Anthropic.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return errorJson(
      "Баримт таних AI серверт тохируулагдаагүй байна (ANTHROPIC_API_KEY) — нэхэмжлэхээ гараар оруулна уу.",
      503
    );

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const client = new Anthropic({ apiKey });

  let rawText: string;
  try {
    const response = await client.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            mediaType === "application/pdf"
              ? {
                  type: "document" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "application/pdf" as const,
                    data,
                  },
                }
              : {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: mediaType as
                      | "image/png"
                      | "image/jpeg"
                      | "image/webp"
                      | "image/gif",
                    data,
                  },
                },
            { type: "text" as const, text: EBARIMT_EXTRACTION_PROMPT },
          ],
        },
      ],
    });
    rawText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  } catch (caught) {
    console.error("ebarimt extraction failed:", caught);
    return errorJson("Баримт уншиж чадсангүй — дахин оролдоно уу", 502);
  }

  const parsed = parseEbarimtExtraction(rawText);
  if ("error" in parsed) return errorJson(parsed.error);
  const extraction = parsed.data;

  // Ханган нийлүүлэгч байхгүй бол үүсгэнэ; [CONFLICT] = аль хэдийн бий.
  const counterpartyResult = await executeAiTool(
    userId,
    "create_counterparty",
    {
      name: extraction.supplierName,
      counterpartyType: "supplier",
      ...(extraction.supplierRegisterNo
        ? { registerNo: extraction.supplierRegisterNo }
        : {}),
    },
    "draft"
  );
  if (
    counterpartyResult.resultText.startsWith("Алдаа") &&
    !counterpartyResult.resultText.includes("[CONFLICT]")
  )
    return errorJson(counterpartyResult.resultText);

  const invoiceResult = await executeAiTool(
    userId,
    "create_arap_invoice",
    {
      documentType: "ap_bill",
      counterparty: extraction.supplierName,
      date: extraction.date,
      description: extraction.ddtd
        ? `eBarimt ${extraction.ddtd}`
        : `eBarimt — ${extraction.supplierName}`,
      // eBarimt дүнгүүд НӨАТ орсон — inclusive задаргаа (largest-line absorb).
      vatMode: extraction.vatAmount > 0 ? "inclusive" : "none",
      ...(extraction.ddtd ? { externalRef: `ebarimt:${extraction.ddtd}` } : {}),
      lines: extraction.lines.map((line) => ({
        account: DEFAULT_EXPENSE_ACCOUNT,
        description: line.description,
        amount: line.amount,
      })),
    },
    "draft"
  );
  if (
    invoiceResult.resultText.startsWith("Алдаа") ||
    /^\[(?!CONFLICT)[A-Z_]+\]/.test(invoiceResult.resultText)
  )
    return errorJson(invoiceResult.resultText);

  return Response.json({
    id: invoiceResult.action?.id ?? null,
    title: invoiceResult.action?.title ?? null,
    dedup: invoiceResult.dedup === true,
    supplierName: extraction.supplierName,
    totalAmount: extraction.totalAmount,
    vatAmount: extraction.vatAmount,
    date: extraction.date,
  });
}
