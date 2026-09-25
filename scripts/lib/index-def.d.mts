// `index-def.mjs` нь plain JS (production-д tsx байхгүй байж болзошгүй тул
// preDeploy script TS импортлохгүй) — тестээс төрөлтэй дуудахын тулд зарлалыг
// энд тусад нь бичнэ.

export function predicateOfIndexDef(indexdef: string | null | undefined): string;
export function normalizeIndexPredicate(text: string | null | undefined): string;
export function indexPredicateMatches(
  indexdef: string | null | undefined,
  expectedPredicate: string
): boolean;
