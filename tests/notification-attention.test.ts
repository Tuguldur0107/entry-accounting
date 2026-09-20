// «Анхаарах» дохионууд — самбар + өдөр тутмын мэдэгдлийн НЭГ эх
// (lib/notifications/attention.ts).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alertBucket,
  attentionSignals,
  dailyNotificationDrafts,
  dashboardAlerts,
  isoWeekKey,
  overdueTaxDeadlines,
  type AttentionInput,
} from "../lib/notifications/attention";
import { computeTaxDeadlines } from "../lib/tax/calendar";

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

test("самбар: одоогийн 8 дүрэм ижил дараалал, ижил өнгөөр", () => {
  const alerts = dashboardAlerts(
    input("2026-10-15", {
      periodStatus: "missing",
      drafts: [
        { module: "journal", count: 3, unbalanced: 1 },
        { module: "arap", count: 2 },
        { module: "inventory", count: 1 },
        { module: "cash", count: 4 },
      ],
      arOverdue: 5,
      apOverdue: 2,
    })
  );
  assert.deepEqual(
    alerts.map((a) => [a.tone, a.title]),
    [
      ["danger", "1 ноорог журнал тэнцэхгүй"],
      ["warning", "3 ноорог журнал хүлээгдэж байна"],
      ["warning", "2026-10 тайлант үе үүсээгүй"],
      ["warning", "5 авлагын хугацаа хэтэрсэн"],
      ["warning", "2 өглөгийн хугацаа хэтэрсэн"],
      ["default", "2 ноорог АР/АП баримт"],
      ["default", "1 ноорог барааны хөдөлгөөн"],
    ]
  );
  // Кассын ноорог самбарт харагдахгүй (ажлын дараалалд л) — өмнөхтэй ижил.
  assert.ok(!alerts.some((a) => a.title.includes("кассын")));
  // Татварын хугацаа самбарын «Анхаарах»-д орохгүй (тусдаа хуанлийн блок).
  assert.ok(!alerts.some((a) => a.title.startsWith("НӨАТ")));
});

test("самбар: анхаарах зүйлгүй бол хоосон; хаагдсан период default өнгөөр", () => {
  assert.deepEqual(dashboardAlerts(input("2026-10-15")), []);
  const [closed] = dashboardAlerts(input("2026-10-15", { periodStatus: "closed" }));
  assert.equal(closed.tone, "default");
  assert.equal(closed.href, "/settings/periods");
});

test("хугацаа хэтэрсэн АР/АП: долоо хоног тутмын dedupe, талын эрхээр", () => {
  const drafts = dailyNotificationDrafts(input("2026-10-07", { arOverdue: 2, apOverdue: 1 }));
  const ar = drafts.find((d) => d.dedupeKey.startsWith("overdue:ar"));
  const ap = drafts.find((d) => d.dedupeKey.startsWith("overdue:ap"));
  assert.equal(ar?.dedupeKey, "overdue:ar:2026-W41");
  assert.equal(ap?.dedupeKey, "overdue:ap:2026-W41");
  assert.deepEqual(ar?.audience, { kind: "module", moduleKeys: ["ar"], minLevel: "read" });
  assert.equal(ar?.type, "arap.overdue");
  // Дараагийн долоо хоног — өөр түлхүүр (дахин сануулна).
  const next = dailyNotificationDrafts(input("2026-10-14", { arOverdue: 2 }));
  assert.equal(next[0].dedupeKey, "overdue:ar:2026-W42");
});

test("хуучирсан ноорог: 7 хоногоос дээш л, батлах эрхтэйд, долоо хоног тутам", () => {
  const fresh = dailyNotificationDrafts(
    input("2026-10-07", { drafts: [{ module: "journal", count: 2, oldestDate: "2026-10-03" }] })
  );
  assert.ok(!fresh.some((d) => d.type === "drafts.stale"));

  const stale = dailyNotificationDrafts(
    input("2026-10-07", {
      drafts: [
        { module: "journal", count: 3, oldestDate: "2026-09-28" },
        { module: "cash", count: 1, oldestDate: null },
      ],
    })
  ).filter((d) => d.type === "drafts.stale");
  assert.equal(stale.length, 1);
  assert.equal(stale[0].dedupeKey, "stale:journal:2026-W41");
  assert.equal(stale[0].title, "3 ноорог журнал 7+ хоног хүлээгдэж байна");
  assert.deepEqual(stale[0].audience, { kind: "module", moduleKeys: ["gl"], minLevel: "post" });
});

test("татварын хугацаа: 7/3/1/0 шатанд л, шат бүрд нэг dedupe, бэлтгэсэн бол info", () => {
  // 2026-10-07: НӨАТ 10-10 → 3 хоног; ХАОАТ 3 хоног; НДШ 11-05 → 29 хоног (шатнаас гадна).
  const drafts = dailyNotificationDrafts(input("2026-10-07")).filter(
    (d) => d.type === "tax.deadline"
  );
  assert.deepEqual(
    drafts.map((d) => d.dedupeKey).sort(),
    ["tax:pit:2026-09:3", "tax:vat:2026-09:3"]
  );
  const vat = drafts.find((d) => d.dedupeKey.startsWith("tax:vat"))!;
  assert.equal(vat.severity, "warning");
  assert.equal(vat.title, "НӨАТ (2026-09) — 3 хоног үлдлээ");
  assert.equal(vat.href, "/tax/vat?period=2026-09");
  assert.deepEqual(vat.audience, { kind: "module", moduleKeys: ["tax"], minLevel: "write" });

  // 2 хоног үлдсэн → 3-ын шат хэвээр (өдөр алгасагдсан ч шатыг барина).
  const two = dailyNotificationDrafts(input("2026-10-08")).filter((d) => d.type === "tax.deadline");
  assert.ok(two.every((d) => d.dedupeKey.endsWith(":3")));

  // Хугацааны өдөр → шат 0, danger; бэлтгэсэн бол info.
  const due = dailyNotificationDrafts(input("2026-10-10")).find((d) => d.dedupeKey.startsWith("tax:vat"))!;
  assert.equal(due.dedupeKey, "tax:vat:2026-09:0");
  assert.equal(due.severity, "danger");
  assert.ok(due.title.includes("ӨНӨӨДӨР"));
  const prepared = dailyNotificationDrafts(
    input("2026-10-10", { preparedMarkers: ["vat-settlement:2026-09"] })
  ).find((d) => d.dedupeKey.startsWith("tax:vat"))!;
  assert.equal(prepared.severity, "info");
});

test("хугацаа хэтэрсэн татвар: marker байхгүй бол л, цонх 20 хоног", () => {
  assert.deepEqual(
    overdueTaxDeadlines("2026-10-12").map((o) => [o.key, o.period, o.daysOver]),
    [
      ["si", "2026-09", 7],
      ["vat", "2026-09", 2],
      ["pit", "2026-09", 2],
    ]
  );
  assert.deepEqual(overdueTaxDeadlines("2026-10-03"), []);
  assert.deepEqual(overdueTaxDeadlines("2026-11-01").map((o) => o.key), []);

  const drafts = dailyNotificationDrafts(
    input("2026-10-12", { preparedMarkers: ["payroll:2026-09"] })
  ).filter((d) => d.type === "tax.overdue");
  // ХАОАТ, НДШ payroll marker-тэй → зөвхөн НӨАТ.
  assert.deepEqual(drafts.map((d) => d.dedupeKey), ["tax-overdue:vat:2026-09"]);
  assert.equal(drafts[0].severity, "danger");
});

test("сар хаалт: сарын 1–5, өмнөх сар хаагдаагүй + бичилттэй бол нэг удаа", () => {
  const due = dailyNotificationDrafts(
    input("2026-10-03", {
      previousPeriod: { code: "2026-09", status: "missing", hasActivity: true },
    })
  ).find((d) => d.type === "close.due");
  assert.equal(due?.dedupeKey, "close-due:2026-09");
  assert.equal(due?.entityId, "2026-09");
  assert.equal(due?.href, "/close?period=2026-09");

  for (const previousPeriod of [
    { code: "2026-09", status: "closed" as const, hasActivity: true },
    { code: "2026-09", status: "open" as const, hasActivity: false },
  ])
    assert.ok(
      !dailyNotificationDrafts(input("2026-10-03", { previousPeriod })).some(
        (d) => d.type === "close.due"
      )
    );
  assert.ok(
    !dailyNotificationDrafts(
      input("2026-10-06", {
        previousPeriod: { code: "2026-09", status: "open", hasActivity: true },
      })
    ).some((d) => d.type === "close.due")
  );
});

test("лиценз: 30/7/1/0 шат, эзэн/админд; дууссан бол дохиогүй", () => {
  const thirty = dailyNotificationDrafts(
    input("2026-10-01", { licenseExpiresAt: "2026-10-25" })
  ).find((d) => d.type === "license.expiring")!;
  assert.equal(thirty.dedupeKey, "license:2026-10-25:30");
  assert.equal(thirty.severity, "warning");
  assert.deepEqual(thirty.audience, { kind: "roles", roles: ["owner", "admin"] });
  const seven = dailyNotificationDrafts(
    input("2026-10-20", { licenseExpiresAt: "2026-10-25" })
  ).find((d) => d.type === "license.expiring")!;
  assert.equal(seven.dedupeKey, "license:2026-10-25:7");
  assert.equal(seven.severity, "danger");
  assert.ok(
    !dailyNotificationDrafts(input("2026-10-26", { licenseExpiresAt: "2026-10-25" })).some(
      (d) => d.type === "license.expiring"
    )
  );
  assert.ok(
    !dailyNotificationDrafts(input("2026-08-01", { licenseExpiresAt: "2026-10-25" })).some(
      (d) => d.type === "license.expiring"
    )
  );
});

test("API token: 7 хоногийн дотор, зөвхөн эзэнд нь", () => {
  const drafts = dailyNotificationDrafts(
    input("2026-10-01", {
      tokens: [
        { id: "t1", name: "Cowork", userId: "u1", expiresAt: "2026-10-05" },
        { id: "t2", name: "Хожуу", userId: "u2", expiresAt: "2026-11-01" },
        { id: "t3", name: "Дууссан", userId: "u3", expiresAt: "2026-09-30" },
      ],
    })
  ).filter((d) => d.type === "token.expiring");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].dedupeKey, "token:t1");
  assert.deepEqual(drafts[0].audience, { kind: "users", userIds: ["u1"] });
  assert.ok(drafts[0].title.includes("Cowork"));
});

test("дохио бүр surfaces-тэй: daily дохио самбарт орохгүй, самбарын notify-гүй дохио daily-д орохгүй", () => {
  const signals = attentionSignals(
    input("2026-10-07", {
      drafts: [{ module: "journal", count: 1, unbalanced: 1, oldestDate: "2026-09-01" }],
    })
  );
  for (const signal of signals) {
    if (!signal.surfaces.includes("daily")) assert.equal(signal.notify, undefined);
    if (signal.notify) assert.ok(signal.surfaces.includes("daily"));
  }
});

test("туслахууд: isoWeekKey оны зааг, alertBucket", () => {
  assert.equal(isoWeekKey("2026-01-01"), "2026-W01");
  assert.equal(isoWeekKey("2027-01-01"), "2026-W53");
  assert.equal(isoWeekKey("2026-10-07"), "2026-W41");
  assert.equal(alertBucket(5, [7, 3, 1, 0]), 7);
  assert.equal(alertBucket(3, [7, 3, 1, 0]), 3);
  assert.equal(alertBucket(0, [7, 3, 1, 0]), 0);
  assert.equal(alertBucket(8, [7, 3, 1, 0]), null);
  assert.equal(alertBucket(-1, [7, 3, 1, 0]), null);
});

test("eBarimt: PosAPI хүрэхгүй / сугалаа бага / илгээлт хоцорсон — өдөрт нэг dedupe, POS бичих эрхтэйд", () => {
  const down = attentionSignals(
    input("2026-09-20", { ebarimt: { posApiReachable: false, leftLotteries: null, hoursSinceLastSent: null, sentRecently: true } })
  ).filter((s) => s.key.startsWith("ebarimt"));
  assert.deepEqual(down.map((s) => s.notify?.type), ["pos.ebarimt_posapi_down"]);
  assert.equal(down[0].notify?.dedupeKey, "ebarimt:posapi:2026-09-20");
  assert.deepEqual(down[0].notify?.audience, { kind: "module", moduleKeys: ["pos"], minLevel: "write" });

  const low = attentionSignals(
    input("2026-09-20", { ebarimt: { posApiReachable: true, leftLotteries: 150, hoursSinceLastSent: 2, sentRecently: true } })
  ).filter((s) => s.key.startsWith("ebarimt"));
  assert.deepEqual(low.map((s) => [s.notify?.type, s.tone]), [["pos.ebarimt_lottery_low", "warning"]]);
  const exhausted = attentionSignals(
    input("2026-09-20", { ebarimt: { posApiReachable: true, leftLotteries: 0, hoursSinceLastSent: 2, sentRecently: true } })
  ).find((s) => s.key === "ebarimt-lottery-low");
  assert.equal(exhausted?.tone, "danger");

  // Хоцролт: 48ц → warning, 72ц+ → danger; сүүлийн 3 хоногт баримт байхгүй бол дохиогүй.
  const stale = attentionSignals(
    input("2026-09-20", { ebarimt: { posApiReachable: true, leftLotteries: 1000, hoursSinceLastSent: 50, sentRecently: true } })
  ).find((s) => s.key === "ebarimt-send-stale");
  assert.equal(stale?.tone, "warning");
  assert.equal(stale?.notify?.dedupeKey, "ebarimt:stale:2026-09-20");
  const over = attentionSignals(
    input("2026-09-20", { ebarimt: { posApiReachable: true, leftLotteries: 1000, hoursSinceLastSent: 80, sentRecently: true } })
  ).find((s) => s.key === "ebarimt-send-stale");
  assert.equal(over?.tone, "danger");
  const idle = attentionSignals(
    input("2026-09-20", { ebarimt: { posApiReachable: true, leftLotteries: 1000, hoursSinceLastSent: 500, sentRecently: false } })
  ).filter((s) => s.key.startsWith("ebarimt"));
  assert.deepEqual(idle, []);

  // eBarimt өгөгдөлгүй (унтраалттай / browser горим) → дохиогүй.
  assert.deepEqual(attentionSignals(input("2026-09-20")).filter((s) => s.key.startsWith("ebarimt")), []);
});
