// Хянаж буй банкны хуулгын ноорог (docs/dev/arap.md §5l) — PUT хадгална,
// DELETE устгана. Server action биш route: том хуулгад (≤5000 мөр) action-ийн
// биеийн хязгаар хүрэхгүй. GL-д юу ч бичихгүй.

import { requireModuleAction } from "@/lib/auth";
import type {
  ParsedBankStatement,
  ParsedBankStatementRow,
} from "@/lib/cash/bank-statement-types";
import { deleteStatementDraft, saveStatementDraft } from "@/lib/cash/statement-draft";

export const runtime = "nodejs";

async function scope() {
  try {
    return await requireModuleAction("cash", "write");
  } catch {
    return null;
  }
}

export async function PUT(request: Request) {
  const active = await scope();
  if (!active) return Response.json({ error: "Нэвтрэх эсвэл кассын бичих эрх шаардлагатай" }, { status: 401 });
  let body: { cashAccountId?: string; statement?: ParsedBankStatement; rows?: ParsedBankStatementRow[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON задлагдсангүй" }, { status: 400 });
  }
  try {
    await saveStatementDraft({
      orgId: active.orgId,
      userId: active.userId,
      cashAccountId: String(body.cashAccountId ?? ""),
      statement: body.statement as ParsedBankStatement,
      rows: body.rows as ParsedBankStatementRow[],
    });
    return Response.json({ ok: true });
  } catch (caught) {
    return Response.json(
      { error: caught instanceof Error ? caught.message : "Ноорог хадгалагдсангүй" },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const active = await scope();
  if (!active) return Response.json({ error: "Нэвтрэх эсвэл кассын бичих эрх шаардлагатай" }, { status: 401 });
  await deleteStatementDraft(active.orgId, active.userId);
  return Response.json({ ok: true });
}
