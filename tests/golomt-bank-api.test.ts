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

test("maps OPERACCSTAINQ rows to the shared import shape (sorted, income/expense, refs)", () => {
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

test("skips already-imported transactions and duplicates across pages; hash is stable", () => {
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
  assert.deepEqual(first.statement.rows.map((row) => row.description), ["Түрээс"]);

  const again = golomtStatementToParsed({
    accountId: "1105000001",
    currency: "MNT",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    entries: [ENTRIES[0]],
  });
  assert.equal(again.statement.fileHash, first.statement.fileHash);
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
        operAccounts: [
          { accountId: "1105000001", accountName: "ГАРААНЫ ХОС ХАС", currency: "mnt" },
          { accountName: "дугааргүй" },
        ],
      }),
    };
  });
  const accounts = await new GolomtClient(CREDENTIALS, bank.fetchImpl).listAccounts();
  assert.deepEqual(accounts, [{ accountId: "1105000001", accountName: "ГАРААНЫ ХОС ХАС", currency: "MNT" }]);
  const call = bank.calls[1];
  assert.match(call.url, /\/v1\/account\/list\?client_id=&state=&scope=$/);
  assert.equal(call.headers.Authorization, "Bearer T1");
  assert.equal(call.headers["X-Golomt-Service"], "ACCTLST");
  assert.equal(call.headers["X-Golomt-Checksum"], golomtChecksum(call.body ?? "", KEYS));
});

test("an OAuth grant reply is retried once with its client_id/state/scope; a second grant fails loudly", async () => {
  let listCalls = 0;
  const bank = fakeBank((request) => {
    if (request.url.endsWith("/v1/auth/login")) return { body: JSON.stringify({ token: "T1" }) };
    listCalls++;
    if (request.url.includes("state=S1")) return { body: encrypted({ operAccounts: [] }) };
    return { body: encrypted({ clientId: "C1", responseType: "code", redirectUri: "https://x", state: "S1", scope: "SC" }) };
  });
  await new GolomtClient(CREDENTIALS, bank.fetchImpl).listAccounts();
  assert.equal(listCalls, 2);
  assert.match(bank.calls[2].url, /client_id=C1&state=S1&scope=SC$/);

  const stubborn = fakeBank((request) =>
    request.url.endsWith("/v1/auth/login")
      ? { body: JSON.stringify({ token: "T1" }) }
      : { body: encrypted({ responseType: "code", redirectUri: "https://x", state: "S" }) }
  );
  await assert.rejects(new GolomtClient(CREDENTIALS, stubborn.fetchImpl).listAccounts(), /зөвшөөрөл/);
  assert.equal(isGolomtGrantResponse({ statements: [] }), false);
});

test("statement paging walks every page with page/size in the checksummed body", async () => {
  const bank = fakeBank((request) => {
    if (request.url.endsWith("/v1/auth/login")) return { body: JSON.stringify({ token: "T1" }) };
    const page = JSON.parse(request.body ?? "{}").page as number;
    return {
      body: encrypted({
        currentPage: page,
        totalPages: 2,
        statements: [{ tranId: `S${page}`, drOrCr: "Credit", tranAmount: 1, tranPostedDate: "2026-09-02T00:00:00" }],
      }),
    };
  });
  const entries = await new GolomtClient(CREDENTIALS, bank.fetchImpl).fetchStatement("1105000001", "2026-09-01", "2026-09-30");
  assert.deepEqual(entries.map((entry) => entry.tranId), ["S1", "S2"]);
  const body = JSON.parse(bank.calls[1].body ?? "{}");
  assert.deepEqual(body, {
    accountId: "1105000001",
    registerNo: "6596177",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    page: 1,
    size: 100,
  });
  assert.equal(bank.calls[1].headers["X-Golomt-Service"], "OPERACCSTAINQ");
});

test("refreshes the 300-second token via GET /v1/auth/refresh with the refresh token", async () => {
  let now = 0;
  const bank = fakeBank((request) => {
    if (request.url.endsWith("/v1/auth/login")) return { body: JSON.stringify({ token: "T1", refreshToken: "R1" }) };
    if (request.url.endsWith("/v1/auth/refresh")) return { body: JSON.stringify({ token: "T2", refreshToken: "R2" }) };
    return { body: encrypted({ operAccounts: [] }) };
  });
  const client = new GolomtClient(CREDENTIALS, bank.fetchImpl, () => now);
  await client.listAccounts();
  now = 250_000;
  await client.listAccounts();
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
  await assert.rejects(new GolomtClient(CREDENTIALS, wrongKey.fetchImpl).listAccounts(), /тайлж чадсангүй/);
});

test("first business call sends EMPTY client_id/state/scope even when a Client ID is configured (SPEC §5 step 2)", async () => {
  const bank = fakeBank((request) =>
    request.url.endsWith("/v1/auth/login")
      ? { body: JSON.stringify({ token: "T1" }) }
      : { body: encrypted({ operAccounts: [] }) }
  );
  await new GolomtClient({ ...CREDENTIALS, clientId: "17270423289641479650" }, bank.fetchImpl).listAccounts();
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
    new GolomtClient(CREDENTIALS, failed.fetchImpl).listAccounts(),
    /дансны жагсаалт\): account\.not\.permitted/
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
    return request.url.includes("state=S9") ? { body: encrypted({ operAccounts: [] }) } : { body: encrypted(consent) };
  });
  await new GolomtClient(CREDENTIALS, once.fetchImpl).listAccounts();
  assert.match(once.calls[2].url, /client_id=C9&state=S9&scope=SC9$/);

  const always = fakeBank((request) =>
    request.url.endsWith("/v1/auth/login") ? { body: JSON.stringify({ token: "T1" }) } : { body: encrypted(consent) }
  );
  await assert.rejects(new GolomtClient(CREDENTIALS, always.fetchImpl).listAccounts(), /зөвшөөрлийн холбоос: https:\/\/openapi-uat/);
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
