// Партиал индексийн ПРЕДИКАТЫГ schema.ts-ийн бичлэгтэй харьцуулах ЦЭВЭР логик
// (tests/index-def.test.ts). `apply-pending-ddl.mjs`-ийн ensurePartialIndex
// үүгээр DB-ийн индексийг schema-тай тулгаж, зөрвөл дахин үүсгэнэ.
//
// ШАЛТГААН (#90): cost_entries_movement_active_uq нь `if not exists`-ээр
// хэзээ ч шинэчлэгдээгүй тул schema.ts-д `cogs_true_up`-ийг хассан ч DB дээр
// хуучин предикат үлдэж, залруулга бүр unique violation өгдөг байв;
// drizzle-kit push партиал индексийн предикатын diff-ийг найдвартай танихгүй.
//
// pg_get_indexdef нь предикатыг ДАХИН БИЧДЭГ тул текстээр шууд тулгаж болохгүй:
//   schema:  movement_id is not null and status <> 'reversed'
//            and entry_type not in ('landed_cost', 'cogs_true_up')
//   pg:      ((movement_id IS NOT NULL) AND (status <> 'reversed'::text)
//            AND (entry_type <> ALL (ARRAY['landed_cost'::text, 'cogs_true_up'::text])))
// Хоёр талыг нэг каноник хэлбэрт оруулна.

/** CREATE INDEX … WHERE <предикат> — WHERE-ийн дараах хэсэг (байхгүй бол ""). */
export function predicateOfIndexDef(indexdef) {
  const match = /\bwhere\b\s*([\s\S]*)$/i.exec(String(indexdef ?? ""));
  return match ? match[1] : "";
}

/** Предикатыг каноник хэлбэрт: cast-гүй, хаалтгүй, in-жагсаалт [..], нэг зайтай. */
export function normalizeIndexPredicate(text) {
  let s = String(text ?? "").toLowerCase();
  // ::text, ::integer, ::text[] … (нэг үгтэй cast)
  s = s.replace(/::[a-z_]+(\[\])?/g, "");
  // pg-ийн дахин бичилт → schema-ийн хэлбэр
  s = s.replace(/<>\s*all\s*\(\s*array\s*\[([^\]]*)\]\s*\)/g, "not in [$1]");
  s = s.replace(/=\s*any\s*\(\s*array\s*\[([^\]]*)\]\s*\)/g, "in [$1]");
  // schema-ийн `not in (…)` / `in (…)` → ижил хаалт
  s = s.replace(/\bnot\s+in\s*\(([^)]*)\)/g, "not in [$1]");
  s = s.replace(/\bin\s*\(([^)]*)\)/g, "in [$1]");
  s = s.replace(/!=/g, "<>");
  s = s.replace(/[()]/g, " ");
  s = s.replace(/\s*,\s*/g, ", ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** DB-ийн indexdef-ийн предикат schema-ийн предикаттай ИЖИЛ утгатай юу. */
export function indexPredicateMatches(indexdef, expectedPredicate) {
  return (
    normalizeIndexPredicate(predicateOfIndexDef(indexdef)) ===
    normalizeIndexPredicate(expectedPredicate)
  );
}
