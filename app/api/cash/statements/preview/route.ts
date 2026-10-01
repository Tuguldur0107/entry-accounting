// Банкны хуулгын бичилтийг батлахаас ӨМНӨ харах — saveBankStatement-ийн ЯГ ТЭР
// кодыг транзакц дотор ажиллуулаад буцаана (lib/cash/import-statement.ts
// previewBankStatement). Энд зөвхөн HTTP давхарга; алдаа нь save route-тэй ижил.

import {
  previewBankStatement,
  type SavePayload,
} from "@/lib/cash/import-statement";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: SavePayload;
  try {
    payload = (await request.json()) as SavePayload;
  } catch {
    return Response.json({ error: "JSON задлагдсангүй" }, { status: 400 });
  }
  try {
    return Response.json(await previewBankStatement(payload));
  } catch (caught) {
    const error = caught as { code?: string; message?: string };
    if (error.message === "Нэвтрэх шаардлагатай" || error.message?.includes("эрх"))
      return Response.json({ error: error.message }, { status: 401 });
    const message =
      error.code === "23505"
        ? "Энэ хуулга өмнө нь импортлогдсон байна"
        : error.message || "Бичилтийг урьдчилж бодож чадсангүй";
    return Response.json({ error: message }, { status: 400 });
  }
}
