// Голомт OBI — CGWTXNADD (гүйлгээ) ЗӨВХӨН UAT-д НЭГ удаагийн гар туршилт
// (docs/bank/00-payments-proposal.md §7 P0). Entry-ээс ТУСДАА: DB, env, Entry-ийн
// тохиргоо уншихгүй, юу ч хадгалахгүй; апп / lib энэ файлыг import ХИЙХГҮЙ
// (tests/golomt-transfer-isolation.test.ts).
//
//   npx tsx scripts/golomt-uat-transfer.ts
//
// - Хост ЗӨВХӨН UAT (openapi-uat) — бодит мөнгө хөдлөхгүй; дүн ≤ MAX_AMOUNT
// - Нууцыг (нууц үг, session/IV key, X-Golomt-Key) нуугдсан оролтоор асууна —
//   аргумент, env, файлаар өгөхгүй; гаралтад нууц, токен, код ОРОХГҮЙ
// - X-Golomt-Code: (1) authenticator апп-ын 6 оронтой код — D1-A (түлхүүр
//   Entry-д орохгүй) ажиллах эсэхийг батална; эсвэл (2) түлхүүрээс SPEC
//   Хавсралт 3-ын TimeBasedOneTimePasswordUtil-ээр: X-Golomt-Key = BASE32 нууц
//   (16 тэмдэгт), HMAC-SHA1, 30 сек, 6 орон (RFC 6238 — Google Authenticator-тай ижил)
// - Илгээхээс өмнө хүсэлтийн биеийг харуулж «ИЛГЭЭ» гэж бичихийг шаардана;
//   хариу тодорхойгүй бол ДАХИН ИЛГЭЭХГҮЙ (D6) — хуулгаар шалгана
// - Хүсэлтийн талбарын нэр (fromAccount, toAccount, amount …) SPEC-ээс
//   баталгаажаагүй — банк талбарын алдаа буцаавал SPEC-ийн нэрээр засна

import { createHmac } from "node:crypto";
import { createInterface } from "node:readline";
import { golomtChecksum, golomtDecrypt, golomtEncrypt, type GolomtKeys } from "../lib/bank/golomt/crypto";

const UAT_BASE = "https://openapi-uat.golomtbank.com/api";
const TRANSFER_PATH = "/v1/transaction/cgw/transfer";
/** UAT-д ч жижиг дүн (₮). */
const MAX_AMOUNT = 10_000;

type Json = Record<string, unknown>;

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const internal = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
    internal._writeToOutput = (text: string) => {
      if (text.startsWith(question)) internal.output.write(question);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    })
  );
}

// ── TOTP — SPEC Хавсралт 3 (TimeBasedOneTimePasswordUtil.generateNumber) ────

function base32Decode(input: string): Buffer | null {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(clean)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: Buffer, now = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / stepSeconds)));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(value).padStart(digits, "0");
}

// ── HTTP ──────────────────────────────────────────────────────────────────

function readBody(text: string, keys: GolomtKeys): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  try {
    return golomtDecrypt(trimmed, keys);
  } catch {
    return "(тайлагдаагүй хариу)";
  }
}

async function login(username: string, password: string, keys: GolomtKeys): Promise<string> {
  const response = await fetch(`${UAT_BASE}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Golomt-Service": "LGIN" },
    body: JSON.stringify({ name: username, password: golomtEncrypt(password, keys) }),
  });
  const body = readBody(await response.text(), keys);
  if (!response.ok) throw new Error(`Нэвтэрч чадсангүй (HTTP ${response.status}): ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body) as Json;
  const token = parsed.token ?? parsed.accessToken;
  if (typeof token !== "string" || !token) throw new Error("Нэвтрэх хариунд token алга");
  return token;
}

async function main() {
  console.log("Голомт UAT — НЭГ туршилтын шилжүүлэг (CGWTXNADD). Нууц дэлгэцэнд харагдахгүй.");
  console.log(`Хост: ${UAT_BASE} (ЗӨВХӨН туршилтын орчин), дүн ≤ ${MAX_AMOUNT.toLocaleString("en-US")}₮\n`);

  const username = await ask("UAT нэвтрэх нэр: ");
  const password = await ask("Нууц үг: ", true);
  const keys: GolomtKeys = {
    sessionKey: await ask("Session key: ", true),
    ivKey: await ask("IV key: ", true),
  };
  const registerNumber = await ask("Байгууллагын регистр: ");
  const fromAccount = await ask("Илгээх (өөрийн, банкинд зөвшөөрөгдсөн) данс: ");
  const toAccount = await ask("Хүлээн авах данс: ");
  const toAccountName = await ask("Хүлээн авагчийн нэр: ");
  const toBank = await ask("Хүлээн авагчийн банкны код (Голомт бол хоосон): ");
  const amount = Number((await ask(`Дүн (₮, ≤ ${MAX_AMOUNT}): `)).replace(/[\s,]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT)
    throw new Error(`Дүн 0-ээс их, ${MAX_AMOUNT}₮-өөс ихгүй байна`);
  const typeInput = ((await ask("Төрөл TSF / PMT / PRC (TSF): ")) || "TSF").toUpperCase();
  if (!["TSF", "PMT", "PRC"].includes(typeInput)) throw new Error("Төрөл TSF, PMT, PRC-ийн нэг");
  const remarks = (await ask("Гүйлгээний утга (Entry UAT туршилт): ")) || "Entry UAT туршилт";

  // refCode — давтагдашгүй (D6). Хариу тодорхойгүй бол ЭНЭ кодоор хуулгаас хайна.
  const refCode = `entry-uat-${Date.now()}`;
  const payload: Json = {
    registerNumber,
    fromAccount,
    toAccount,
    toAccountName,
    ...(toBank ? { toBank } : {}),
    amount,
    currency: "MNT",
    remarks,
    type: typeInput,
    refCode,
  };
  const body = JSON.stringify(payload);

  console.log("\nИлгээх хүсэлт (нууцгүй):");
  console.log(JSON.stringify(payload, null, 2));
  console.log("\nНэвтэрч байна…");
  const token = await login(username, password, keys);
  console.log("✓ Нэвтэрлээ\n");

  // Код эцэст нь — 30 секундэд багтаана.
  const mode = (await ask("X-Golomt-Code: [1] authenticator-ын код (санал болгох)  [2] түлхүүрээс бодох (1): ")) || "1";
  let code: string;
  if (mode === "2") {
    const rawKey = await ask("X-Golomt-Key: ", true);
    // Хавсралт 3: decodeBase32(X-Golomt-Key) — A–Z, 2–7 л (0, 1, 8, 9 үгүй).
    const secret = base32Decode(rawKey);
    if (!secret || secret.length === 0)
      throw new Error("X-Golomt-Key base32 хэлбэр биш (A–Z, 2–7) — банкнаас ирсэн утгыг шалгана уу");
    code = totp(secret);
  } else {
    code = await ask("Authenticator-ын одоогийн 6 оронтой код: ", true);
    if (!/^\d{6,8}$/.test(code)) throw new Error("Код 6–8 оронтой тоо байна");
  }

  const confirm = await ask(`\n${amount.toLocaleString("en-US")}₮ → ${toAccount} илгээх үү? «ИЛГЭЭ» гэж бичнэ үү: `);
  if (confirm !== "ИЛГЭЭ") {
    console.log("Цуцаллаа — юу ч илгээгдээгүй.");
    return;
  }

  const response = await fetch(`${UAT_BASE}${TRANSFER_PATH}?client_id=&state=&scope=`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "X-Golomt-Service": "CGWTXNADD",
      "X-Golomt-Checksum": golomtChecksum(body, keys),
      "X-Golomt-Code": code,
      Authorization: `Bearer ${token}`,
    },
    body,
  }).catch(() => null);

  if (!response) {
    console.log(`\n⚠ Хариу ирсэнгүй (сүлжээ). ДАХИН БҮҮ ИЛГЭЭ — UAT хуулгаас refCode ${refCode}-оор шалгана уу.`);
    return;
  }
  const text = readBody(await response.text(), keys);
  console.log(`\nHTTP ${response.status}`);
  console.log(text.slice(0, 2000));
  console.log(
    response.ok
      ? `\nrefCode: ${refCode} — UAT хуулгад гарсан эсэхийг шалгана уу.`
      : "\nАмжилтгүй. «Access code not matched» бол X-Golomt-Key ба компьютерийн цагийг (±30 сек) шалгана; талбарын алдаа бол SPEC-ийн нэрээр засна."
  );
}

main().catch((caught) => {
  console.error(caught instanceof Error ? caught.message : caught);
  process.exit(1);
});
