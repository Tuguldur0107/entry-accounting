// Модулийн posting кодын builder — ЦЭВЭР цөм (DB-гүй).
//
// Дүрэм (cashPostingCodeBuilder-ийн эх): settings-д асаасан сегмент бүр
// идэвхтэй (S3 үргэлж); идэвхтэй сегмент ГАНЦ идэвхтэй утгатай бол тэр нь
// default; S8 = cash-flow код (өгөгдсөн бол); S9 = модулийн тэмдэг.
//
// lib/actions/cash.ts, fa.ts, costing.ts-ийн DB-тэй builder-ууд болон
// банкны хуулгын импортын route энэ цөмийг хуваалцана — 4 клон байсныг
// нэг эх сурвалж болгох зорилготой.

import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { buildSegCode } from "@/lib/grid/segments";

type SegmentConfigInput = { segmentId: number; isEnabled: boolean };
type SegmentValueInput = {
  segmentId: number;
  code: string;
  isEnabled: boolean;
};

export function postingCodeBuilderFromData({
  configs,
  values,
  moduleTag,
  cashFlowCode,
}: {
  configs: SegmentConfigInput[];
  values: SegmentValueInput[];
  /** S9-ийн модулийн тэмдэг: "CA" | "FA" | "CO" | "GL" г.м. */
  moduleTag: string;
  cashFlowCode?: string | null;
}): (mainAccount: string) => string {
  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (definition) =>
      definition.id === 3 || configMap.get(definition.id)?.isEnabled === true
  ).map((definition) => definition.id);

  const defaults: Record<number, string> = {};
  for (const segmentId of activeSegIds) {
    const options = values.filter(
      (value) => value.segmentId === segmentId && value.isEnabled
    );
    if (options.length === 1) defaults[segmentId] = options[0].code;
  }
  if (activeSegIds.includes(8) && cashFlowCode) defaults[8] = cashFlowCode;
  if (activeSegIds.includes(9)) defaults[9] = moduleTag;

  return (mainAccount: string) =>
    buildSegCode(
      { ...defaults, 3: mainAccount },
      activeSegIds,
      { ...defaults, 9: moduleTag }
    );
}
