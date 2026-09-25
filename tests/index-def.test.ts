import { test } from "node:test";
import assert from "node:assert/strict";

import {
  indexPredicateMatches,
  normalizeIndexPredicate,
  predicateOfIndexDef,
} from "../scripts/lib/index-def.mjs";

// schema.ts (lib/db/schema.ts cost_entries_movement_active_uq) — apply-pending-ddl
// ensurePartialIndex-д өгдөг предикат
const SCHEMA_PREDICATE =
  "movement_id is not null and status <> 'reversed' and entry_type not in ('landed_cost', 'cogs_true_up')";

// pg_get_indexdef-ийн бодит гаралт (Postgres 16): хаалт, ::text, <> ALL (ARRAY[…])
const PG_INDEXDEF =
  "CREATE UNIQUE INDEX cost_entries_movement_active_uq ON public.cost_entries USING btree (movement_id) " +
  "WHERE ((movement_id IS NOT NULL) AND (status <> 'reversed'::text) AND " +
  "(entry_type <> ALL (ARRAY['landed_cost'::text, 'cogs_true_up'::text])))";

// #90-ээс ӨМНӨХ DB — migrations/0015: зөвхөн landed_cost-ыг хасдаг
const OLD_INDEXDEF =
  "CREATE UNIQUE INDEX cost_entries_movement_active_uq ON public.cost_entries USING btree (movement_id) " +
  "WHERE ((movement_id IS NOT NULL) AND (status <> 'reversed'::text) AND (entry_type <> 'landed_cost'::text))";

test("predicateOfIndexDef: WHERE-ийн дараах хэсэг, байхгүй бол хоосон", () => {
  assert.equal(
    predicateOfIndexDef("CREATE INDEX x ON t USING btree (a) WHERE (a IS NOT NULL)"),
    "(a IS NOT NULL)"
  );
  assert.equal(predicateOfIndexDef("CREATE INDEX x ON t USING btree (a)"), "");
  assert.equal(predicateOfIndexDef(null), "");
});

test("normalizeIndexPredicate: pg-ийн дахин бичилт ба schema-ийн бичлэг нэг хэлбэрт", () => {
  const canonical = "movement_id is not null and status <> 'reversed' and entry_type not in ['landed_cost', 'cogs_true_up']";
  assert.equal(normalizeIndexPredicate(SCHEMA_PREDICATE), canonical);
  assert.equal(normalizeIndexPredicate(predicateOfIndexDef(PG_INDEXDEF)), canonical);
});

test("normalizeIndexPredicate: = ANY(ARRAY) ↔ in (…), != ↔ <>, cast, зай", () => {
  assert.equal(
    normalizeIndexPredicate("(status = ANY (ARRAY['pending'::text, 'claimed'::text]))"),
    normalizeIndexPredicate("status in ('pending','claimed')")
  );
  assert.equal(normalizeIndexPredicate("a != 1"), normalizeIndexPredicate("( a <> 1 )"));
});

test("indexPredicateMatches: одоогийн DB таарна, #90-ээс өмнөх DB зөрнө", () => {
  assert.equal(indexPredicateMatches(PG_INDEXDEF, SCHEMA_PREDICATE), true);
  assert.equal(indexPredicateMatches(OLD_INDEXDEF, SCHEMA_PREDICATE), false);
});

test("indexPredicateMatches: cost_entries_true_up_draft_uq", () => {
  const schema = "movement_id is not null and entry_type = 'cogs_true_up' and status = 'draft'";
  const pg =
    "CREATE UNIQUE INDEX cost_entries_true_up_draft_uq ON public.cost_entries USING btree (movement_id) " +
    "WHERE ((movement_id IS NOT NULL) AND (entry_type = 'cogs_true_up'::text) AND (status = 'draft'::text))";
  assert.equal(indexPredicateMatches(pg, schema), true);
});
