// Барааны АНГИЛЛЫН МОД — ЦЭВЭР логик (DB-гүй, client-safe, тесттэй).
//
// Ангилал нь `parentId`-аар олон түвшинтэй мод үүсгэнэ (ж: Ерөнхий ангилал →
// Үндсэн ангилал → Дэд ангилал). Бараа нь ангилалдаа КОДООР холбогддог тул
// функцууд код ба id хоёуланг хүлээн авна.
//
// ДҮРМҮҮД:
//  • Мод гажигтай байсан ч (эцэг нь устсан/өөр байгууллагынх, цикл) уншигч
//    ХЭЗЭЭ Ч гацахгүй: алга эцэгтэй мөр эхний түвшинд гарна, цикл тасарна.
//    Бичих зам (validateCategoryParent) ийм гажиг үүсгэхийг ХОРИГЛОНО.
//  • Удамшил: эцэг ангилалд хамаарах дүрэм (хөнгөлөлт, шүүлт, тайлан) нь
//    бүх дэд ангиллын бараанд хамаарна — `descendantCodes` / `ancestorCodes`.
//  • eBarimt ангилалын код (7 орон) бараанд хоосон бол ЭХ ангилал руу
//    өгсөж өвлөгдөнө — анхны хоосон бус утга (`effectiveCategoryClassification`).
//  • Түвшний нэр ба дээд гүн: `resolveCategoryLevels` — мөргүй бол default.
//    Хамгийн багадаа 1 түвшин.

export interface CategoryNode {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  ebarimtClassificationCode?: string | null;
}

export interface CategoryTreeRow<T extends CategoryNode = CategoryNode> {
  node: T;
  /** 1 = эхний түвшин. */
  depth: number;
  /** Эхнээс өөрийг хүртэлх кодууд. */
  pathCodes: string[];
  /** «Хүнс › Сүүн бүтээгдэхүүн › Тараг». */
  pathLabel: string;
  /** Шууд хүүхдийн тоо. */
  childCount: number;
}

export const CATEGORY_PATH_SEPARATOR = " › ";

/** Default түвшний нэрс — дээрээс доош. Хэрэглэгч засах/нэмэх/хасах боломжтой. */
export const DEFAULT_CATEGORY_LEVEL_NAMES: readonly string[] = [
  "Ерөнхий ангилал",
  "Үндсэн ангилал",
  "Дэд ангилал",
];

/** Хэт гүн мод UI-г эвддэг — түвшний дээд хязгаар. */
export const MAX_CATEGORY_LEVELS = 8;

// ── Түвшин ────────────────────────────────────────────────────────────────

/**
 * Хадгалагдсан түвшний мөрөөс нэрсийн жагсаалт (depth 1…N). Мөргүй бол
 * default. Цоорхой depth (ж: 1, 3) бол дараалал нь depth-ээр — дугаар
 * биш, ЭРЭМБЭ чухал; хоосон нэрийг алгасна.
 */
export function resolveCategoryLevels(
  rows: readonly { depth: number; name: string }[] | null | undefined
): string[] {
  const names = [...(rows ?? [])]
    .sort((a, b) => a.depth - b.depth)
    .map((row) => row.name.trim())
    .filter(Boolean);
  return names.length > 0 ? names.slice(0, MAX_CATEGORY_LEVELS) : [...DEFAULT_CATEGORY_LEVEL_NAMES];
}

/** depth (1-ээс) → түвшний нэр. Хэтэрвэл «N-р түвшин». */
export function categoryLevelName(depth: number, levels: readonly string[]): string {
  return levels[depth - 1] ?? `${depth}-р түвшин`;
}

/**
 * Түвшний нэрсийг хадгалахын өмнө шалгана. Буцаах: цэвэрлэсэн нэрс, эсвэл
 * алдааны текст. `usedDepth` = одоо модонд ашиглагдаж буй хамгийн гүн түвшин —
 * түүнээс доош хасахыг хориглоно (ангилал «түвшингүй» болохоос сэргийлнэ).
 */
export function planCategoryLevels(
  input: readonly string[],
  usedDepth: number
): { names: string[] } | { error: string } {
  const names = input.map((name) => name.trim());
  if (names.length === 0) return { error: "Хамгийн багадаа 1 түвшин байна" };
  if (names.length > MAX_CATEGORY_LEVELS)
    return { error: `Түвшин ${MAX_CATEGORY_LEVELS}-аас их байж болохгүй` };
  const emptyAt = names.findIndex((name) => !name);
  if (emptyAt >= 0) return { error: `${emptyAt + 1}-р түвшний нэр хоосон байна` };
  if (names.some((name) => name.length > 60)) return { error: "Түвшний нэр 60 тэмдэгтээс ихгүй" };
  const lower = names.map((name) => name.toLowerCase());
  const duplicate = lower.find((name, index) => lower.indexOf(name) !== index);
  if (duplicate) return { error: `«${names[lower.indexOf(duplicate)]}» нэр давхардсан байна` };
  if (usedDepth > names.length)
    return {
      error: `Модонд ${usedDepth}-р түвшний ангилал байгаа тул түвшний тоог ${usedDepth}-аас доош болгох боломжгүй — эхлээд тэр ангиллуудыг зөөж/устгана уу`,
    };
  return { names };
}

// ── Мод ───────────────────────────────────────────────────────────────────

function indexNodes<T extends CategoryNode>(nodes: readonly T[]) {
  const byId = new Map<string, T>();
  const byCode = new Map<string, T>();
  for (const node of nodes) {
    byId.set(node.id, node);
    byCode.set(node.code, node);
  }
  return { byId, byCode };
}

/**
 * Эцгийн гинж — өөрөөс нь эхлээд дээш (өөрийг оруулна). Цикл эсвэл алга
 * эцэг дээр зогсоно (уншигч хэзээ ч гацахгүй).
 */
function chainOf<T extends CategoryNode>(start: T | undefined, byId: Map<string, T>): T[] {
  const chain: T[] = [];
  const seen = new Set<string>();
  let current = start;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/**
 * Модыг DFS дарааллаар хавтгай жагсаалт болгоно (эцэг → хүүхдүүд, ах дүү
 * нь кодоор). Алга эцэгтэй / циклд орсон мөр эхний түвшинд гарна.
 */
export function buildCategoryTree<T extends CategoryNode>(
  nodes: readonly T[]
): CategoryTreeRow<T>[] {
  const { byId } = indexNodes(nodes);
  const children = new Map<string | null, T[]>();
  const rootOf = (node: T): string | null => {
    if (!node.parentId || !byId.has(node.parentId)) return null;
    // Цикл: өөрийгөө өвөг болгосон мөр → эхний түвшин рүү.
    const chain = chainOf(node, byId);
    const last = chain[chain.length - 1];
    const cyclic = last.parentId != null && byId.has(last.parentId);
    return cyclic ? null : node.parentId;
  };
  for (const node of nodes) {
    const parent = rootOf(node);
    const list = children.get(parent) ?? [];
    list.push(node);
    children.set(parent, list);
  }
  for (const list of children.values())
    list.sort((a, b) => a.code.localeCompare(b.code, "mn"));

  const rows: CategoryTreeRow<T>[] = [];
  const visited = new Set<string>();
  const walk = (parentKey: string | null, depth: number, path: T[]) => {
    for (const node of children.get(parentKey) ?? []) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const nextPath = [...path, node];
      rows.push({
        node,
        depth,
        pathCodes: nextPath.map((entry) => entry.code),
        pathLabel: nextPath.map((entry) => entry.name).join(CATEGORY_PATH_SEPARATOR),
        childCount: (children.get(node.id) ?? []).length,
      });
      walk(node.id, depth + 1, nextPath);
    }
  };
  walk(null, 1, []);
  return rows;
}

/** Өөрийг оруулсан ӨВГИЙН кодууд — [өөр, эцэг, өвөг, …]. Код алга бол []. */
export function ancestorCodes(code: string | null | undefined, nodes: readonly CategoryNode[]): string[] {
  if (!code) return [];
  const { byId, byCode } = indexNodes(nodes);
  const start = byCode.get(code);
  if (!start) return [code];
  return chainOf(start, byId).map((node) => node.code);
}

/** Өөрийг оруулсан бүх ДЭД ангиллын код (удамшил). Код алга бол зөвхөн өөр. */
export function descendantCodes(code: string, nodes: readonly CategoryNode[]): Set<string> {
  const result = new Set<string>([code]);
  const { byCode } = indexNodes(nodes);
  const start = byCode.get(code);
  if (!start) return result;
  const childrenOf = new Map<string, CategoryNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node);
    childrenOf.set(node.parentId, list);
  }
  const queue = [start];
  const seen = new Set<string>([start.id]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenOf.get(current.id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.add(child.code);
      queue.push(child);
    }
  }
  return result;
}

/** «Хүнс › Сүүн бүтээгдэхүүн › Тараг» — код алга бол кодыг өөрийг нь. */
export function categoryPathLabel(code: string | null | undefined, nodes: readonly CategoryNode[]): string {
  if (!code) return "";
  const { byId, byCode } = indexNodes(nodes);
  const start = byCode.get(code);
  if (!start) return code;
  return chainOf(start, byId)
    .reverse()
    .map((node) => node.name)
    .join(CATEGORY_PATH_SEPARATOR);
}

/** Ангиллын түвшин (1-ээс). Код алга бол 0. */
export function categoryDepth(code: string | null | undefined, nodes: readonly CategoryNode[]): number {
  if (!code) return 0;
  const { byCode } = indexNodes(nodes);
  if (!byCode.has(code)) return 0;
  return ancestorCodes(code, nodes).length;
}

/** Модонд ашиглагдаж буй хамгийн гүн түвшин (хоосон бол 0). */
export function maxTreeDepth(nodes: readonly CategoryNode[]): number {
  return buildCategoryTree(nodes).reduce((max, row) => Math.max(max, row.depth), 0);
}

/**
 * eBarimt ангилалын код — ангилал өөрөө хоосон бол ЭЦЭГ рүү өгсөж анхны
 * хоосон бус утгыг авна. Олдохгүй бол null (код ЗОХИОХГҮЙ).
 */
export function effectiveCategoryClassification(
  code: string | null | undefined,
  nodes: readonly CategoryNode[]
): string | null {
  if (!code) return null;
  const { byId, byCode } = indexNodes(nodes);
  for (const node of chainOf(byCode.get(code), byId)) {
    const value = node.ebarimtClassificationCode?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Эцэг оноох/солихын ШАЛГАЛТ (бичих зам). null = зөв.
 *  • эцэг байх ёстой, өөрөө биш, өөрийн удам биш (цикл)
 *  • шинэ байрлал дахь гүн + өөрийн дэд модны өндөр ≤ түвшний тоо
 */
export function validateCategoryParent(params: {
  /** Засаж буй ангилал (шинэ бол undefined). */
  id?: string;
  parentId: string | null;
  nodes: readonly CategoryNode[];
  levelCount: number;
}): string | null {
  const { id, parentId, nodes, levelCount } = params;
  const { byId } = indexNodes(nodes);
  let parentDepth = 0;
  if (parentId) {
    const parent = byId.get(parentId);
    if (!parent) return "Эцэг ангилал олдсонгүй";
    if (id && parentId === id) return "Ангилал өөрийгөө эцэг болгох боломжгүй";
    const parentChain = chainOf(parent, byId);
    if (id && parentChain.some((node) => node.id === id))
      return "Ангиллыг өөрийнхөө дэд ангилал руу зөөх боломжгүй (цикл үүснэ)";
    parentDepth = parentChain.length;
  }
  // Зөөж буй ангиллын дэд модны өндөр (өөрийг оруулна).
  let subtreeHeight = 1;
  if (id && byId.has(id)) {
    const self = byId.get(id)!;
    const heights = new Map<string, number>();
    const heightOf = (node: CategoryNode, guard: Set<string>): number => {
      if (heights.has(node.id)) return heights.get(node.id)!;
      if (guard.has(node.id)) return 0;
      guard.add(node.id);
      let best = 0;
      for (const child of nodes)
        if (child.parentId === node.id) best = Math.max(best, heightOf(child, guard));
      heights.set(node.id, best + 1);
      return best + 1;
    };
    subtreeHeight = heightOf(self, new Set());
  }
  const deepest = parentDepth + subtreeHeight;
  if (deepest > levelCount)
    return `Ангиллын мод ${levelCount} түвшинтэй — энэ байрлалд ${deepest}-р түвшин үүсэх гээд байна. Түвшин нэмэх эсвэл өөр эцэг сонгоно уу`;
  return null;
}

/** Ангилал устгах шалгалт — хүүхэдтэй эсвэл бараатай бол хориглоно. null = зөв. */
export function categoryDeleteBlocker(params: {
  childCount: number;
  itemCount: number;
  ruleCount?: number;
}): string | null {
  const reasons = [
    params.childCount > 0 ? `${params.childCount} дэд ангилал` : null,
    params.itemCount > 0 ? `${params.itemCount} бараа` : null,
    (params.ruleCount ?? 0) > 0 ? `${params.ruleCount} хөнгөлөлтийн дүрэм` : null,
  ].filter(Boolean);
  if (reasons.length === 0) return null;
  return `Энэ ангилалд ${reasons.join(", ")} холбогдсон тул устгах боломжгүй — эхлээд зөөнө үү, эсвэл идэвхгүй болгоно уу`;
}
