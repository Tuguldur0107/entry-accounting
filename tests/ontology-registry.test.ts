// Ontology registry ↔ код / схемийн DRIFT тест (docs/ontology-audit.md §6.4, P2).
// Registry нь ОДОО БАЙГАА зан төлвийг баримтжуулдаг тул код өөрчлөгдөхөд энэ
// тест унаж registry-г ХАМТ шинэчлэхийг шаардана:
//   • хүснэгт, төлөвийн багана, FK холбоо — Drizzle схемтэй;
//   • төлвүүд — схемийн тайлбар, TS толь (PurchaseOrderStatus, QPAY_INTENT_STATUSES),
//     lib/status.ts-ийн шошго, QPay-ийн TRANSITIONS-тэй;
//   • код дахь `<table>.status`-ийн бүх литерал — бүртгэлтэй төлөв;
//   • tool — бүгд байгаа, объектын бичих tool бүр ontology-д холбогдсон;
//   • «AI: Шууд бичих горим» гэсэн шалгалт бүр runner-т бодитоор байгаа.
// DB шаардахгүй (CI-ийн нэгж тестийн алхамд).

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

import { aiToolRateKind } from "../lib/ai/rate-limit";
import { allAiTools } from "../lib/ai/tools";
import * as schema from "../lib/db/schema";
import { describeOntology } from "../lib/ontology/describe";
import { ONTOLOGY_OBJECTS, objectProblems, ontologyObject, ontologyToolNames, transitionsFrom } from "../lib/ontology";
import { canTransition } from "../lib/qpay/intent";
import { QPAY_INTENT_STATUSES } from "../lib/qpay/constants";
import { DOCUMENT_STATUS } from "../lib/status";

const tables = new Map<string, { exportName: string; config: ReturnType<typeof getTableConfig> }>();
for (const [exportName, value] of Object.entries(schema))
  if (is(value, PgTable)) {
    const config = getTableConfig(value);
    tables.set(config.name, { exportName, config });
  }
const tableOf = (name: string) => {
  const table = tables.get(name);
  assert.ok(table, `схемд «${name}» хүснэгт алга`);
  return table;
};
const fkTarget = (tableName: string, column: string) =>
  tableOf(tableName)
    .config.foreignKeys.map((fk) => fk.reference())
    .find((ref) => ref.columns.length === 1 && ref.columns[0].name === column);

const SCHEMA_SOURCE = readFileSync("lib/db/schema.ts", "utf8");
const TOOLS_SOURCE = readFileSync("lib/ai/tools.ts", "utf8");

function libFiles(dir = "lib"): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return path === join("lib", "ontology") ? [] : libFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

test("объект бүр дотооддоо зөв, freeze хийгдсэн, түлхүүр давхардаагүй", () => {
  const keys = ONTOLOGY_OBJECTS.map((object) => object.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const object of ONTOLOGY_OBJECTS) {
    assert.deepEqual(objectProblems(object), [], object.key);
    assert.ok(Object.isFrozen(object) && Object.isFrozen(object.transitions[0]), `${object.key} freeze`);
  }
});

test("хүснэгт ба төлөвийн багана схемд байна; default нь үүсэх төлөв", () => {
  for (const object of ONTOLOGY_OBJECTS) {
    const column = tableOf(object.table).config.columns.find((item) => item.name === object.statusColumn);
    assert.ok(column, `${object.table}.${object.statusColumn} алга`);
    assert.ok(column.notNull, `${object.table}.${object.statusColumn} NOT NULL`);
    assert.ok(
      (object.initial as readonly string[]).includes(String(column.default)),
      `${object.table} default «${String(column.default)}» initial-д алга`
    );
  }
});

test("схемийн тайлбар дахь төлвийн толь ontology-тай ИЖИЛ", () => {
  for (const object of ONTOLOGY_OBJECTS) {
    const start = SCHEMA_SOURCE.search(new RegExp(`pgTable\\(\\s*"${object.table}"`));
    assert.ok(start >= 0, object.table);
    const line = SCHEMA_SOURCE.slice(start).match(/\n\s*status: text\("status"\)[^\n]*/)?.[0] ?? "";
    const comment = line.split("//")[1];
    if (!comment) continue; // тайлбаргүй — TS төрлөөр шалгагдана (PO, QPay)
    const listed = [...comment.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();
    assert.deepEqual(listed, Object.keys(object.states).sort(), `${object.table} schema.ts тайлбар`);
  }
});

test("FK холбоо схемтэй таарна (soft/polymorphic нь FK-гүй багана)", () => {
  for (const object of ONTOLOGY_OBJECTS)
    for (const relation of object.relations) {
      tableOf(relation.targetTable);
      const [owner, target] =
        relation.cardinality === "one" ? [object.table, relation.targetTable] : [relation.targetTable, object.table];
      const ownerColumns = tableOf(owner).config.columns.map((column) => column.name);
      assert.ok(ownerColumns.includes(relation.column), `${object.key}.${relation.name}: ${owner}.${relation.column} алга`);
      const ref = fkTarget(owner, relation.column);
      if (relation.kind === "fk")
        assert.equal(ref && getTableConfig(ref.foreignTable).name, target, `${object.key}.${relation.name}: ${owner}.${relation.column} → ${target} FK`);
      else assert.equal(ref, undefined, `${object.key}.${relation.name}: FK байгаа тул kind "fk" болгоно`);
    }
});

test("төлвийн шошго lib/status.ts-тэй ИЖИЛ; QPay шилжилт lib/qpay/intent.ts-тэй ИЖИЛ", () => {
  for (const object of ONTOLOGY_OBJECTS) {
    if (object.key === "qpay_intent") continue;
    for (const [state, def] of Object.entries(object.states))
      assert.equal(def.label, DOCUMENT_STATUS[state]?.label, `${object.key}.${state} шошго`);
  }
  const qpay = ontologyObject("qpay_intent")!;
  assert.deepEqual(Object.keys(qpay.states).sort(), [...QPAY_INTENT_STATUSES].sort());
  for (const from of QPAY_INTENT_STATUSES)
    for (const to of QPAY_INTENT_STATUSES)
      assert.equal(
        transitionsFrom(qpay, from).some((transition) => transition.to === to),
        canTransition(from, to),
        `qpay ${from} → ${to}`
      );
});

test("код дахь `<table>.status`-ийн литерал бүр бүртгэлтэй төлөв", () => {
  const byExport = new Map(ONTOLOGY_OBJECTS.map((object) => [tableOf(object.table).exportName, object]));
  const problems: string[] = [];
  const check = (file: string, exportName: string, literal: string) => {
    const object = byExport.get(exportName);
    if (object && !(literal in object.states)) problems.push(`${file}: ${exportName}.status «${literal}»`);
  };
  for (const file of libFiles()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\b(?:eq|ne)\(\s*(\w+)\.status,\s*"([a-z_]+)"\s*\)/g)) check(file, match[1], match[2]);
    for (const match of source.matchAll(/\b(?:inArray|notInArray)\(\s*(\w+)\.status,\s*\[([^\]]*)\]/g))
      for (const literal of match[2].matchAll(/"([a-z_]+)"/g)) check(file, match[1], literal[1]);
    for (const match of source.matchAll(/\.update\(\s*(\w+)\s*\)\s*\.set\(\s*\{[^{}]*?\bstatus:\s*"([a-z_]+)"/g))
      check(file, match[1], match[2]);
  }
  assert.deepEqual(problems, []);
});

test("ontology-ийн tool бүр байгаа; объектын БИЧИХ tool бүр ontology-д холбогдсон", () => {
  const names = new Set(allAiTools().map((tool) => tool.name));
  const mapped = new Set(ontologyToolNames());
  assert.deepEqual([...mapped].filter((name) => !names.has(name)), [], "байхгүй tool");
  assert.ok(names.has("describe_ontology"));
  assert.equal(aiToolRateKind("describe_ontology"), "read");
  // Эдгээр нэртэй бичих tool шинээр нэмэгдвэл ontology-д шилжилтээ бүртгэнэ.
  const OBJECT_TOOL = /journal_voucher|arap_(document|invoice)|cash_(document|transaction)|purchase_order/;
  const unmapped = [...names].filter(
    (name) => OBJECT_TOOL.test(name) && aiToolRateKind(name) === "write" && !mapped.has(name)
  );
  assert.deepEqual(unmapped, []);
});

test("«AI: Шууд бичих горим» гэсэн шалгалт runner-т бодитоор байна", () => {
  const problems: string[] = [];
  for (const object of ONTOLOGY_OBJECTS)
    for (const transition of object.transitions) {
      if (!transition.tool || !transition.guards.includes("ai_post_mode")) continue;
      const runner = TOOLS_SOURCE.match(new RegExp(`case "${transition.tool.name}":\\s*return await (run\\w+)`))?.[1];
      const start = runner ? TOOLS_SOURCE.indexOf(`async function ${runner}(`) : -1;
      const body = start >= 0 ? TOOLS_SOURCE.slice(start, TOOLS_SOURCE.indexOf("\nasync function ", start + 1)) : "";
      if (!/assertPostMode\(|mode\s*[!=]==\s*"post"/.test(body)) problems.push(`${transition.tool.name} (${runner ?? "runner алга"})`);
    }
  assert.deepEqual(problems, []);
});

test("describe_ontology: жагсаалт, forState, алдааны код, хэмжээ", () => {
  const list = describeOntology();
  assert.ok("text" in list && ONTOLOGY_OBJECTS.every((object) => list.text.includes(object.key)));

  const posted = describeOntology({ object: "journal_voucher", forState: "posted" });
  assert.ok("text" in posted);
  assert.match(posted.text, /reverse: posted → reversed · tool reverse_journal_voucher/);
  assert.match(posted.text, /БОЛОМЖГҮЙ: update \(зөвхөн draft\), post \(зөвхөн draft\), delete \(зөвхөн draft\)/);

  for (const object of ONTOLOGY_OBJECTS) {
    const full = describeOntology({ object: object.key });
    assert.ok("text" in full && full.text.length < 4_000, `${object.key} хэт урт`);
    const json = describeOntology({ object: object.key, format: "json" });
    assert.ok("text" in json && JSON.parse(json.text).key === object.key);
  }
  assert.deepEqual(describeOntology({ object: "nope" }).hasOwnProperty("error"), true);
  assert.match((describeOntology({ object: "cash_document", forState: "paid" }) as { error: string }).error, /^\[INVALID_STATE\]/);
  assert.match((describeOntology({ forState: "draft" }) as { error: string }).error, /^\[OBJECT_REQUIRED\]/);
});
