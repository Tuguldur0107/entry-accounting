import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { ALL_SEG_IDS, SEG_DEFAULTS } from "@/lib/grid/segments";

type SegmentConfigInput = {
  segmentId: number;
  isEnabled: boolean;
  modules: string;
};

type SegmentValueInput = {
  segmentId: number;
  code: string;
  isEnabled: boolean;
  modules: string;
};

type GlAccountInput = {
  number: string;
  isEnabled: boolean;
  modules: string;
};

export type CashAccountCodeRules = {
  activeSegIds: number[];
  allowedValues: Map<number, Set<string>>;
};

function moduleEnabled(modules: string, module: string) {
  if (!modules) return true; // хоосон = бүх модульд нээлттэй
  return modules
    .split(",")
    .map((value) => value.trim())
    .includes(module);
}

export function buildCashAccountCodeRules(
  configs: SegmentConfigInput[],
  values: SegmentValueInput[],
  glAccounts: GlAccountInput[]
): CashAccountCodeRules {
  const configMap = new Map(
    configs.map((config) => [config.segmentId, config])
  );
  // Сегментийн түвшин: settings-д асаасан сегмент бүх модульд идэвхтэй
  // (S3 үргэлж) — GL журнал, statements хуудастай ижил дүрэм.
  // Модулиар шүүх нь СЕГМЕНТ биш УТГЫН түвшинд (доорх allowedValues).
  const activeSegIds = SEGMENT_DEFS.filter(
    (definition) =>
      definition.id === 3 || configMap.get(definition.id)?.isEnabled === true
  ).map((definition) => definition.id);

  const allowedValues = new Map<number, Set<string>>();
  for (const segmentId of activeSegIds) {
    const allowed = new Set(
      segmentId === 3
        ? glAccounts
            .filter(
              (account) =>
                account.isEnabled && moduleEnabled(account.modules, "cash")
            )
            .map((account) => account.number)
        : values
            .filter(
              (value) =>
                value.segmentId === segmentId &&
                value.isEnabled &&
                moduleEnabled(value.modules, "cash")
            )
            .map((value) => value.code)
    );
    // «Ерөнхий (default)» 0-утга — системийн сегмент дүрмээр сонгоогүй
    // идэвхтэй сегмент 0-утга авдаг (picker бүрд автоматаар нэмэгддэг,
    // posting builder ганц default олдохгүй үед мөн 0 бичдэг). S3-д үгүй.
    if (segmentId !== 3) allowed.add(SEG_DEFAULTS[segmentId] ?? "");
    allowedValues.set(segmentId, allowed);
  }

  return { activeSegIds, allowedValues };
}

/** Кассын бичилтийн S9 модулийн тэмдэг — идэвхгүй S9-д ч бичигддэг. */
const CASH_MODULE_TAG = "CA";

export function validateCashAccountCode(
  value: string,
  rules: CashAccountCodeRules
) {
  const parts = value.split(".");
  if (parts.length !== 10 || parts.some((part) => part.length > 32))
    throw new Error("дансны бүтэц буруу");

  for (const segmentId of ALL_SEG_IDS) {
    const part = parts[segmentId - 1] ?? "";
    if (rules.activeSegIds.includes(segmentId)) {
      if (!part) throw new Error(`S${segmentId} сегмент сонгогдоогүй`);
      // S9: кассын бичилт "CA" тэмдэгтэй — утгын лавлахад байхгүй ч зөв.
      if (segmentId === 9 && part === CASH_MODULE_TAG) continue;
      if (!rules.allowedValues.get(segmentId)?.has(part))
        throw new Error(
          `S${segmentId} сегментийн "${part}" утга Cash модульд идэвхгүй — Тохиргоо → Данс, сегмент хэсэгт утгыг идэвхжүүлэх эсвэл Cash модульд нээнэ үү`
        );
    } else if (
      part !== (SEG_DEFAULTS[segmentId] ?? "") &&
      !(segmentId === 9 && part === CASH_MODULE_TAG)
    ) {
      throw new Error(
        `S${segmentId} сегмент идэвхгүй атлаа "${part}" утгатай байна — default (${SEG_DEFAULTS[segmentId] ?? "хоосон"}) байх ёстой`
      );
    }
  }

  return parts[2];
}
