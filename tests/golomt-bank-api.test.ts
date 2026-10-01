// Голомт OBI (Фаз 1 — ЗӨВХӨН унших) — docs/dev/bank-api.md.
// Шифрлэлтийн вектор нь Python `cryptography`-гоор (бие даасан хэрэгжүүлэлт)
// ДАММИ түлхүүрээр бодогдсон — бодит түлхүүр тестэд ХЭЗЭЭ Ч орохгүй.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  GolomtApiError,
  GolomtClient,
  golomtGrantParams,
  isGolomtGrantResponse,
} from "../lib/bank/golomt/client";
import {
  GOLOMT_API_BASE,
  golomtAccountId,
  golomtStatementChunks,
  golomtStatementRangeError,
  isGolomtCashAccount,
} from "../lib/bank/golomt/constants";
import { golomtChecksum, golomtDecrypt, golomtEncrypt } from "../lib/bank/golomt/crypto";
import {
  golomtExternalRef,
  golomtStatementToParsed,
  type GolomtStatementEntry,
} from "../lib/bank/golomt/statement";

const KEYS = { sessionKey: "0123456789abcdef", ivKey: "fedcba9876543210" };

// ── Шифрлэлт (SPEC §3) ─────────────────────────────────────────────────────

test("encrypts the password with AES-CBC/PKCS7 → Base64 (reference vector)", () => {
  assert.equal(golomtEncrypt("TestPass#2026", KEYS), "+S4ZV1WggediwBbGdxW35w==");
});

test("checksum = AES(sha256 hex of the EXACT body text)", () => {
  const body = '{"accountId":"1105000001","registerNo":"6596177"}';
  assert.equal(
    createHash("sha256").update(body).digest("hex"),
    "97f8d8acc43815c3f5709d6916d2f394bc26c3d791f795d1235cb8fd6124b5af"
  );
  assert.equal(
    golomtChecksum(body, KEYS),
    "lS0VCIDMSyyTIhiX8aOrPynb5pqRcoC6Ragf7Ztk35SarRqFTeQCI+WLEpanHoWy0HqsXkVoRaDL20XpjcoXq8XuYcG6y0qxi9omc64Bee4="
  );
  // Зай нэмбэл (банкны Python жишээний json.dumps) hash өөр — дахин
  // stringify хийхийг хориглох шалтгаан.
  assert.notEqual(
    golomtChecksum('{"accountId": "1105000001", "registerNo": "6596177"}', KEYS),
    golomtChecksum(body, KEYS)
  );
});

test("decrypts bank responses, including MIME line breaks and URL-safe Base64", () => {
  const encoded = "U8SLGIOXP5mGRh/sEdw/ZRgXZf2dzRr9NydFfDBC0oHXrtjyOCUZCqTp2aTMJKKt";
  const expected = '{"accountId":"1105000001","currency":"MNT"}';
  assert.equal(golomtDecrypt(encoded, KEYS), expected);
  assert.equal(golomtDecrypt(`${encoded.slice(0, 20)}\r\n${encoded.slice(20)}`, KEYS), expected);
  assert.equal(golomtDecrypt(encoded.replace(/\//g, "_").replace(/\+/g, "-"), KEYS), expected);
});

test("rejects keys of the wrong length with a Mongolian message", () => {
  assert.throws(() => golomtEncrypt("x", { sessionKey: "short", ivKey: KEYS.ivKey }), /session key/);
  assert.throws(() => golomtEncrypt("x", { sessionKey: KEYS.sessionKey, ivKey: "short" }), /IV key/);
});

// ── Данс, огноо ─────────────────────────────────────────────────────────────

test("recognises Golomt cash accounts by bank code or name, and requires an account number", () => {
  const base = { accountType: "bank", bankCode: null, bankName: null, accountNumber: "1105 000 001" };
  assert.equal(isGolomtCashAccount({ ...base, bankCode: "150000" }), true);
  assert.equal(isGolomtCashAccount({ ...base, bankName: "Голомт банк" }), true);
  assert.equal(isGolomtCashAccount({ ...base, bankName: "Golomt Bank" }), true);
  assert.equal(isGolomtCashAccount({ ...base, bankName: "Хаан банк" }), false);
  assert.equal(isGolomtCashAccount({ ...base, bankCode: "150000", accountNumber: "" }), false);
  assert.equal(isGolomtCashAccount({ ...base, accountType: "cash", bankCode: "150000" }), false);
  assert.equal(golomtAccountId("1105-000-001"), "1105000001");
  assert.equal(golomtAccountId("MN12 3456"), null);
});

test("statement range: calendar dates, ordered, not in the future, ≤ 92 days", () => {
  const today = "2026-09-30";
  assert.equal(golomtStatementRangeError("2026-09-01", "2026-09-30", today), null);
  assert.match(golomtStatementRangeError("2026-02-30", "2026-03-01", today) ?? "", /YYYY-MM-DD/);
  assert.match(golomtStatementRangeError("2026-09-10", "2026-09-01", today) ?? "", /хойш/);
  assert.match(golomtStatementRangeError("2026-09-01", "2026-10-01", today) ?? "", /ирээдүй/);
  assert.equal(golomtStatementRangeError("2026-07-01", "2026-09-30", today), null); // 92 хоног
  assert.match(golomtStatementRangeError("2026-06-30", "2026-09-30", today) ?? "", /92/);
});

test("statement chunks split at calendar months (bank allows ≈1 month per OPERACCTSTA call)", () => {
  // 2026-10-01 UAT: 02-01…03-01 OK, 02-01…03-02 / 04-30…05-31 «Он сар буруу байна».
  assert.deepEqual(golomtStatementChunks("2026-09-05", "2026-09-30"), [
    { startDate: "2026-09-05", endDate: "2026-09-30" },
  ]);
  assert.deepEqual(golomtStatementChunks("2026-01-15", "2026-03-02"), [
    { startDate: "2026-01-15", endDate: "2026-01-31" },
    { startDate: "2026-02-01", endDate: "2026-02-28" },
    { startDate: "2026-03-01", endDate: "2026-03-02" },
  ]);
  assert.deepEqual(golomtStatementChunks("2025-12-31", "2026-01-01"), [
    { startDate: "2025-12-31", endDate: "2025-12-31" },
    { startDate: "2026-01-01", endDate: "2026-01-01" },
  ]);
  // Өндөр жилийн 2-р сар
  assert.equal(golomtStatementChunks("2028-02-10", "2028-03-05")[0].endDate, "2028-02-29");
});

// ── Хуулга → импортын хэлбэр ────────────────────────────────────────────────

const ENTRIES: GolomtStatementEntry[] = [
  {
    recNum: 2,
    tranId: "S200",
    drOrCr: "Debit",
    tranAmount: "15000.5",
    tranDesc: "Түрээс",
    tranPostedDate: "2026-09-03T10:00:00",
    tranCrnCode: "MNT",
    exchRate: 1,
  },
  {
    recNum: 1,
    tranId: "S100",
    drOrCr: "Credit",
    tranAmount: 300000,
    tranDesc: "Борлуулалт",
    tranPostedDate: "2026-09-02T15:01:21",
    tranCrnCode: "MNT",
    exchRate: 1,
  },
];

test("maps OPERACCTSTA rows to the shared import shape (sorted, income/expense, refs)", () => {
  const { statement, skipped } = golomtStatementToParsed({
    accountId: "1105000001",
    currency: "MNT",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    entries: ENTRIES,
  });
  assert.equal(skipped, 0);
  assert.equal(statement.bankName, "Голомт банк");
  assert.equal(statement.periodStart, "2026-09-01");
  assert.equal(statement.periodEnd, "2026-09-30");
  assert.deepEqual(
    statement.rows.map((row) => [row.rowNumber, row.transactionDate, row.income, row.expense, row.exchangeRate]),
    [
      [1, "2026-09-02", 300000, 0, 1],
      [2, "2026-09-03", 0, 15000.5, 1],
    ]
  );
  assert.equal(
    statement.rows[0].externalRef,
    "golomt:1105000001:S100:2026-09-02T15:01:21:C:300000.00"
  );
  // Банкны тал хоосон — клиент сонгосон дансаар бөглөнө (файлын импорттой ижил).
  assert.equal(statement.rows[0].debitAccountNumber, "");
  assert.equal(statement.rows[0].rawData.source, "golomt-api");
});

test("counterparty name/account come from accName/accNum (empty on fee rows)", () => {
  // 2026-10-01 UAT-ийн хэлбэр: гүйлгээ ба шимтгэл ижил tranId, ижил цагтай.
  const { statement } = golomtStatementToParsed({
    accountId: "1105000001",
    currency: "MNT",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    entries: [
      { recNum: 1, tranId: "GB1", tranDate: "2026-09-28", drOrCr: "Debit", tranAmount: 100, tranDesc: "Гүйлгээний шимтгэл", tranPostedDate: "2026-09-28T12:20:24", tranCrnCode: "MNT", exchRate: 1, balance: "900.00", accName: "", accNum: "" },
      { recNum: 2, tranId: "GB1", tranDate: "2026-09-28", drOrCr: "Debit", tranAmount: 50000, tranDesc: "Түрээс", tranPostedDate: "2026-09-28T12:20:24", tranCrnCode: "MNT", exchRate: 1, balance: "1000.00", accName: "ДЭЛГЭРЭХ ХХК", accNum: "5001234567" },
    ],
  });
  const rent = statement.rows.find((row) => row.description === "Түрээс");
  const fee = statement.rows.find((row) => row.description === "Гүйлгээний шимтгэл");
  assert.equal(rent?.counterparty, "ДЭЛГЭРЭХ ХХК");
  assert.equal(rent?.counterAccount, "5001234567");
  assert.equal(rent?.rawData.balance, "1000.00");
  assert.equal(fee?.counterparty, "");
  assert.notEqual(rent?.externalRef, fee?.externalRef);
});

test("identical rows are kept and numbered; already-imported refs are skipped; hash is stable", () => {
  const ref = golomtExternalRef("1105000001", ENTRIES[1]);
  const first = golomtStatementToParsed({
    accountId: "1105000001",
    currency: "MNT",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    entries: [...ENTRIES, ENTRIES[0]],
    alreadyImported: new Set([ref]),
  });
  assert.equal(first.skipped, 1);
  // Нэг гүйлгээний хоёр ижил мөр (ж: хоёр ижил шимтгэл) — алдагдахгүй, 2 дахь нь `:2`.
  assert.deepEqual(first.statement.rows.map((row) => row.externalRef), [
    "golomt:1105000001:S200:2026-09-03T10:00:00:D:15000.50",
    "golomt:1105000001:S200:2026-09-03T10:00:00:D:15000.50:2",
  ]);
  // Дахин татахад 2 дахь мөр ч мөн танигдаж алгасагдана.
  const second = golomtStatementToParsed({
    accountId: "1105000001",
    currency: "MNT",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    entries: [...ENTRIES, ENTRIES[0]],
    alreadyImported: new Set([ref, ...first.statement.rows.map((row) => row.externalRef ?? "")]),
  });
  assert.equal(second.skipped, 3);
  assert.equal(second.statement.rows.length, 0);

  const once = golomtStatementToParsed({
    accountId: "1105000001",
    currency: "MNT",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    entries: [ENTRIES[0]],
  });
  const onceAgain = golomtStatementToParsed({
    accountId: "1105000001",
    currency: "MNT",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    entries: [ENTRIES[0]],
  });
  assert.equal(once.statement.fileHash, onceAgain.statement.fileHash);
});

test("never invents an FX rate and rejects a currency mismatch", () => {
  const usd = golomtStatementToParsed({
    accountId: "1105000002",
    currency: "USD",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    entries: [
      { tranId: "U1", drOrCr: "Credit", tranAmount: 100, tranPostedDate: "2026-09-02T09:00:00", tranCrnCode: "USD", exchRate: 3450.25 },
      { tranId: "U2", drOrCr: "Credit", tranAmount: 50, tranPostedDate: "2026-09-02T09:05:00", tranCrnCode: "USD", exchRate: 1 },
    ],
  });
  assert.equal(usd.statement.rows[0].exchangeRate, 3450.25);
  assert.equal(usd.statement.rows[0].baseAmount, 345025);
  assert.equal(usd.statement.rows[1].exchangeRate, null);
  assert.equal(usd.statement.rows[1].baseAmount, null);

  assert.throws(
    () =>
      golomtStatementToParsed({
        accountId: "1105000001",
        currency: "MNT",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        entries: [{ ...ENTRIES[0], tranCrnCode: "USD" }],
      }),
    /валют USD/
  );
});

test("rejects malformed rows loudly instead of guessing", () => {
  const run = (entry: GolomtStatementEntry) =>
    golomtStatementToParsed({
      accountId: "1105000001",
      currency: "MNT",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      entries: [entry],
    });
  assert.throws(() => run({ ...ENTRIES[0], tranId: "" }), /tranId/);
  assert.throws(() => run({ ...ENTRIES[0], drOrCr: "X" }), /чиглэл/);
  assert.throws(() => run({ ...ENTRIES[0], tranAmount: 0 }), /дүн/);
  assert.throws(() => run({ ...ENTRIES[0], tranPostedDate: "03/09/2026" }), /огноо/);
});

// ── HTTP клиент (хуурамч банк) ──────────────────────────────────────────────

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeBank(handler: (request: Recorded) => { status?: number; body: string }) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Recorded = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    };
    calls.push(request);
    const { status = 200, body } = handler(request);
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const CREDENTIALS = {
  environment: "uat" as const,
  username: "entry",
  password: "TestPass#2026",
  ...KEYS,
  clientId: "",
  registerNo: "6596177",
};

const encrypted = (value: unknown) => golomtEncrypt(JSON.stringify(value), KEYS);

test("login sends the AES-encrypted password to the fixed UAT host, without checksum", async () => {
  const bank = fakeBank(() => ({ body: JSON.stringify({ token: "T1", refreshToken: "R1", expiresIn: 300 }) }));
  await new GolomtClient(CREDENTIALS, bank.fetchImpl).login();
  const [login] = bank.calls;
  assert.equal(login.url, `${GOLOMT_API_BASE.uat}/v1/auth/login`);
  assert.equal(login.headers["X-Golomt-Service"], "LGIN");
  assert.equal(login.headers["X-Golomt-Checksum"], undefined);
  assert.deepEqual(JSON.parse(login.body ?? ""), { name: "entry", password: "+S4ZV1WggediwBbGdxW35w==" });
});

test("business calls carry Bearer + checksum of the sent body and decrypt the reply", async () => {
  const bank = fakeBank((request) => {
    if (request.url.endsWith("/v1/auth/login")) return { body: JSON.stringify({ token: "T1", refreshToken: "R1" }) };
    return {
      body: encrypted({
        accountNumber: "1105000001",
        accountName: "ГАРААНЫ ХОС ХАС",
        customerName: "ГАРААНЫ ХОС ХАС ТЕХНОЛОГИ",
        currency: "mnt",
        status: "a",
      }),
    };
  });
  const details = await new GolomtClient(CREDENTIALS, bank.fetchImpl).accountDetails("1105000001");
  assert.deepEqual(details, { accountId: "1105000001", accountName: "ГАРААНЫ ХОС ХАС", currency: "MNT", status: "A" });
  const call = bank.calls[1];
  assert.match(call.url, /\/v1\/account\/operative\/details\?client_id=&state=&scope=$/);
  assert.equal(call.headers.Authorization, "Bearer T1");
  assert.equal(call.headers["X-Golomt-Service"], "OPERACCTDET");
  assert.equal(call.headers["X-Golomt-Checksum"], golomtChecksum(call.body ?? "", KEYS));
  assert.deepEqual(JSON.parse(call.body ?? ""), { accountId: "1105000001", registerNo: "6596177" });
});

test("available balance reads the AVAIL entry of balanceLL (ACCTBALINQ); missing → null", async () => {
  const reply = (balanceLL: unknown) =>
    fakeBank((request) =>
      request.url.endsWith("/v1/auth/login")
        ? { body: JSON.stringify({ token: "T1" }) }
        : { body: encrypted({ accountId: "1105000001", currency: "MNT", balanceLL }) }
    );
  const bank = reply([{ type: "AVAIL", amount: { value: 36717365.7, currency: "MNT" } }]);
  assert.equal(await new GolomtClient(CREDENTIALS, bank.fetchImpl).availableBalance("1105000001"), 36717365.7);
  assert.equal(bank.calls[1].headers["X-Golomt-Service"], "ACCTBALINQ");
  assert.match(bank.calls[1].url, /\/v1\/account\/balance\/inq\?/);
  assert.equal(await new GolomtClient(CREDENTIALS, reply([]).fetchImpl).availableBalance("1105000001"), null);
  assert.equal(
    await new GolomtClient(CREDENTIALS, reply([{ type: "AVAIL", amount: {} }]).fetchImpl).availableBalance("1105000001"),
    null
  );
});

test("an OAuth grant reply is retried once with its client_id/state/scope; a second grant fails loudly", async () => {
  let listCalls = 0;
  const bank = fakeBank((request) => {
    if (request.url.endsWith("/v1/auth/login")) return { body: JSON.stringify({ token: "T1" }) };
    listCalls++;
    if (request.url.includes("state=S1")) return { body: encrypted({ accountNumber: "1105000001" }) };
    return { body: encrypted({ clientId: "C1", responseType: "code", redirectUri: "https://x", state: "S1", scope: "SC" }) };
  });
  await new GolomtClient(CREDENTIALS, bank.fetchImpl).accountDetails("1105000001");
  assert.equal(listCalls, 2);
  assert.match(bank.calls[2].url, /client_id=C1&state=S1&scope=SC$/);

  const stubborn = fakeBank((request) =>
    request.url.endsWith("/v1/auth/login")
      ? { body: JSON.stringify({ token: "T1" }) }
      : { body: encrypted({ responseType: "code", redirectUri: "https://x", state: "S" }) }
  );
  await assert.rejects(new GolomtClient(CREDENTIALS, stubborn.fetchImpl).accountDetails("1105000001"), /зөвшөөрөл/);
  assert.equal(isGolomtGrantResponse({ statements: [] }), false);
});

test("statement is fetched month by month via OPERACCTSTA (no paging fields)", async () => {
  const bank = fakeBank((request) => {
    if (request.url.endsWith("/v1/auth/login")) return { body: JSON.stringify({ token: "T1" }) };
    const { startDate } = JSON.parse(request.body ?? "{}") as { startDate: string };
    return {
      body: encrypted({
        accountId: "1105000001",
        statements: [{ tranId: `S${startDate}`, drOrCr: "Credit", tranAmount: 1, tranPostedDate: `${startDate}T00:00:00` }],
      }),
    };
  });
  const entries = await new GolomtClient(CREDENTIALS, bank.fetchImpl).fetchStatement("1105000001", "2026-08-20", "2026-09-30");
  assert.deepEqual(entries.map((entry) => entry.tranId), ["S2026-08-20", "S2026-09-01"]);
  const bodies = bank.calls.slice(1).map((call) => JSON.parse(call.body ?? "{}"));
  assert.deepEqual(bodies, [
    { accountId: "1105000001", registerNo: "6596177", startDate: "2026-08-20", endDate: "2026-08-31" },
    { accountId: "1105000001", registerNo: "6596177", startDate: "2026-09-01", endDate: "2026-09-30" },
  ]);
  for (const call of bank.calls.slice(1)) {
    assert.equal(call.headers["X-Golomt-Service"], "OPERACCTSTA");
    assert.match(call.url, /\/v1\/account\/operative\/statement\/\?client_id=&state=&scope=$/);
  }
});

test("refreshes the 300-second token via GET /v1/auth/refresh with the refresh token", async () => {
  let now = 0;
  const bank = fakeBank((request) => {
    if (request.url.endsWith("/v1/auth/login")) return { body: JSON.stringify({ token: "T1", refreshToken: "R1" }) };
    if (request.url.endsWith("/v1/auth/refresh")) return { body: JSON.stringify({ token: "T2", refreshToken: "R2" }) };
    return { body: encrypted({ accountNumber: "1105000001" }) };
  });
  const client = new GolomtClient(CREDENTIALS, bank.fetchImpl, () => now);
  await client.accountDetails("1105000001");
  now = 250_000;
  await client.accountDetails("1105000001");
  const refresh = bank.calls.find((call) => call.url.endsWith("/v1/auth/refresh"));
  assert.equal(refresh?.method, "GET");
  assert.equal(refresh?.headers.Authorization, "Bearer R1");
  assert.equal(bank.calls.at(-1)?.headers.Authorization, "Bearer T2");
});

test("bank errors become clear Mongolian messages (generic ‘contact administrator’ is translated)", async () => {
  const bank = fakeBank(() => ({
    status: 500,
    body: JSON.stringify({ status: 500, message: "Please contact bank administrator. Call center 1800-1646." }),
  }));
  await assert.rejects(
    new GolomtClient(CREDENTIALS, bank.fetchImpl).login(),
    (error: unknown) =>
      error instanceof GolomtApiError && error.status === 500 && /нэвтрэх алхамд/.test(error.message) && /HTTP 500/.test(error.message)
  );
  const denied = fakeBank(() => ({ status: 401, body: "" }));
  await assert.rejects(new GolomtClient(CREDENTIALS, denied.fetchImpl).login(), /нууц үг/);
  const wrongKey = fakeBank((request) =>
    request.url.endsWith("/v1/auth/login")
      ? { body: JSON.stringify({ token: "T1" }) }
      : { body: golomtEncrypt("{}", { sessionKey: "ffffffffffffffff", ivKey: KEYS.ivKey }) }
  );
  await assert.rejects(new GolomtClient(CREDENTIALS, wrongKey.fetchImpl).accountDetails("1105000001"), /тайлж чадсангүй/);
});

test("first business call sends EMPTY client_id/state/scope even when a Client ID is configured (SPEC §5 step 2)", async () => {
  const bank = fakeBank((request) =>
    request.url.endsWith("/v1/auth/login")
      ? { body: JSON.stringify({ token: "T1" }) }
      : { body: encrypted({ accountNumber: "1105000001" }) }
  );
  await new GolomtClient({ ...CREDENTIALS, clientId: "17270423289641479650" }, bank.fetchImpl).accountDetails("1105000001");
  assert.match(bank.calls[1].url, /\?client_id=&state=&scope=$/);
});

test("bank error messages name the failing step and keep the bank's code", async () => {
  const bank = fakeBank((request) =>
    request.url.endsWith("/v1/auth/login")
      ? { body: JSON.stringify({ token: "T1" }) }
      : { status: 400, body: JSON.stringify({ status: 400, message: "statement.period.invalid" }) }
  );
  await assert.rejects(
    new GolomtClient(CREDENTIALS, bank.fetchImpl).fetchStatement("1105000001", "2026-09-01", "2026-09-30"),
    /Голомт банк \(хуулга татах, HTTP 400\): statement\.period\.invalid/
  );
  const failed = fakeBank((request) =>
    request.url.endsWith("/v1/auth/login")
      ? { body: JSON.stringify({ token: "T1" }) }
      : { body: encrypted({ status: "FAILED", errDesc: "account.not.permitted" }) }
  );
  await assert.rejects(
    new GolomtClient(CREDENTIALS, failed.fetchImpl).accountDetails("1105000001"),
    /дансны мэдээлэл\): account\.not\.permitted/
  );
});

test("a consent reply in `url` form is parsed and retried; a repeated one surfaces the consent link", async () => {
  const consent = {
    url: "https://openapi-uat.golomtbank.com/authorize?response_type=code&client_id=C9&redirect_uri=x&scope=SC9&state=S9",
  };
  assert.equal(isGolomtGrantResponse(consent), true);
  assert.deepEqual(golomtGrantParams(consent), { clientId: "C9", state: "S9", scope: "SC9" });

  const once = fakeBank((request) => {
    if (request.url.endsWith("/v1/auth/login")) return { body: JSON.stringify({ token: "T1" }) };
    return request.url.includes("state=S9") ? { body: encrypted({ accountNumber: "1105000001" }) } : { body: encrypted(consent) };
  });
  await new GolomtClient(CREDENTIALS, once.fetchImpl).accountDetails("1105000001");
  assert.match(once.calls[2].url, /client_id=C9&state=S9&scope=SC9$/);

  const always = fakeBank((request) =>
    request.url.endsWith("/v1/auth/login") ? { body: JSON.stringify({ token: "T1" }) } : { body: encrypted(consent) }
  );
  await assert.rejects(new GolomtClient(CREDENTIALS, always.fetchImpl).accountDetails("1105000001"), /зөвшөөрлийн холбоос: https:\/\/openapi-uat/);
});

test("known bank codes become plain Mongolian: unknown username (MERDET0001) and field validation", async () => {
  // 2026-10-01 UAT-ийн бодит хариуны хэлбэр (зохиомол нэрээр нэвтрэхэд).
  const unknownUser = fakeBank(() => ({
    status: 400,
    body: JSON.stringify({
      status: "BAD_REQUEST",
      message: "merchant.details.not.present",
      debugMessage: "merchant.details.not.present",
      subErrors: [{ type: "MERDET0001", desc: "merchant.details.not.present", code: "MERDET0001" }],
    }),
  }));
  await assert.rejects(
    new GolomtClient(CREDENTIALS, unknownUser.fetchImpl).login(),
    /Голомт банк \(нэвтрэх\): Нэвтрэх нэр банкинд бүртгэлгүй.*\[MERDET0001\]$/
  );

  const validation = fakeBank(() => ({
    status: 400,
    body: JSON.stringify({
      status: "BAD_REQUEST",
      message: "Bad Request",
      subErrors: [{ object: "Size", field: "password", rejectedValue: "abc", message: "Нэвтрэх нууц үг оруулна уу" }],
    }),
  }));
  await assert.rejects(
    new GolomtClient(CREDENTIALS, validation.fetchImpl).login(),
    /Голомт банк \(нэвтрэх, HTTP 400\): Нэвтрэх нууц үг оруулна уу/
  );
});

test("encrypted 4xx error bodies are decrypted so the bank's real reason is shown", async () => {
  // 2026-10-01 UAT: 400 хариу (нээгдээгүй сервис, буруу огноо) Base64 AES-ээр ирсэн.
  const bank = fakeBank((request) =>
    request.url.endsWith("/v1/auth/login")
      ? { body: JSON.stringify({ token: "T1" }) }
      : {
          status: 400,
          body: encrypted({ status: "BAD_REQUEST", message: "checksum.invalid", subErrors: [{ code: "CHK0001" }] }),
        }
  );
  await assert.rejects(
    new GolomtClient(CREDENTIALS, bank.fetchImpl).accountDetails("1105000001"),
    /Голомт банк \(дансны мэдээлэл, HTTP 400\): checksum\.invalid \[CHK0001\]/
  );
});

test("service-not-opened and wrong-register replies become plain Mongolian (2026-10-01 UAT)", async () => {
  const reply = (message: string) =>
    fakeBank((request) =>
      request.url.endsWith("/v1/auth/login")
        ? { body: JSON.stringify({ token: "T1" }) }
        : { status: 400, body: encrypted({ status: "BAD_REQUEST", message }) }
    );
  await assert.rejects(
    new GolomtClient(CREDENTIALS, reply("Мерчант сервис рүү хандах боломжгүй").fetchImpl).availableBalance("1105000001"),
    /дансны үлдэгдэл\): Энэ үйлчилгээ таны банкны эрхэд нээгдээгүй/
  );
  await assert.rejects(
    new GolomtClient(CREDENTIALS, reply("only.access.customer.own.account").fetchImpl).fetchStatement("1105000001", "2026-09-01", "2026-09-30"),
    /хуулга татах\): Энэ данс тохиргооны байгууллагын регистрт бүртгэлгүй/
  );
});

test("account-level bank codes: 162 (no such account), 342 (closed); other desc is shown as-is", async () => {
  // 2026-10-01 UAT-ийн бодит хариуны хэлбэр — message хоосон, тайлбар нь subErrors[].desc-д.
  const reply = (subError: Record<string, string>) =>
    fakeBank((request) =>
      request.url.endsWith("/v1/auth/login")
        ? { body: JSON.stringify({ token: "T1" }) }
        : { status: 400, body: encrypted({ status: "BAD_REQUEST", message: null, debugMessage: null, subErrors: [subError] }) }
    );
  await assert.rejects(
    new GolomtClient(CREDENTIALS, reply({ type: "162", desc: "The account does not exist.", code: "162" }).fetchImpl).accountDetails("0000000002"),
    /дансны мэдээлэл\): Ийм дугаартай данс Голомт банкинд алга.*\[162\]$/
  );
  await assert.rejects(
    new GolomtClient(CREDENTIALS, reply({ type: "342", desc: "The account has been closed.", code: "342" }).fetchImpl).availableBalance("1415140705"),
    /дансны үлдэгдэл\): Энэ данс банкинд хаагдсан байна \[342\]$/
  );
  await assert.rejects(
    new GolomtClient(CREDENTIALS, reply({ type: "999", desc: "Something else.", code: "999" }).fetchImpl).accountDetails("1105000001"),
    /дансны мэдээлэл, HTTP 400\): Something else\. \[999\]$/
  );
});
