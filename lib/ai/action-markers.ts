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

const MARKER_PREFIX = "[[EA_ACTION:";
// "[[" ба "EA_ACTION:" хооронд zero-width space шигтгэвэл MARKER_RE таарахаа
// больж, харагдах текст өөрчлөгдөхгүй.
const NEUTRALIZED_PREFIX = "[[" + String.fromCharCode(0x200b) + "EA_ACTION:";

/**
 * МОДЕЛИЙН бичсэн текстээс EA_ACTION маркерын угтварыг идэвхгүй болгоно —
 * клиент [[EA_ACTION:{json}]]-ийг ЖИНХЭНЭ үйлдлийн карт гэж зурдаг тул
 * модель (эсвэл моделийг хуурсан prompt injection) өөрөө маркер зохиож
 * "баримт үүслээ" гэсэн хуурамч карт харуулж чадах ёсгүй. Зөвхөн серверийн
 * actionMarker()-оор шигтгэсэн маркер энэ шүүлтүүрийг ТОЙРЧ дамждаг тул
 * амьд үлдэнэ.
 *
 * Stateful: угтвар нь стримийн хоёр delta-ийн заагаар тасарч ирж болзошгүй
 * тул маркерын эхлэл байж болох сүүлчийн хэдэн тэмдэгтийг түр барьж
 * (carry), дараагийн chunk эсвэл flush() дээр шийднэ.
 */
export function createMarkerSanitizer(): {
  push: (chunk: string) => string;
  flush: () => string;
} {
  let carry = "";
  const neutralize = (text: string) =>
    text.split(MARKER_PREFIX).join(NEUTRALIZED_PREFIX);
  return {
    push(chunk: string): string {
      const combined = carry + chunk;
      // Төгсгөлд нь маркерын угтварын ЭХЛЭЛ байж болох хэсгийг барина.
      let hold = 0;
      for (
        let k = Math.min(MARKER_PREFIX.length - 1, combined.length);
        k > 0;
        k--
      ) {
        if (MARKER_PREFIX.startsWith(combined.slice(combined.length - k))) {
          hold = k;
          break;
        }
      }
      carry = hold > 0 ? combined.slice(combined.length - hold) : "";
      return neutralize(
        hold > 0 ? combined.slice(0, combined.length - hold) : combined
      );
    },
    flush(): string {
      // Бүтэн угтвар болж амжаагүй сүүл — аюулгүй, хэвээр нь буцаана.
      const rest = carry;
      carry = "";
      return rest;
    },
  };
}
