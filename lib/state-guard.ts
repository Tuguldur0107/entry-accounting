// Зэрэгцээ үйлдлийн хамгаалалт (docs/ontology-audit.md C4) — ЦЭВЭР (DB импортгүй).
//
// Засах/устгах/батлах зам баримтаа ЭХЛЭЭД уншиж шалгаад, дараа нь бичдэг.
// Хооронд нь өөр хүсэлт (AI-ийн параллель tool дуудлага, давхар товшилт)
// баримтыг батлах/засах/устгах боломжтой. Тиймээс бичилт бүр уншсан
// төлөвтөө нөхцөлтэй байна: `WHERE status = <уншсан> AND <түлхүүр талбар
// өөрчлөгдөөгүй>` + `RETURNING`; 0 мөр бол `stateChangedError()` — транзакц
// буцаж, хэрэглэгч/AI дахин ачаалж шалгана. Хэзээ ч чимээгүй дарж бичихгүй.

import { and, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const STATE_CHANGED_CODE = "STATE_CHANGED";

export function stateChangedError(what = "Баримт"): Error {
  return new Error(
    `[${STATE_CHANGED_CODE}] ${what} зэрэгцээ үйлдлээр өөрчлөгдсөн (батлагдсан, засагдсан эсвэл устгагдсан) — дахин ачаалж шалгаад оролдоно уу`
  );
}

/**
 * Уншсан утгуудаасаа өөрчлөгдөөгүй нөхцөл (`IS NOT DISTINCT FROM` — null-тэй
 * ч зөв). Утга нь DB-ээс уншсан ТЭР хэлбэрээрээ (numeric → string) өгөгдөнө;
 * Date объект өгөхгүй (tests/sql-date-params.test.ts).
 */
export function unchangedSince(pairs: [AnyPgColumn, string | number | boolean | null][]): SQL {
  return and(...pairs.map(([column, value]) => sql`${column} is not distinct from ${value}`))!;
}
