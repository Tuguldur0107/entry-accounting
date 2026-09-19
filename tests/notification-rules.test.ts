// Аудит → мэдэгдлийн гүүрийн дүрэм (lib/notifications/rules.ts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { minuteStamp, notificationFromAudit } from "../lib/notifications/rules";

const NOW = new Date("2026-10-07T02:12:30Z");

test("post → doc.posted зөвхөн ноорог үүсгэсэн хүнд (entity-owner, D4)", () => {
  const draft = notificationFromAudit(
    {
      userId: "actor",
      action: "post",
      entityType: "journal",
      entityId: "v1",
      summary: "Журнал батлагдав — 2026-10-07, түрээс, дүн 12,400,000₮",
    },
    NOW
  );
  assert.ok(draft);
  assert.equal(draft.type, "doc.posted");
  assert.deepEqual(draft.audience, { kind: "entity-owner" });
  assert.equal(draft.entityType, "journal");
  assert.equal(draft.entityId, "v1");
  assert.equal(draft.href, "/gl/journal");
  assert.equal(draft.body, "Журнал батлагдав — 2026-10-07, түрээс, дүн 12,400,000₮");
  assert.equal(draft.dedupeKey, "post:journal:v1:2026-10-07T02:12");
  assert.deepEqual(draft.payload, { action: "post" });
});

test("create_posted (шууд бичилт) ноорог хүлээж байгаагүй → мэдэгдэлгүй", () => {
  assert.equal(
    notificationFromAudit(
      { userId: "a", action: "create_posted", entityType: "journal", entityId: "v2" },
      NOW
    ),
    null
  );
});

test("reverse/unpost/fx_reverse → doc.reversed, модулийн батлах эрхтэй бүгдэд", () => {
  for (const [action, entityType, keys] of [
    ["reverse", "arap", ["ar", "ap"]],
    ["unpost", "journal", ["gl"]],
    ["fx_reverse", "cash", ["cash"]],
    ["reverse", "fa", ["fa"]],
  ] as const) {
    const draft = notificationFromAudit(
      { userId: "a", action, entityType, entityId: "x" },
      NOW
    );
    assert.ok(draft, `${action}:${entityType}`);
    assert.equal(draft.type, "doc.reversed");
    assert.equal(draft.severity, "warning");
    assert.deepEqual(draft.audience, { kind: "module", moduleKeys: [...keys], minLevel: "post" });
  }
});

test("хангамж: approve/close/confirm → proc ≥read", () => {
  const approved = notificationFromAudit(
    { userId: "a", action: "approve", entityType: "purchase_order", entityId: "po1" },
    NOW
  );
  assert.equal(approved?.type, "po.approved");
  assert.deepEqual(approved?.audience, { kind: "module", moduleKeys: ["proc"], minLevel: "read" });
  assert.equal(
    notificationFromAudit(
      { userId: "a", action: "close", entityType: "purchase_order", entityId: "po1" },
      NOW
    )?.type,
    "po.closed"
  );
  assert.equal(
    notificationFromAudit(
      { userId: "a", action: "confirm", entityType: "goods_receipt", entityId: "gr1" },
      NOW
    )?.type,
    "gr.confirmed"
  );
});

test("период хаах/нээх → бүх гишүүнд (D5), гарчигт код", () => {
  const closed = notificationFromAudit(
    { userId: "a", action: "close", entityType: "period", entityId: "2026-09" },
    NOW
  );
  assert.equal(closed?.type, "period.closed");
  assert.deepEqual(closed?.audience, { kind: "everyone" });
  assert.equal(closed?.title, "2026-09 тайлант үе хаагдлаа");
  assert.equal(closed?.href, "/settings/periods");
  const reopened = notificationFromAudit(
    { userId: "a", action: "reopen", entityType: "period", entityId: "2026-09" },
    NOW
  );
  assert.equal(reopened?.type, "period.reopened");
  assert.equal(reopened?.severity, "warning");
});

test("гишүүний эрх өөрчлөгдөх → тухайн гишүүнд (entity-owner)", () => {
  const draft = notificationFromAudit(
    { userId: "admin", action: "permissions", entityType: "membership", entityId: "m1" },
    NOW
  );
  assert.equal(draft?.type, "member.role_changed");
  assert.deepEqual(draft?.audience, { kind: "entity-owner" });
  assert.equal(draft?.href, "/settings/permissions");
});

test("цалингийн журнал → payroll ≥post", () => {
  const draft = notificationFromAudit(
    { userId: "a", action: "create_voucher", entityType: "payroll", entityId: "2026-09" },
    NOW
  );
  assert.equal(draft?.type, "payroll.voucher_created");
  assert.deepEqual(draft?.audience, { kind: "module", moduleKeys: ["payroll"], minLevel: "post" });
});

test("таарахгүй үйл явдал чимээгүй алгасна (delete, update, sync, attach)", () => {
  for (const [action, entityType] of [
    ["delete", "journal"],
    ["update", "cash_account"],
    ["sync", "exchange_rate"],
    ["attach", "purchase_order"],
    ["post", "fa"],
  ] as const)
    assert.equal(
      notificationFromAudit({ userId: "a", action, entityType, entityId: "x" }, NOW),
      null,
      `${action}:${entityType}`
    );
});

test("minuteStamp: секундыг хаяна — нэг минутын retry нэг dedupeKey", () => {
  assert.equal(minuteStamp(new Date("2026-10-07T02:12:59Z")), "2026-10-07T02:12");
  assert.equal(minuteStamp(new Date("2026-10-07T02:13:00Z")), "2026-10-07T02:13");
});
