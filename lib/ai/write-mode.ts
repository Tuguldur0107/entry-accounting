// AI бичилтийн горим — ЦЭВЭР (client-safe, DB-гүй).
//
// MCP (ChatGPT / Claude / Claude Code) ба REST API-аас ирсэн бичилт ЯМАР
// горимоор орохыг хэрэглэгч × байгууллага бүрд тогтооно (§9 human-in-the-loop):
//   draft — үргэлж НООРОГ, хэрэглэгч вэбээс шалгаад батална (анхдагч)
//   post  — тэнцсэн, батлах хязгаар (§9 aiPostLimitMnt) доторх бичилт шууд батлагдана
// Тохиргоо нь /ai хуудсанд (components/ai/ai-connect-view.tsx); DB давхарга
// lib/ai/write-mode-store.ts; уншигч lib/mcp/server.ts writeModeOf.

export type AiWriteMode = "draft" | "post";

export const AI_WRITE_MODES: AiWriteMode[] = ["draft", "post"];
export const DEFAULT_AI_WRITE_MODE: AiWriteMode = "draft";

export const AI_WRITE_MODE_LABELS: Record<AiWriteMode, string> = {
  draft: "Ноорог",
  post: "Шууд бичих",
};

export function isAiWriteMode(value: unknown): value is AiWriteMode {
  return value === "draft" || value === "post";
}
