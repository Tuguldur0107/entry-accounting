// Байгууллага устгах дараалал (lib/org/purge-order.ts).
// Цэвэр хэсэг: FK графын шалгагч. DB хэсэг (DATABASE_URL-тэй үед): БОДИТ
// каталогийн бүх RESTRICT/NO ACTION FK-д ORG_PURGE_ORDER хүрэлцэх эсэх —
// шинэ RESTRICT FK нэмэгдэхэд энэ тест унаж дараалалд бүртгэхийг шаардана.
// Бодит өгөгдөлтэй устгалт: simulation-regressions (цалин/POS/PO/төлбөр) ба
// procurement-flow тестийн цэвэрлэгээ `purgeOrganization`-оор явна.

import "./helpers/load-env";

import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import {
  ORG_PURGE_ORDER,
  findPurgeViolations,
  type ForeignKeyInfo,
} from "../lib/org/purge-order";

const DB_READY = !!process.env.DATABASE_URL;

const orgFk = (child: string): ForeignKeyInfo => ({
  child,
  parent: "organizations",
  onDelete: "c",
  notNull: true,
});

test("дараалалгүй бол RESTRICT хүүхэд cascade дундаас гацна (асуудлын загвар)", () => {
  const fks: ForeignKeyInfo[] = [
    orgFk("employees"),
    orgFk("payroll_runs"),
    { child: "payroll_run_lines", parent: "payroll_runs", onDelete: "c", notNull: true },
    { child: "payroll_run_lines", parent: "employees", onDelete: "r", notNull: true },
  ];
  const v = findPurgeViolations([], fks);
  assert.equal(v.length, 1);
  assert.equal(v[0].child, "payroll_run_lines");
  assert.equal(v[0].parent, "employees");
  assert.deepEqual(findPurgeViolations(["payroll_runs"], fks), []);
});

test("хүүхэд эцгээсээ ХОЙШ жагсаагдвал зөрчил", () => {
  const fks: ForeignKeyInfo[] = [
    orgFk("purchase_orders"),
    orgFk("goods_receipts"),
    { child: "goods_receipts", parent: "purchase_orders", onDelete: "r", notNull: true },
  ];
  assert.equal(findPurgeViolations(["purchase_orders", "goods_receipts"], fks).length, 1);
  assert.deepEqual(findPurgeViolations(["goods_receipts", "purchase_orders"], fks), []);
});

test("nullable cascade эцэг нь хүүхдийг бүрэн устгасанд тооцогдохгүй", () => {
  const fks: ForeignKeyInfo[] = [
    orgFk("items"),
    orgFk("docs"),
    orgFk("lines"),
    { child: "lines", parent: "docs", onDelete: "c", notNull: false },
    { child: "lines", parent: "items", onDelete: "r", notNull: false },
  ];
  // docs-ыг устгахад docId-гүй мөр үлдэж болно → items (org cascade) дээр гацна
  assert.equal(findPurgeViolations(["docs"], fks).length, 1);
  assert.deepEqual(findPurgeViolations(["lines"], fks), []);
});

test("устгагдахгүй эцэг (users) ба NO ACTION өөрийгөө заасан FK зөрчил биш", () => {
  const fks: ForeignKeyInfo[] = [
    orgFk("pos_sales"),
    { child: "pos_sales", parent: "users", onDelete: "r", notNull: true },
    orgFk("inventory_categories"),
    { child: "inventory_categories", parent: "inventory_categories", onDelete: "a", notNull: false },
  ];
  assert.deepEqual(findPurgeViolations([], fks), []);
});

test("ORG_PURGE_ORDER давхардалгүй", () => {
  assert.equal(new Set(ORG_PURGE_ORDER).size, ORG_PURGE_ORDER.length);
});

test("DB каталог: бүх RESTRICT/NO ACTION FK-д ORG_PURGE_ORDER хүрэлцэнэ", { skip: !DB_READY }, async () => {
  const { db } = await import("../lib/db");
  const rows = (await db.execute(sql`
    select c.conrelid::regclass::text as child,
           c.confrelid::regclass::text as parent,
           c.confdeltype as on_delete,
           bool_and(a.attnotnull) as not_null
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and n.nspname = 'public'
     group by c.oid, c.conrelid, c.confrelid, c.confdeltype
  `)) as unknown as { child: string; parent: string; on_delete: string; not_null: boolean }[];
  assert.ok(rows.length > 50, "FK каталог уншигдах ёстой");
  const fks: ForeignKeyInfo[] = rows.map((r) => ({
    child: r.child,
    parent: r.parent,
    onDelete: r.on_delete as ForeignKeyInfo["onDelete"],
    notNull: r.not_null,
  }));
  assert.deepEqual(findPurgeViolations(ORG_PURGE_ORDER, fks), []);

  // Жагсаалтын хүснэгт бүр organization_id NOT NULL-тэй (устгах хүрээ = байгууллага)
  const cols = (await db.execute(sql`
    select table_name, is_nullable from information_schema.columns
     where table_schema = 'public' and column_name = 'organization_id'
  `)) as unknown as { table_name: string; is_nullable: string }[];
  const byTable = new Map(cols.map((c) => [c.table_name, c.is_nullable]));
  for (const t of ORG_PURGE_ORDER) {
    assert.equal(byTable.get(t), "NO", `${t}.organization_id NOT NULL байх ёстой`);
  }
});
