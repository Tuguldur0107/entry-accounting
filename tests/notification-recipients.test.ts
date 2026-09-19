// Хүлээн авагчийн шүүлт (lib/notifications/recipients.ts) + тохиргооны тайлбар
// (lib/notifications/preferences.ts).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emailModeFor,
  isInAppEnabled,
  parseChannelPrefs,
  serializeChannelPrefs,
} from "../lib/notifications/preferences";
import { selectRecipients } from "../lib/notifications/recipients";
import type { MemberLike } from "../lib/notifications/types";

const members: MemberLike[] = [
  { userId: "owner", role: "owner", permissions: null },
  { userId: "admin", role: "admin", permissions: null },
  { userId: "acc", role: "accountant", permissions: null },
  // Нягтлан — цалинд «Байхгүй», кассанд зөвхөн унших.
  { userId: "acc2", role: "accountant", permissions: '{"payroll":"none","cash":"read"}' },
  { userId: "viewer", role: "viewer", permissions: null },
];

test("everyone: бүх гишүүн, actor хасагдана", () => {
  assert.deepEqual(selectRecipients(members, { kind: "everyone" }, "acc"), [
    "owner",
    "admin",
    "acc2",
    "viewer",
  ]);
});

test("module ≥post: viewer орохгүй, owner/admin үргэлж, none-той нягтлан орохгүй", () => {
  assert.deepEqual(
    selectRecipients(members, { kind: "module", moduleKeys: ["payroll"], minLevel: "post" }),
    ["owner", "admin", "acc"]
  );
  assert.deepEqual(
    selectRecipients(members, { kind: "module", moduleKeys: ["cash"], minLevel: "write" }),
    ["owner", "admin", "acc"]
  );
  // read түвшинд acc2 (cash:read) ба viewer орно.
  assert.deepEqual(
    selectRecipients(members, { kind: "module", moduleKeys: ["cash"], minLevel: "read" }),
    ["owner", "admin", "acc", "acc2", "viewer"]
  );
});

test("module олон түлхүүр: АЛЬ НЭГЭНД нь эрхтэй бол орно", () => {
  const rows: MemberLike[] = [
    { userId: "ar-only", role: "accountant", permissions: '{"ap":"none"}' },
    { userId: "none", role: "accountant", permissions: '{"ar":"none","ap":"none"}' },
  ];
  assert.deepEqual(
    selectRecipients(rows, { kind: "module", moduleKeys: ["ar", "ap"], minLevel: "read" }),
    ["ar-only"]
  );
});

test("roles / users: гишүүн бус хэрэглэгч, давхардал хасагдана", () => {
  assert.deepEqual(selectRecipients(members, { kind: "roles", roles: ["owner", "admin"] }), [
    "owner",
    "admin",
  ]);
  assert.deepEqual(
    selectRecipients(members, { kind: "users", userIds: ["acc", "ghost", "acc"] }),
    ["acc"]
  );
  // Actor өөрөө тодорхой хүлээн авагч байсан ч хасагдана.
  assert.deepEqual(selectRecipients(members, { kind: "users", userIds: ["acc"] }, "acc"), []);
});

test("entity-owner шийдэгдээгүй бол хэнд ч очихгүй (таамаглахгүй)", () => {
  assert.deepEqual(selectRecipients(members, { kind: "entity-owner" }), []);
});

test("parseChannelPrefs fail-safe: буруу JSON/утга default руу", () => {
  assert.deepEqual(parseChannelPrefs(null), {});
  assert.deepEqual(parseChannelPrefs("{nope"), {});
  assert.deepEqual(parseChannelPrefs('{"documents":{"inApp":false,"email":"weekly"}}'), {
    documents: { inApp: false },
  });
  const raw = serializeChannelPrefs({ deadlines: { email: "off" } });
  assert.deepEqual(parseChannelPrefs(raw), { deadlines: { email: "off" } });
});

test("isInAppEnabled / emailModeFor: тохиргоо → каталог default", () => {
  assert.equal(isInAppEnabled({}, "tax.deadline"), true);
  assert.equal(isInAppEnabled({ deadlines: { inApp: false } }, "tax.deadline"), false);
  // D1: хугацаа instant, баримт digest.
  assert.equal(emailModeFor({}, "tax.deadline"), "instant");
  assert.equal(emailModeFor({}, "doc.posted"), "digest");
  assert.equal(emailModeFor({ documents: { email: "off" } }, "doc.posted"), "off");
});
