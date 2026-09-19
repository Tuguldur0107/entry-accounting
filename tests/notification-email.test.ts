// И-мэйл суваг — цэвэр загвар (lib/email/notification-template.ts) ба
// хүргэлтийн төлөвлөгч (lib/notifications/email-plan.ts).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNotificationEmailPayload,
  notificationEmailSubject,
  stripAmounts,
  type NotificationEmailItem,
} from "../lib/email/notification-template";
import { planEmailDelivery } from "../lib/notifications/email-plan";

const items: NotificationEmailItem[] = [
  {
    title: "Журнал батлагдлаа",
    body: "Журнал батлагдав — 2026-10-07, түрээс, дүн 12,400,000₮",
    severity: "info",
    href: "/gl/journal",
    createdAt: "2026-10-07T02:12:00Z",
  },
  {
    title: "НӨАТ (2026-09) — 3 хоног үлдлээ",
    body: "Тооцооны журнал үүсээгүй.",
    severity: "warning",
    href: "/tax/vat?period=2026-09",
    createdAt: "2026-10-07T00:00:00Z",
  },
];

test("гарчигт дүн бичигдэхгүй, нэг мэдэгдэлд гарчиг нь мэдэгдлийн нэр", () => {
  assert.equal(
    notificationEmailSubject({ orgName: "Жишээ ХХК", items: [items[0]], kind: "instant" }),
    "[Entry] Журнал батлагдлаа — Жишээ ХХК"
  );
  assert.equal(
    notificationEmailSubject({ orgName: "Жишээ ХХК", items, kind: "instant" }),
    "[Entry] 2 мэдэгдэл — Жишээ ХХК"
  );
  assert.equal(
    notificationEmailSubject({ orgName: "Жишээ ХХК", items, kind: "digest", date: "2026-10-07" }),
    "[Entry] Өдрийн нэгтгэл 2026-10-07 — Жишээ ХХК (2)"
  );
  // Гарчигт дүн орсон мэдэгдэл байсан ч (хамгаалалт) — арилна.
  assert.equal(stripAmounts("Том дүн 12,400,000₮ батлагдлаа"), "Том дүн … батлагдлаа");
  assert.equal(
    notificationEmailSubject({
      orgName: "Ж",
      items: [{ ...items[0], title: "Дүн 5,000₮" }],
      kind: "instant",
    }),
    "[Entry] Дүн … — Ж"
  );
});

test("payload: текст + HTML, линк нь app URL + href, тохиргооны линк", () => {
  const payload = buildNotificationEmailPayload({
    to: "a@b.mn",
    from: "Жишээ ХХК <noreply@entry.mn>",
    replyTo: "info@entry.mn",
    orgName: "Жишээ ХХК",
    appUrl: "https://app.entry.mn",
    items,
    kind: "instant",
  });
  assert.equal(payload.to, "a@b.mn");
  assert.equal(payload.replyTo, "info@entry.mn");
  assert.ok(payload.text.includes("https://app.entry.mn/gl/journal"));
  assert.ok(payload.text.includes("https://app.entry.mn/tax/vat?period=2026-09"));
  assert.ok(payload.text.includes("https://app.entry.mn/settings/notifications"));
  assert.ok(payload.text.includes("дүн 12,400,000₮")); // body-д дүн байж болно
  assert.ok(payload.html.includes("<strong>"));
  assert.ok(payload.html.includes("href=\"https://app.entry.mn/gl/journal\""));
  // href-гүй мэдэгдэл inbox руу.
  const noHref = buildNotificationEmailPayload({
    to: "a@b.mn",
    from: "x@y.mn",
    orgName: "Ж",
    appUrl: "https://app.entry.mn",
    items: [{ ...items[0], href: null }],
    kind: "instant",
  });
  assert.ok(noHref.text.includes("https://app.entry.mn/notifications"));
  assert.equal("replyTo" in noHref, false);
});

test("HTML escape: гарчиг/тайлбар дахь < > & аюулгүй", () => {
  const payload = buildNotificationEmailPayload({
    to: "a@b.mn",
    from: "x@y.mn",
    orgName: "Ж",
    appUrl: "https://app.entry.mn",
    items: [{ ...items[0], title: "<script>alert(1)</script> & co" }],
    kind: "instant",
  });
  assert.ok(!payload.html.includes("<script>"));
  assert.ok(payload.html.includes("&lt;script&gt;"));
});

test("planEmailDelivery: instant / digest (цаг + өдөрт нэг) / off / танигдахгүй төрөл", () => {
  const prefsByUser = new Map([
    ["u-digest", { channels: {}, digestHour: 8 }],
    ["u-off", { channels: { deadlines: { email: "off" as const } }, digestHour: 8 }],
    ["u-late", { channels: {}, digestHour: 18 }],
  ]);
  const pending = [
    { id: "n1", userId: "u-digest", type: "tax.deadline" }, // instant default
    { id: "n2", userId: "u-digest", type: "doc.posted" }, // digest default
    { id: "n3", userId: "u-off", type: "tax.deadline" }, // off
    { id: "n4", userId: "u-late", type: "doc.posted" }, // digest 18:00 — хүлээнэ
    { id: "n5", userId: "u-nopref", type: "arap.overdue" }, // default digest, мөргүй
    { id: "n6", userId: "u-nopref", type: "custom.thing" }, // танигдахгүй
    { id: "n7", userId: "u-sent", type: "doc.posted" }, // digest өнөөдөр илгээсэн
  ];
  const plan = planEmailDelivery({
    pending,
    prefsByUser,
    hourUb: 9,
    digestSentToday: new Set(["u-sent"]),
  });
  assert.deepEqual([...plan.instant.entries()], [["u-digest", ["n1"]]]);
  assert.deepEqual(
    [...plan.digest.entries()],
    [
      ["u-digest", ["n2"]],
      ["u-nopref", ["n5"]],
    ]
  );
  assert.deepEqual(plan.held.sort(), ["n3", "n4", "n6", "n7"]);

  // 18:00 болоход u-late-ийн digest явна.
  const later = planEmailDelivery({ pending, prefsByUser, hourUb: 18, digestSentToday: new Set() });
  assert.deepEqual(later.digest.get("u-late"), ["n4"]);
  assert.deepEqual(later.digest.get("u-sent"), ["n7"]);
});
