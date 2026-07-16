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

export async function loadSegmentPickerData(
  userId: string
): Promise<SegmentPickerData> {
  const [accounts, configs, values] = await Promise.all([
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.userId, userId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (account, { asc }) => [asc(account.number)],
    }),
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.userId, userId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.userId, userId),
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

  const defaultSegments: Record<number, string> = {};
  for (const id of activeSegIds) {
    const options = segmentOptions[id] ?? [];
    if (options.length === 1) defaultSegments[id] = options[0].code;
  }

  return { activeSegIds, segmentOptions, defaultSegments };
}
