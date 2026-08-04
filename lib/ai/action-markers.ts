// AI action тэмдэглэгээний CLIENT-safe тал — DB/server хамааралгүй.
// Сервер (lib/ai/tools.ts actionMarker) контентод [[EA_ACTION:{json}]]
// маркер шигтгэдэг; чат UI үүгээр задалж карт болгож үзүүлнэ.

export interface AiAction {
  kind: "voucher" | "arap" | "cash" | "inventory" | "fa";
  id: string;
  title: string;
  status: "draft" | "posted" | "confirmed" | "active";
}

export type AiContentSegment =
  | { type: "text"; text: string }
  | { type: "action"; action: AiAction };

const MARKER_RE = /\[\[EA_ACTION:(\{.*?\})\]\]/g;

/** Контентыг текст болон action картуудын дараалал болгож задална. */
export function parseAiContent(content: string): AiContentSegment[] {
  const segments: AiContentSegment[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(MARKER_RE)) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) segments.push({ type: "text", text: before });
    try {
      const action = JSON.parse(match[1]) as AiAction;
      if (action && typeof action.id === "string" && action.kind)
        segments.push({ type: "action", action });
    } catch {
      // Гэмтсэн маркерыг алгасна — текст алдагдахгүй.
    }
    lastIndex = match.index + match[0].length;
  }
  const rest = content.slice(lastIndex);
  if (rest.trim() || segments.length === 0)
    segments.push({ type: "text", text: rest });
  return segments;
}

/** Стрийм явж байхад ХАГАС ирсэн маркерыг дэлгэцээс нуана. */
export function stripPartialMarker(content: string): string {
  const tail = content.lastIndexOf("[[EA_ACTION:");
  if (tail >= 0 && !content.slice(tail).includes("]]"))
    return content.slice(0, tail);
  return content;
}
