// Голомт OBI — CGWTXNADD (гүйлгээ) ЗӨВХӨН UAT-д НЭГ удаагийн гар туршилт
// (docs/bank/00-payments-proposal.md §7 P0). Entry-ээс ТУСДАА: DB, env, Entry-ийн
// тохиргоо уншихгүй, юу ч хадгалахгүй; апп / lib энэ файлыг import ХИЙХГҮЙ
// (tests/golomt-transfer-isolation.test.ts).
//
//   npx tsx scripts/golomt-uat-transfer.ts
//   npx tsx scripts/golomt-uat-transfer.ts --check-code   (илгээхгүй, кодыг authenticator-тай харьцуулна)
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
// - Хүсэлтийн бүтэц SPEC 8.3-аар: initiator {} (илгээгч) + receives [{}] (хүлээн
//   авагчид), тал бүрд acctName, acctNo, particulars, amount { value, currency },
//   bank (Голомт = "15", Лавлах төрөл BANK)

import { createHmac } from "node:crypto";
import { createInterface } from "node:readline";
import { golomtChecksum, golomtDecrypt, golomtEncrypt, type GolomtKeys } from "../lib/bank/golomt/crypto";

const UAT_BASE = "https://openapi-uat.golomtbank.com/api";
const TRANSFER_PATH = "/v1/transaction/cgw/transfer";
/** UAT-д ч жижиг дүн (₮). */
const MAX_AMOUNT = 10_000;
/** SPEC 8.3: «Голомт банк (15)», Лавлах төрөл BANK. */
const GOLOMT_BANK_CODE = "15";

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

/**
 * `--check-code`: юу ч илгээхгүй, зөвхөн түлхүүрээс бодсон кодыг ТАНЫ дэлгэцэнд
 * харуулна — Google Authenticator-т ижил түлхүүрээ нэмж кодууд таарч байгааг
 * харьцуулна (таарвал түлхүүр + алгоритм зөв, асуудал өөр газар).
 */
async function checkCode() {
  const secret = base32Decode(await ask("X-Golomt-Key: ", true));
  if (!secret || secret.length === 0) throw new Error("X-Golomt-Key base32 хэлбэр биш (A–Z, 2–7)");
  for (let i = 0; i < 3; i++) {
    const left = 30 - (Math.floor(Date.now() / 1000) % 30);
    console.log(`Код: ${totp(secret)}  (${left} сек хүчинтэй; UTC ${new Date().toISOString()})`);
    await new Promise((resolve) => setTimeout(resolve, left * 1000 + 300));
  }
  console.log("Кодыг чатад БҮҮ бичээрэй — зөвхөн апп-тай харьцуулна.");
}

async function main() {
  if (process.argv.includes("--check-code")) return checkCode();
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
  const fromAccountName = await ask("Илгээгчийн дансны нэр (банкинд бүртгэлтэйгээр): ");
  const toAccount = await ask("Хүлээн авах данс: ");
  const toAccountName = await ask("Хүлээн авагчийн нэр: ");
  const toBank = (await ask(`Хүлээн авагчийн банкны код (Голомт = ${GOLOMT_BANK_CODE}): `)) || GOLOMT_BANK_CODE;
  const amount = Number((await ask(`Дүн (₮, ≤ ${MAX_AMOUNT}): `)).replace(/[\s,]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT)
    throw new Error(`Дүн 0-ээс их, ${MAX_AMOUNT}₮-өөс ихгүй байна`);
  const typeInput = ((await ask("Төрөл TSF / PMT / PRC (TSF): ")) || "TSF").toUpperCase();
  if (!["TSF", "PMT", "PRC"].includes(typeInput)) throw new Error("Төрөл TSF, PMT, PRC-ийн нэг");
  const remarks = (await ask("Гүйлгээний утга (Entry UAT туршилт): ")) || "Entry UAT туршилт";

  // refCode — давтагдашгүй (D6). Хариу тодорхойгүй бол ЭНЭ кодоор хуулгаас хайна.
  // Банк ЗӨВХӨН ^[a-zA-Z0-9_]*$ зөвшөөрнө (2026-10-02 UAT: зураас «-» → 400).
  const refCode = `EUAT${Date.now()}`;
  // SPEC 8.3: тал бүр (initiator / receives[]) өөрийн данс, утга, дүнтэй.
  const money = { value: amount, currency: "MNT" };
  const payload: Json = {
    registerNumber,
    remarks,
    type: typeInput,
    refCode,
    initiator: { acctName: fromAccountName, acctNo: fromAccount, particulars: remarks, amount: money, bank: GOLOMT_BANK_CODE },
    receives: [{ acctName: toAccountName, acctNo: toAccount, particulars: remarks, amount: money, bank: toBank }],
  };
  const body = JSON.stringify(payload);

  console.log("\nИлгээх хүсэлт (нууцгүй):");
  console.log(JSON.stringify(payload, null, 2));
  console.log("\nНэвтэрч байна…");
  const token = await login(username, password, keys);
  console.log("✓ Нэвтэрлээ\n");

  const mode = (await ask("X-Golomt-Code: [1] authenticator-ын код (санал болгох)  [2] түлхүүрээс бодох (1): ")) || "1";
  let secret: Buffer | null = null;
  if (mode === "2") {
    const rawKey = await ask("X-Golomt-Key: ", true);
    // Хавсралт 3: decodeBase32(X-Golomt-Key) — A–Z, 2–7 л (0, 1, 8, 9 үгүй).
    secret = base32Decode(rawKey);
    if (!secret || secret.length === 0)
      throw new Error("X-Golomt-Key base32 хэлбэр биш (A–Z, 2–7) — банкнаас ирсэн утгыг шалгана уу");
  }

  const confirm = await ask(`\n${amount.toLocaleString("en-US")}₮ → ${toAccount} илгээх үү? «ИЛГЭЭ» гэж бичнэ үү: `);
  if (confirm !== "ИЛГЭЭ") {
    console.log("Цуцаллаа — юу ч илгээгдээгүй.");
    return;
  }

  // Код 30 секундийн цонхонд л хүчинтэй — баталгаажуулалтын ДАРАА, илгээхийн яг
  // өмнө авна (2026-10-02 UAT: «ИЛГЭЭ» бичих зуур цонх солигдож 406 өгсөн байж болзошгүй).
  let code: string;
  if (secret) {
    const left = 30 - (Math.floor(Date.now() / 1000) % 30);
    if (left < 6) {
      console.log(`Цонх дуусахад ${left} сек — дараагийн цонхыг хүлээж байна…`);
      await new Promise((resolve) => setTimeout(resolve, left * 1000 + 300));
    }
    code = totp(secret);
  } else {
    code = await ask("Authenticator-ын ОДООГИЙН 6 оронтой код (шууд илгээгдэнэ): ", true);
    if (!/^\d{6,8}$/.test(code)) throw new Error("Код 6–8 оронтой тоо байна");
  }
  const sentAt = new Date();
  console.log(
    `Илгээж байна… (компьютерийн цаг UTC ${sentAt.toISOString()}, цонхонд ${30 - (Math.floor(sentAt.getTime() / 1000) % 30)} сек үлдсэн)`
  );

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
  if (!response.ok) {
    console.log(
      "\nАмжилтгүй. «Access code not matched» бол X-Golomt-Key ба компьютерийн цагийг (±30 сек) шалгана; талбарын алдаа бол SPEC-ийн нэрээр засна."
    );
    return;
  }
  // SPEC 8.3 хариу: successCount / failedCount / part[].status — HTTP 200 ч хэсэгчлэн
  // амжилтгүй байж болно.
  let result: { successCount?: number; failedCount?: number } = {};
  try {
    result = JSON.parse(text);
  } catch {
    // шифрлэгдээгүй / JSON биш хариу — дээр хэвлэгдсэн
  }
  const verdict = result.failedCount ? "⚠ АМЖИЛТГҮЙ хэсэг бий (failedCount > 0)" : result.successCount ? "✓ Амжилттай" : "Хариуг дээрээс шалгана уу";
  console.log(`\n${verdict}. refCode: ${refCode} — UAT хуулгад гарсан эсэхийг шалгана уу.`);
}

main().catch((caught) => {
  console.error(caught instanceof Error ? caught.message : caught);
  process.exit(1);
});
