// AccountInput / AccountSegmentPicker-т хэрэгтэй сегментийн өгөгдлийг нэг
// дор ачаалагч — данс сонгодог хуудас бүр энийг ашиглана (АР/АП-ийн
// load-data-тай ижил дүрэм: S3 үргэлж идэвхтэй, бусад нь тохиргоогоор;
// нэг л сонголттой сегмент default болно).

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { chartOfAccounts, segmentConfigs, segmentValues } from "@/lib/db/schema";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

export interface SegmentPickerData {
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
}

// Фаз 01 multi-tenancy: параметр нь идэвхтэй байгууллагын ID (orgId) —
// бүх дуудагч getActiveOrg()-ийн orgId-г дамжуулна.
export async function loadSegmentPickerData(
  orgId: string
): Promise<SegmentPickerData> {
  const [accounts, configs, values] = await Promise.all([
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (account, { asc }) => [asc(account.number)],
    }),
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.isEnabled, true)
      ),
      orderBy: (value, { asc }) => [asc(value.segmentId), asc(value.code)],
    }),
  ]);

  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (definition) =>
      definition.id === 3 || configMap.get(definition.id)?.isEnabled === true
  ).map((definition) => definition.id);

  const segmentOptions: Record<number, SegOption[]> = {};
  for (const id of activeSegIds) {
    segmentOptions[id] =
      id === 3
        ? accounts.map((account) => ({ code: account.number, name: account.name }))
        : values
            .filter((value) => value.segmentId === id)
            .map((value) => ({ code: value.code, name: value.name }));
  }

  // Идэвхтэй сегмент бүрд default утга: цор ганц сонголт → тэр;
  // бүх-0 код бүхий сонголт байвал → тэр; үгүй бол сегментийн уртаар
  // "0"-оор дүүргэнэ (жишээ: 2 оронтой бол "00"). Ингэснээр prefill код
  // бүрэн бөглөгдөж, тодорхойгүй сегмент default-аараа бичигдэнэ.
  const defaultSegments: Record<number, string> = {};
  for (const id of activeSegIds) {
    if (id === 3) continue; // үндсэн дансыг үргэлж хэрэглэгч сонгоно
    const definition = SEGMENT_DEFS.find((def) => def.id === id);
    const options = segmentOptions[id] ?? [];
    const zeroCode = "0".repeat(definition?.length ?? 2);
    defaultSegments[id] =
      options.length === 1 ? options[0].code : zeroCode;
  }

  return { activeSegIds, segmentOptions, defaultSegments };
}
