// Нууц үг сэргээх / и-мэйл баталгаажуулах token-ийн цэвэр дүрэм
// (lib/account/tokens.ts): hash, хэлбэр, хугацаа, нэг удаагийн байдал.
import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_TOKEN_TTL_MS,
  expiryFor,
  generateRawToken,
  hashToken,
  isTokenUsable,
  isWellFormedToken,
} from "../lib/account/tokens";

test("raw token 64 hex, hash нь raw-аас өөр, тогтвортой", () => {
  const raw = generateRawToken();
  assert.ok(isWellFormedToken(raw));
  assert.notEqual(generateRawToken(), raw);
  assert.equal(hashToken(raw), hashToken(raw));
  assert.notEqual(hashToken(raw), raw);
  assert.equal(hashToken(raw).length, 64);
});

test("гажиг хэлбэр DB руу очихгүй", () => {
  assert.equal(isWellFormedToken(""), false);
  assert.equal(isWellFormedToken("abc"), false);
  assert.equal(isWellFormedToken(null), false);
  assert.equal(isWellFormedToken("g".repeat(64)), false);
  assert.equal(isWellFormedToken("A".repeat(64)), false);
});

test("хугацаа дууссан / ашигласан / өөр төрлийн token хүчингүй", () => {
  const now = new Date("2026-09-20T10:00:00Z");
  const fresh = { kind: "password_reset", expiresAt: expiryFor("password_reset", now), usedAt: null };
  assert.equal(isTokenUsable(fresh, "password_reset", now), true);
  assert.equal(isTokenUsable(fresh, "email_verify", now), false, "төрөл зөрвөл");
  assert.equal(isTokenUsable({ ...fresh, usedAt: now }, "password_reset", now), false, "ашигласан");
  const later = new Date(now.getTime() + AUTH_TOKEN_TTL_MS.password_reset + 1);
  assert.equal(isTokenUsable(fresh, "password_reset", later), false, "хугацаа дууссан");
  assert.equal(isTokenUsable(null, "password_reset", now), false);
});

test("хугацаа: сэргээх 1 цаг, баталгаажуулах 24 цаг", () => {
  const now = new Date("2026-09-20T10:00:00Z");
  assert.equal(expiryFor("password_reset", now).toISOString(), "2026-09-20T11:00:00.000Z");
  assert.equal(expiryFor("email_verify", now).toISOString(), "2026-09-21T10:00:00.000Z");
});
