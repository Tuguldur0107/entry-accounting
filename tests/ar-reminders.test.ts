// Төлбөрийн автомат сануулгын ЦЭВЭР логик (lib/arap/reminders.ts): шатны
// сонголт (нэг л шат, нөхөлтийн цонх, урьдчилсан шат хэтэрсний дараа үгүй),
// тохиргооны шалгалт, и-мэйлийн гарчигт дүн байхгүй.

import assert from "node:assert/strict";
import test from "node:test";

import {
  REMINDER_CATCH_UP_DAYS,
  buildReminderEmail,
  daysBetween,
  dueReminderStage,
  normalizeReminderSettings,
  parseDayList,
  reminderStageLabel,
  reminderStages,
} from "../lib/arap/reminders";

const settings = { beforeDays: 3, afterDays: [1, 7, 14] };
const stage = (today: string, doneStages: string[] = [], dueDate = "2026-10-10") =>
  dueReminderStage({ settings, dueDate, today, doneStages })?.key ?? null;

test("шатууд эрэмбэтэй, хоногийн зөрүү", () => {
  assert.deepEqual(
    reminderStages(settings).map((s) => s.key),
    ["before:3", "after:1", "after:7", "after:14"]
  );
  assert.deepEqual(reminderStages({ beforeDays: null, afterDays: [7] }).map((s) => s.offset), [7]);
  assert.equal(daysBetween("2026-09-28", "2026-10-03"), 5);
  assert.equal(daysBetween("2026-10-03", "2026-09-28"), -5);
});

test("өнөөдрийн шат — зөвхөн хамгийн сүүлд болсон НЭГ", () => {
  assert.equal(stage("2026-10-06"), null, "4 хоногийн өмнө — шат болоогүй");
  assert.equal(stage("2026-10-07"), "before:3");
  assert.equal(stage("2026-10-09"), "before:3", "урьдчилсан шат нөхөгдөнө");
  assert.equal(stage("2026-10-10"), null, "хугацааны өдөр: урьдчилсан шат хэтэрсэн, after:1 болоогүй");
  assert.equal(stage("2026-10-11"), "after:1");
  assert.equal(stage("2026-10-11", ["after:1"]), null, "нэг шат нэг л удаа");
  assert.equal(stage("2026-10-17", ["after:1"]), "after:7");
  // Ticker зогсоод after:1-ийг алгассан — after:7 болсон бол after:1-ийг ДАВХАР явуулахгүй.
  assert.equal(stage("2026-10-17"), "after:7");
  // Хожуу шат аль хэдийн явсан бол өмнөх шатыг нөхөхгүй.
  assert.equal(stage("2026-10-12", ["after:7"]), null);
});

test("нөхөлтийн цонх — хуучин хэтэрсэн нэхэмжлэх рүү асаамагц цацахгүй", () => {
  assert.equal(stage(`2026-10-${24 + REMINDER_CATCH_UP_DAYS}`), "after:14");
  assert.equal(stage(`2026-10-${25 + REMINDER_CATCH_UP_DAYS}`), null);
  assert.equal(stage("2027-03-01"), null, "5 сар хэтэрсэн — шинэ шат байхгүй");
});

test("тохиргооны шалгалт", () => {
  assert.deepEqual(normalizeReminderSettings({ enabled: true, beforeDays: 3, afterDays: [14, 1, 7, 7] }), {
    value: { enabled: true, beforeDays: 3, afterDays: [1, 7, 14] },
  });
  assert.deepEqual(normalizeReminderSettings({ enabled: false, beforeDays: 0, afterDays: [] }), {
    value: { enabled: false, beforeDays: null, afterDays: [] },
  });
  assert.ok("error" in normalizeReminderSettings({ enabled: true, beforeDays: null, afterDays: [] }));
  assert.ok("error" in normalizeReminderSettings({ enabled: true, beforeDays: 45, afterDays: [1] }));
  assert.ok("error" in normalizeReminderSettings({ enabled: true, beforeDays: 3, afterDays: [0] }));
  assert.ok("error" in normalizeReminderSettings({ enabled: true, beforeDays: 3, afterDays: [1, 2, 3, 4, 5, 6] }));
  assert.ok("error" in normalizeReminderSettings({ enabled: true, beforeDays: 1.5, afterDays: [1] }));
  assert.deepEqual(parseDayList("1, 7 ,14"), [1, 7, 14]);
  assert.deepEqual(parseDayList(""), []);
  assert.equal(parseDayList("1, долоо"), null);
  assert.equal(reminderStageLabel("before:3"), "3 хоногийн өмнө");
  assert.equal(reminderStageLabel("after:7"), "7 хоног хэтэрсэн");
});

test("и-мэйл: гарчигт дүн БАЙХГҮЙ, биед үлдэгдэл + линк", () => {
  const input = {
    companyName: "Entry Demo ХХК",
    documentNo: "AR-26-000012",
    dueDate: "2026-10-10",
    balance: 1_250_000,
    currency: "MNT",
    viewUrl: "https://app.entry.mn/invoice/abc",
    qpay: true,
    bankAccounts: [{ bankName: "Голомт", accountNo: "123", accountName: "Entry" }],
  };
  const before = buildReminderEmail({ ...input, today: "2026-10-07" });
  assert.match(before.subject, /^Төлбөрийн сануулга: нэхэмжлэх № AR-26-000012/);
  assert.doesNotMatch(before.subject, /1,250,000|₮|MNT/);
  assert.match(before.text, /3 хоногийн дараа/);
  assert.match(before.text, /1,250,000\.00 MNT/);
  assert.match(before.text, /QPay-ээр төлөх: https:\/\/app\.entry\.mn\/invoice\/abc/);
  assert.match(before.text, /Голомт · 123 · Entry/);
  const late = buildReminderEmail({ ...input, today: "2026-10-17", qpay: false });
  assert.match(late.subject, /^Хугацаа хэтэрсэн төлбөр/);
  assert.match(late.text, /7 хоног хэтэрсэн/);
  assert.match(late.text, /онлайнаар үзэх/);
  assert.match(buildReminderEmail({ ...input, today: "2026-10-10" }).text, /өнөөдөр/);
});
