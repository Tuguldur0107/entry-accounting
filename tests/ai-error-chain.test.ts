import assert from "node:assert/strict";
import { test } from "node:test";

import { describeErrorChain } from "../lib/ai/error-sanitize";

// Drizzle + postgres-js-ийн бодит хэлбэр: гадна DrizzleQueryError («Failed
// query: …»), cause-д PostgresError (SQLSTATE, constraint_name, detail).
function drizzleUniqueViolation() {
  const pg = Object.assign(
    new Error('duplicate key value violates unique constraint "cost_entries_movement_active_uq"'),
    {
      name: "PostgresError",
      code: "23505",
      constraint_name: "cost_entries_movement_active_uq",
      table_name: "cost_entries",
      detail: "Key (movement_id)=(d00e50a0-…) already exists.",
    }
  );
  return Object.assign(
    new Error(
      'Failed query: insert into "cost_entries" ("id", "user_id", …) values (default, $1, $2, …)'
    ),
    { name: "DrizzleQueryError", cause: pg }
  );
}

test("describeErrorChain: cause гинжний SQLSTATE, constraint, detail нэг мөрөнд", () => {
  const line = describeErrorChain(drizzleUniqueViolation());
  assert.match(line, /^DrizzleQueryError msg=Failed query: insert into "cost_entries"/);
  assert.ok(line.includes(" ← PostgresError code=23505 constraint=cost_entries_movement_active_uq table=cost_entries"));
  assert.ok(line.includes("detail=Key (movement_id)=(d00e50a0-…) already exists."));
});

test("describeErrorChain: энгийн Error ба Error биш утга", () => {
  assert.equal(describeErrorChain(new Error("boom")), "Error msg=boom");
  assert.equal(describeErrorChain({ message: "obj" }), "error msg=obj");
  assert.equal(describeErrorChain("string"), "error");
  assert.equal(describeErrorChain(null), "");
});

test("describeErrorChain: урт мессеж 200 тэмдэгтээр таслагдана, өөрийгөө cause болгосон гинж зогсоно", () => {
  const long = new Error("x".repeat(500));
  assert.ok(describeErrorChain(long).length < 260);
  const loop = new Error("loop") as Error & { cause?: unknown };
  loop.cause = loop;
  const parts = describeErrorChain(loop).split(" ← ");
  assert.equal(parts.length, 6);
});
