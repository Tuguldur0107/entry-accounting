// Нэвтэрсэн хэрэглэгчийн auth хуудасны үсрэлт — «AI нягтлан» линк
// (`/register?plan=skills`) самбар руу ЧИМЭЭГҮЙ үсрэхгүй (2026-09-25).
import assert from "node:assert/strict";
import { test } from "node:test";

import { isSkillsSignupUrl, redirectsSignedInUser } from "../lib/auth-redirect";

test("AI нягтлан линк нэвтэрсэн хэрэглэгчийг үсэргэхгүй", () => {
  assert.equal(redirectsSignedInUser("/register", "?plan=skills"), false);
  assert.equal(isSkillsSignupUrl("/register", "?plan=skills&utm_source=landing"), true);
});

test("энгийн /login, /register нэвтэрсэн хэрэглэгчийг самбар руу үсэргэнэ", () => {
  assert.equal(redirectsSignedInUser("/login", ""), true);
  assert.equal(redirectsSignedInUser("/register", ""), true);
  assert.equal(redirectsSignedInUser("/register", "?plan=standard"), true);
});

test("урилгатай линк skills биш — хуучин зан төлөв хэвээр", () => {
  assert.equal(isSkillsSignupUrl("/register", "?plan=skills&invite=abc"), false);
  assert.equal(redirectsSignedInUser("/register", "?plan=skills&invite=abc"), true);
});

test("auth бус хуудас хэзээ ч үсрэхгүй", () => {
  assert.equal(redirectsSignedInUser("/gl/journal", "?plan=skills"), false);
  assert.equal(isSkillsSignupUrl("/login", "?plan=skills"), false);
});
