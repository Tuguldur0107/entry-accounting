// verifyEntryLicense — цэвэр баталгаажуулалтын тестүүд. Тест дотроо шинэ
// түлхүүрийн хос үүсгэдэг тул production public key-ээс хамаарахгүй; харин
// "буруу түлхүүрээр зурсан token унана" гэдгийг яг тэр замаар шалгана.

import assert from "node:assert/strict";
import test from "node:test";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";

import { verifyEntryLicense, type EntryLicensePayload } from "@/lib/licensing/license";

function issue(payload: Partial<EntryLicensePayload>, privatePem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const full = {
    slug: "test",
    appUrl: "https://test.entry.mn",
    iat: now,
    exp: now + 86400,
    ...payload,
  };
  const raw = Buffer.from(JSON.stringify(full), "utf8");
  const signature = sign(null, raw, createPrivateKey(privatePem));
  return `entl_${raw.toString("base64url")}.${signature.toString("base64url")}`;
}

const strangerKey = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

// Ok-замын тестэд: өөрсдийн хостой (private + public) баталгаажуулна.
const pair = generateKeyPairSync("ed25519");
const testPrivate = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const testPublic = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

test("зөв түлхүүр + зөв URL + хугацаандаа → ok", () => {
  const token = issue({ slug: "goyol", appUrl: "https://goyol.entry.mn" }, testPrivate);
  const result = verifyEntryLicense(token, "https://goyol.entry.mn/", new Date(), testPublic);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.payload.slug, "goyol");
});

test("хугацаа дууссан бол expired", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = issue({ exp: now - 10 }, testPrivate);
  assert.deepEqual(
    verifyEntryLicense(token, "https://test.entry.mn", new Date(), testPublic),
    { ok: false, reason: "expired" }
  );
});

test("өөр домэйнд хуулсан token → url-mismatch", () => {
  const token = issue({ appUrl: "https://goyol.entry.mn" }, testPrivate);
  assert.deepEqual(
    verifyEntryLicense(token, "https://clone.example.com", new Date(), testPublic),
    { ok: false, reason: "url-mismatch" }
  );
});

test("token байхгүй бол missing", () => {
  assert.deepEqual(verifyEntryLicense(undefined, "https://test.entry.mn"), {
    ok: false,
    reason: "missing",
  });
  assert.deepEqual(verifyEntryLicense("   ", "https://test.entry.mn"), {
    ok: false,
    reason: "missing",
  });
});

test("формат буруу бол malformed", () => {
  assert.equal(verifyEntryLicense("abc", "https://x.mn").ok, false);
  assert.deepEqual(verifyEntryLicense("entl_zөвхөн-нэг-хэсэг", "https://x.mn"), {
    ok: false,
    reason: "malformed",
  });
});

test("өөр (Console-ийн биш) түлхүүрээр зурсан token унана", () => {
  const token = issue({}, strangerKey);
  assert.deepEqual(verifyEntryLicense(token, "https://test.entry.mn"), {
    ok: false,
    reason: "bad-signature",
  });
});

test("payload-ыг өөрчилбөл гарын үсэг унана (tamper)", () => {
  const token = issue({}, strangerKey);
  const [head, sig] = token.slice(5).split(".");
  const edited = Buffer.from(head, "base64url").toString("utf8").replace("test", "hack");
  const tampered = `entl_${Buffer.from(edited).toString("base64url")}.${sig}`;
  assert.equal(verifyEntryLicense(tampered, "https://test.entry.mn").ok, false);
});
