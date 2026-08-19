// П5 — лавлах датаны клиент кэш: session-д нэг удаа ачаалж, палитр
// (болон цаашид picker-ууд) network хүлээлгүй шүүнэ. Module-scope тул
// таб бүрд нэг instance; TTL-ээр аяндаа сэргэдэг (лавлах өөрчлөлт ховор).

import type { ReferenceData } from "./palette-search";

const TTL_MS = 5 * 60_000;

let cached: { data: ReferenceData; at: number } | null = null;
let inflight: Promise<ReferenceData | null> | null = null;

export function getReferenceData(): Promise<ReferenceData | null> {
  if (cached && Date.now() - cached.at < TTL_MS)
    return Promise.resolve(cached.data);
  if (inflight) return inflight;
  inflight = fetch("/api/reference")
    .then(async (response) => {
      if (!response.ok) return null;
      const data = (await response.json()) as ReferenceData & {
        error?: string;
      };
      if (data.error) return null;
      cached = { data, at: Date.now() };
      return data;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Данс/харилцагч/бараа үүсгэсэн, засварласны дараа дуудаж болно. */
export function invalidateReferenceData() {
  cached = null;
  inflight = null;
}
