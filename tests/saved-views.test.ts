import test from "node:test";
import assert from "node:assert/strict";

import { decodeViewState, encodeViewState } from "../lib/grid/saved-views";

test("encode → decode round-trip (кирилл шүүлттэй)", () => {
  const state = {
    f: {
      description: { filterType: "text", type: "contains", filter: "цалин" },
      status: { values: ["draft"] },
    },
    c: [{ colId: "date", sort: "desc" as const, sortIndex: 0 }],
  };
  const encoded = encodeViewState(state);
  // base64url — URL-д аюулгүй тэмдэгтүүд л байна
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  const decoded = decodeViewState(encoded);
  assert.deepEqual(decoded, { v: 1, ...state });
});

test("эвдэрсэн оролтод null — хуудас унахгүй", () => {
  assert.equal(decodeViewState("!!!не-base64!!!"), null);
  assert.equal(decodeViewState(""), null);
  // Хүчинтэй base64 ч JSON биш
  assert.equal(decodeViewState(Buffer.from("plain text").toString("base64url")), null);
  // Хувилбар зөрсөн
  assert.equal(
    decodeViewState(Buffer.from(JSON.stringify({ v: 2, f: {}, c: [] })).toString("base64url")),
    null
  );
  // sort утга буруу
  assert.equal(
    decodeViewState(
      Buffer.from(
        JSON.stringify({ v: 1, f: {}, c: [{ colId: "x", sort: "up" }] })
      ).toString("base64url")
    ),
    null
  );
});
