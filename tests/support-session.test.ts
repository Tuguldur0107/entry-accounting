// Дэмжлэгийн хандалтын ЦЭВЭР дүрэм — хугацааны хоёр цонх (линк / сесс),
// эрхийн түвшний танилт, cookie-ийн хугацаа.
import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPPORT_LINK_TTL_MS,
  SUPPORT_SESSION_TTL_MS,
  isSupportRole,
  isSupportSessionUsable,
  normalizeSupportReason,
  parseSupportRole,
  supportAuditSummary,
  supportCookieMaxAge,
  supportLinkExpiry,
  supportMinutesLeft,
  supportSessionExpiry,
  supportSessionState,
} from "../lib/platform/support";

const NOW = new Date("2026-09-20T10:00:00.000Z");
const ms = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function row(over: Partial<{
  expiresAt: Date;
  startedAt: Date | null;
  endsAt: Date | null;
  endedAt: Date | null;
}> = {}) {
  return {
    expiresAt: ms(15),
    startedAt: null,
    endsAt: null,
    endedAt: null,
    ...over,
  };
}

test("эрхийн түвшин: өгөгдөөгүй бол ХАМГИЙН болгоомжтой нь (viewer)", () => {
  assert.equal(parseSupportRole(undefined), "viewer");
  assert.equal(parseSupportRole(null), "viewer");
  assert.equal(parseSupportRole(""), "viewer");
  assert.equal(parseSupportRole("admin"), "admin");
  assert.equal(parseSupportRole("viewer"), "viewer");
});

test("танигдахгүй түвшинг ЧИМЭЭГҮЙ буулгахгүй — ШИДНЭ", () => {
  assert.throws(() => parseSupportRole("owner"), /танигдсангүй/);
  assert.throws(() => parseSupportRole("root"), /танигдсангүй/);
  assert.equal(isSupportRole("owner"), false);
  assert.equal(isSupportRole("accountant"), false);
});

test("ашиглагдаагүй линк: хугацаанд нь pending, дараа нь expired", () => {
  assert.equal(supportSessionState(row(), NOW), "pending");
  assert.equal(supportSessionState(row(), ms(14)), "pending");
  // expiresAt-ийн ЯГ мөчид хүчингүй (> шалгалт) — хилийн тохиолдол.
  assert.equal(supportSessionState(row(), ms(15)), "expired");
  assert.equal(supportSessionState(row(), ms(16)), "expired");
});

test("идэвхжсэн сесс: endsAt хүртэл active, дараа нь expired", () => {
  const started = row({ startedAt: ms(5), endsAt: ms(65) });
  assert.equal(supportSessionState(started, ms(5)), "active");
  assert.equal(supportSessionState(started, ms(64)), "active");
  assert.equal(supportSessionState(started, ms(65)), "expired");
  assert.equal(isSupportSessionUsable(started, ms(64)), true);
  assert.equal(isSupportSessionUsable(started, ms(65)), false);
});

test("гараар гарсан сесс хугацаа дуусаагүй ч ended — дахин ашиглагдахгүй", () => {
  const ended = row({ startedAt: ms(5), endsAt: ms(65), endedAt: ms(10) });
  assert.equal(supportSessionState(ended, ms(20)), "ended");
  assert.equal(isSupportSessionUsable(ended, ms(20)), false);
});

test("линк дууссаны дараа идэвхжүүлэх боломжгүй (ЛИНКИЙН цонх тусдаа)", () => {
  // startedAt тавигдаагүй тул endsAt ч байхгүй — expired хэвээр.
  assert.equal(supportSessionState(row({ expiresAt: ms(-1) }), NOW), "expired");
});

test("хугацааны тооцоолол: линк 15 мин, сесс 1 цаг", () => {
  assert.equal(supportLinkExpiry(NOW).getTime() - NOW.getTime(), SUPPORT_LINK_TTL_MS);
  assert.equal(supportSessionExpiry(NOW).getTime() - NOW.getTime(), SUPPORT_SESSION_TTL_MS);
});

test("үлдсэн минут — дууссан/эхлээгүй сессэд 0", () => {
  const started = row({ startedAt: NOW, endsAt: ms(60) });
  assert.equal(supportMinutesLeft(started, NOW), 60);
  assert.equal(supportMinutesLeft(started, ms(59.5)), 1);
  assert.equal(supportMinutesLeft(started, ms(60)), 0);
  assert.equal(supportMinutesLeft(row(), NOW), 0);
});

test("cookie maxAge нь сессийн үлдсэн хугацаанаас хэтрэхгүй, 0 болохгүй", () => {
  assert.equal(supportCookieMaxAge(ms(60), NOW), 3600);
  assert.equal(supportCookieMaxAge(ms(1), NOW), 60);
  // Хугацаа дууссан ч cookie API 0/сөрөг утгад шууд устгадаг тул доод хязгаар 1.
  assert.equal(supportCookieMaxAge(ms(-5), NOW), 1);
});

test("аудитын тайлбар — хэн, ямар эрхээр, ямар шалтгаанаар", () => {
  const summary = supportAuditSummary({
    email: "tuguldur@example.com",
    role: "admin",
    reason: "Сар хаалтын алдаа шалгах",
    issuedBy: "Entry Console · tuguldur",
  });
  assert.match(summary, /Дэмжлэгийн хандалт/);
  assert.match(summary, /tuguldur@example\.com/);
  assert.match(summary, /Сар хаалтын алдаа шалгах/);
  assert.match(summary, /Entry Console/);
});

test("шалтгаан: хоосон → null, хэт урт → таслагдана", () => {
  assert.equal(normalizeSupportReason("   "), null);
  assert.equal(normalizeSupportReason(42), null);
  assert.equal(normalizeSupportReason(" шалгалт "), "шалгалт");
  assert.equal(normalizeSupportReason("я".repeat(400))?.length, 300);
});
