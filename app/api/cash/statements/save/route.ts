// Банкны хуулга хадгалах — цөм нь lib/cash/import-statement.ts (MCP-тэй
// хуваалцана); энд зөвхөн HTTP давхарга: JSON задлах + алдааг статустай буцаах.

import {
  saveBankStatement,
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
    const result = await saveBankStatement(payload);
    return Response.json(result);
  } catch (caught) {
    const error = caught as { code?: string; message?: string };
    if (error.message === "Нэвтрэх шаардлагатай" || error.message?.includes("эрх"))
      return Response.json({ error: error.message }, { status: 401 });
    const message =
      error.code === "23505"
        ? "Энэ хуулга өмнө нь импортлогдсон байна"
        : error.message || "Хуулга хадгалж чадсангүй";
    return Response.json({ error: message }, { status: 400 });
  }
}
