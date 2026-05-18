// Excel / Sheets paste support. AG Grid v35 hands us a 2D array of strings
// via `processDataFromClipboard`. We normalize it once here so editors don't
// have to know how to deal with locale-formatted numbers or account codes.

import { normalizePastedAccount } from "./segments";

export interface ClipboardContext {
  activeSegIds: number[];
  defaultSegments?: Record<number, string>;
  columnTypes: ("account-segment" | "other")[];
}

export function processClipboardData(
  raw: string[][],
  ctx: ClipboardContext
): string[][] {
  return raw.map((row) =>
    row.map((cell, colIdx) => {
      const t = ctx.columnTypes[colIdx];
      if (t === "account-segment") {
        return normalizePastedAccount(cell, ctx.activeSegIds, ctx.defaultSegments);
      }
      return cell;
    })
  );
}
