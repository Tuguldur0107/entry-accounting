// Балансын мөр бүрт ямар данс орохыг шийдэх ЦОРЫН ГАНЦ цэвэр функц — вэбийн
// балансын тайлан (balance-sheet-view.tsx) ба AI/MCP `get_balance_sheet`
// хоёулаа үүнийг дуудна (ENT-072). Урьд нь хоёр газар тус тусдаа бичигдсэн
// байсан бөгөөд AI tool хоосон override-г (нуусан/нэр солисон мөр) «данс
// байхгүй» гэж уншиж тухайн мөрийн дүнг алддаг байв.
//
// Дүрэм:
//   - Built-in мөр: override (хоосон биш accountNumbers) байвал түүгээр,
//     үгүй бол `defaultPrefixes`-ийн аль нэгээр эхэлсэн данс.
//   - Custom мөр (`custom-…`): зөвхөн өөрийн accountNumbers.
//   - 1–4 ангиллын (баланс) данс АЛЬ Ч мөрөнд ороогүй бол ЧИМЭЭГҮЙ алга
//     болгохгүй — «Ангилагдаагүй данс» мөрөнд ил гарна. Эс бөгөөс баланс
//     тэнцэхгүй бөгөөд шалтгаан нь харагдахгүй (симуляцид 100,000₮ зөрсөн).
//
// DB импортгүй — client component ч импортолдог.

import { BS_LINES, type BsSection, type BsSign } from "@/lib/reports/bs-lines";

export interface BsMappingInput {
  lineKey: string;
  accountNumbers: string;
  customLabel: string | null;
  customGroup: string | null;
  isHidden: boolean;
  sortOrder: number;
}

export interface ResolvedBsLine {
  key: string;
  section: BsSection;
  group: string;
  groupLabel: string;
  label: string;
  accountNumbers: string[];
  sign: BsSign;
  isHidden: boolean;
  isCustom: boolean;
  /** Аль ч мөрөнд тааралгүй үлдсэн дансны автомат мөр. */
  isUnclassified: boolean;
  sortOrder: number;
}

export const BS_GROUP_META: Record<
  string,
  { section: BsSection; sign: BsSign; groupLabel: string }
> = {};
for (const line of BS_LINES) {
  if (!BS_GROUP_META[line.group])
    BS_GROUP_META[line.group] = {
      section: line.section,
      sign: line.sign,
      groupLabel: line.groupLabel,
    };
}

export const UNCLASSIFIED_BS_LABEL = "Ангилагдаагүй данс";

/** Дансны эхний цифрээр балансын бүлэг (1–4); бусад нь баланст хамаарахгүй. */
export function bsGroupOfAccountClass(accountNumber: string): string | null {
  switch (accountNumber.charAt(0)) {
    case "1":
      return "current-assets";
    case "2":
      return "non-current-assets";
    case "3":
      return accountNumber.startsWith("33") ? "non-current-liabilities" : "current-liabilities";
    case "4":
      return "equity";
    default:
      return null;
  }
}

function splitNumbers(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Built-in мөрийн анхдагч дансууд (override-гүй үед). */
export function defaultBsLineKeysOf(accountNumber: string): string[] {
  return BS_LINES.filter((line) =>
    line.defaultPrefixes.some((prefix) => accountNumber.startsWith(prefix))
  ).map((line) => line.key);
}

export function resolveBsLines(
  accounts: readonly { number: string }[],
  mappings: readonly BsMappingInput[]
): ResolvedBsLine[] {
  const mappingByKey = new Map(mappings.map((row) => [row.lineKey, row]));
  const out: ResolvedBsLine[] = [];

  BS_LINES.forEach((line, index) => {
    const mapping = mappingByKey.get(line.key);
    // Хоосон accountNumbers нь override БИШ — нуух/нэр солих үйлдэл mapping
    // мөрийг хоосон дансаар үүсгэдэг тул "" нь default-даа үлдэнэ.
    const override =
      mapping && mapping.accountNumbers.trim() !== ""
        ? splitNumbers(mapping.accountNumbers)
        : undefined;
    out.push({
      key: line.key,
      section: line.section,
      group: line.group,
      groupLabel: line.groupLabel,
      label: mapping?.customLabel?.trim() || line.label,
      accountNumbers:
        override ??
        accounts
          .filter((account) =>
            line.defaultPrefixes.some((prefix) => account.number.startsWith(prefix))
          )
          .map((account) => account.number),
      sign: line.sign,
      isHidden: !!mapping?.isHidden,
      isCustom: false,
      isUnclassified: false,
      sortOrder: index,
    });
  });

  for (const mapping of mappings) {
    if (!mapping.lineKey.startsWith("custom-")) continue;
    const group = mapping.customGroup ?? "current-assets";
    const meta = BS_GROUP_META[group];
    if (!meta) continue;
    out.push({
      key: mapping.lineKey,
      section: meta.section,
      group,
      groupLabel: meta.groupLabel,
      label: mapping.customLabel?.trim() || "Нэргүй мөр",
      accountNumbers: splitNumbers(mapping.accountNumbers),
      sign: meta.sign,
      isHidden: mapping.isHidden,
      isCustom: true,
      isUnclassified: false,
      sortOrder: mapping.sortOrder,
    });
  }

  // Аль ч мөрөнд ороогүй 1–4 ангиллын данс → бүлэг бүрийн «Ангилагдаагүй».
  const covered = new Set(out.flatMap((line) => line.accountNumbers));
  const leftovers = new Map<string, string[]>();
  for (const account of accounts) {
    if (covered.has(account.number)) continue;
    const group = bsGroupOfAccountClass(account.number);
    if (!group) continue;
    leftovers.set(group, [...(leftovers.get(group) ?? []), account.number]);
  }
  let extraOrder = BS_LINES.length + 1000;
  for (const [group, numbers] of leftovers) {
    const meta = BS_GROUP_META[group];
    if (!meta) continue;
    out.push({
      key: `unclassified-${group}`,
      section: meta.section,
      group,
      groupLabel: meta.groupLabel,
      label: UNCLASSIFIED_BS_LABEL,
      accountNumbers: numbers,
      sign: meta.sign,
      isHidden: false,
      isCustom: false,
      isUnclassified: true,
      sortOrder: extraOrder++,
    });
  }

  return out;
}
