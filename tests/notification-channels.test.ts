// Фаз 2: нэмэлт сувгийн тохиргоо, custom/ сувгийн шалгалт, том дүнгийн дүрэм,
// шинэ хуваарьт дохионууд, Telegram мессежийн загвар.
import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeCustomizations, validateCustomization } from "../lib/custom/validate";
import {
  attentionSignals,
  dailyNotificationDrafts,
  type AttentionInput,
} from "../lib/notifications/attention";
import { telegramMessageFor } from "../lib/notifications/channels/telegram";
import {
  isChannelEnabled,
  parseChannelPrefs,
  serializeChannelPrefs,
} from "../lib/notifications/preferences";
import { largeAmountNotification, notificationFromAudit } from "../lib/notifications/rules";
import { computeTaxDeadlines } from "../lib/tax/calendar";

test("тохиргоо: нэмэлт суваг (telegram, custom) boolean-оор хадгалагдаж уншигдана", () => {
  const raw = serializeChannelPrefs({
    deadlines: { inApp: true, email: "instant", channels: { telegram: true, slack: false } },
  });
  assert.deepEqual(JSON.parse(raw), {
    deadlines: { inApp: true, email: "instant", telegram: true, slack: false },
  });
  const parsed = parseChannelPrefs(raw);
  assert.deepEqual(parsed.deadlines, {
    inApp: true,
    email: "instant",
    channels: { telegram: true, slack: false },
  });
  // Буруу түлхүүр / boolean биш утга хаягдана.
  assert.deepEqual(
    parseChannelPrefs('{"documents":{"Telegram":true,"x":"yes","ok_1":true}}').documents,
    { channels: { ok_1: true } }
  );
  assert.equal(isChannelEnabled(parsed, "tax.deadline", "telegram", false), true);
  assert.equal(isChannelEnabled(parsed, "tax.deadline", "slack", true), false);
  assert.equal(isChannelEnabled(parsed, "doc.posted", "telegram", true), true);
  assert.equal(isChannelEnabled(parsed, "doc.posted", "telegram", false), false);
});

test("custom/ суваг: түлхүүр, шошго, deliver шалгагдана; core түлхүүр давхцахгүй", () => {
  const ok = validateCustomization(
    {
      notificationChannels: [
        { key: "slack", label: "Slack", deliver: async () => "sent" },
      ],
    },
    []
  );
  assert.deepEqual(ok, []);
  const bad = validateCustomization(
    {
      notificationChannels: [
        { key: "Slack!", label: "S", deliver: async () => "sent" },
        { key: "telegram", label: "Telegram", deliver: async () => "sent" },
        { key: "hook", label: "Webhook" } as never,
        { key: "hook", label: "Webhook 2", deliver: async () => "skipped" },
      ],
    },
    []
  );
  assert.equal(bad.length, 5, bad.join("\n"));
  assert.ok(bad.some((e) => e.includes("core сувгийн түлхүүр")));
  assert.ok(bad.some((e) => e.includes("давхардсан")));
  assert.ok(bad.some((e) => e.includes("deliver функц дутуу")));
});

test("mergeCustomizations: сувгууд багцуудаас нийлнэ", () => {
  const merged = mergeCustomizations(
    { notificationChannels: [{ key: "a", label: "A", deliver: async () => "sent" }] },
    { tools: [] },
    { notificationChannels: [{ key: "b", label: "B", deliver: async () => "sent" }] }
  );
  assert.deepEqual(merged.notificationChannels?.map((c) => c.key), ["a", "b"]);
});

test("том дүн (D2): босгоос ≥ бол эзэн/админд, дедуп объектоор; create_posted ч орно", () => {
  const now = new Date("2026-10-07T02:00:00Z");
  const event = { userId: "acc", action: "post", entityType: "journal", entityId: "v1", summary: "…" };
  assert.equal(largeAmountNotification(event, 9_999_999, 10_000_000, now), null);
  const draft = largeAmountNotification(event, 12_400_000, 10_000_000, now)!;
  assert.equal(draft.type, "doc.large_amount");
  assert.deepEqual(draft.audience, { kind: "roles", roles: ["owner", "admin"] });
  assert.equal(draft.dedupeKey, "large:journal:v1");
  assert.ok(draft.title.includes("12,400,000"));
  assert.ok(
    largeAmountNotification({ ...event, action: "create_posted", entityType: "cash" }, 50_000_000, 10_000_000, now)
  );
  // Дүн байхгүй / буцаалт / босго 0 → үгүй.
  assert.equal(largeAmountNotification(event, null, 10_000_000, now), null);
  assert.equal(largeAmountNotification({ ...event, action: "reverse" }, 50_000_000, 10_000_000, now), null);
  assert.equal(largeAmountNotification(event, 50_000_000, 0, now), null);
  // Ердийн гүүр тусдаа хэвээр (doc.posted эзэнд нь).
  assert.equal(notificationFromAudit(event, now)?.type, "doc.posted");
});

function input(today: string, overrides: Partial<AttentionInput> = {}): AttentionInput {
  return {
    today,
    periodCode: today.slice(0, 7),
    periodStatus: "open",
    drafts: [],
    arOverdue: 0,
    apOverdue: 0,
    taxDeadlines: computeTaxDeadlines(today),
    preparedMarkers: [],
    ...overrides,
  };
}

test("банкны хуулга: импортоос 3+ хоног тулгагдаагүй бол, хуулга бүрд нэг удаа", () => {
  const drafts = dailyNotificationDrafts(
    input("2026-10-10", {
      bankUnmatched: [
        { statementId: "s1", fileName: "khan-09.xlsx", count: 12, importedAt: "2026-10-06" },
        { statementId: "s2", fileName: "golomt.csv", count: 3, importedAt: "2026-10-09" },
        { statementId: "s3", fileName: "empty.csv", count: 0, importedAt: "2026-10-01" },
      ],
    })
  ).filter((d) => d.type === "bank.unmatched");
  assert.deepEqual(drafts.map((d) => d.dedupeKey), ["unmatched:s1"]);
  assert.ok(drafts[0].title.includes("12"));
  assert.deepEqual(drafts[0].audience, { kind: "module", moduleKeys: ["cash"], minLevel: "write" });
});

test("валют: сарын сүүлийн 3 хоногт тэгшитгэл, ажлын өдөр ханш алга; валютын дансгүй бол дохиогүй", () => {
  const fx = { foreignAccounts: 2, revaluedThisMonth: false, missingRateCurrencies: ["USD"] };
  // 2026-10-28 (Лхагва) — сарын сүүлийн 3 хоногт ОРООГҮЙ (29,30,31), ханш алга.
  const mid = dailyNotificationDrafts(input("2026-10-28", { fx }));
  assert.ok(!mid.some((d) => d.type === "fx.reval_due"));
  assert.equal(mid.find((d) => d.type === "fx.rate_missing")?.dedupeKey, "fx-missing:2026-10-28");
  // 2026-10-30 (Баасан) — тэгшитгэл + ханш.
  const late = dailyNotificationDrafts(input("2026-10-30", { fx }));
  assert.equal(late.find((d) => d.type === "fx.reval_due")?.dedupeKey, "fx-due:2026-10");
  // Тэгшитгэл хийсэн бол үгүй; амралтын өдөр (2026-10-31 Бямба) ханшийн дохиогүй.
  const done = dailyNotificationDrafts(
    input("2026-10-31", { fx: { ...fx, revaluedThisMonth: true } })
  );
  assert.ok(!done.some((d) => d.type === "fx.reval_due"));
  assert.ok(!done.some((d) => d.type === "fx.rate_missing"));
  assert.ok(
    !dailyNotificationDrafts(
      input("2026-10-30", { fx: { foreignAccounts: 0, revaluedThisMonth: false, missingRateCurrencies: ["USD"] } })
    ).some((d) => d.type.startsWith("fx."))
  );
});

test("хасах үлдэгдэл: бараа×агуулах бүрд, долоо хоног тутам, danger, inv ≥write", () => {
  const drafts = dailyNotificationDrafts(
    input("2026-10-07", {
      negativeStock: [
        { itemId: "i1", itemName: "Цаас А4", warehouseId: "w1", warehouseName: "Төв", qty: -3 },
      ],
    })
  ).filter((d) => d.type === "stock.negative");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].dedupeKey, "neg:i1:w1:2026-W41");
  assert.equal(drafts[0].severity, "danger");
  assert.ok(drafts[0].title.includes("Цаас А4"));
  assert.deepEqual(drafts[0].audience, { kind: "module", moduleKeys: ["inv"], minLevel: "write" });
  // Самбарт орохгүй (daily л).
  assert.ok(
    !attentionSignals(input("2026-10-07", { negativeStock: [{ itemId: "i", itemName: "x", warehouseId: "w", warehouseName: "y", qty: -1 }] }))
      .find((s) => s.key.startsWith("neg-"))!
      .surfaces.includes("dashboard")
  );
});

test("Telegram мессеж: HTML escape, линк, severity тэмдэг", () => {
  const html = telegramMessageFor({
    organizationId: "o",
    userId: "u",
    userEmail: "a@b.mn",
    notification: {
      id: "n",
      type: "tax.deadline",
      category: "deadlines",
      severity: "warning",
      title: "НӨАТ <2026-09> — 3 хоног",
      body: "A & B",
      href: "/tax/vat",
      url: "https://app.entry.mn/tax/vat",
      createdAt: "2026-10-07T00:00:00Z",
    },
    preferences: { telegramChatId: "1" },
  });
  assert.ok(html.startsWith("⚠ <b>НӨАТ &lt;2026-09&gt; — 3 хоног</b>"));
  assert.ok(html.includes("A &amp; B"));
  assert.ok(html.includes('<a href="https://app.entry.mn/tax/vat">Нээх</a>'));
});
