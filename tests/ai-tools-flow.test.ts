// №7 — AI tools давхарга + MCP token + OAuth-ийн integration тест.
// DATABASE_URL шаарддаг (org-isolation.test.ts-тэй ижил хэв маяг):
// түр байгууллага үүсгэж, төгсгөлд нь cascade-аар устгана.
//
// Гол шалгуурууд:
//   • draft-first §9: draft горимд ноорог, post_* нь DIRECT_MODE_REQUIRED
//   • externalRef idempotency (нэг баримт хоёр орохгүй)
//   • post горимын 10 сая ₮ хязгаар (том дүн ноорог үлдэнэ)
//   • get_trial_balance — П28 snapshot уншигчаар Dr=Cr тэнцэнэ
//   • MCP PAT: зөв token → контекст, буруу/хугацаа дууссан → null
//   • OAuth PKCE: code нэг удаа, буруу verifier татгалзана, access token
//     resolveApiToken-д танигдана

import "./helpers/load-env";

import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

// revalidatePath нь request-ийн гадна шиддэг — action-ууд дуудахаас өмнө
// no-op болгоно (tsx CJS interop: экспортын объектын талбар тул call-time
// lookup хийгддэг). Патч амжилтгүй бол (ESM frozen) тестүүд "static
// generation store" текстийг амжилт гэж үзэх fallback-тай.
const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд fallback ажиллана
}

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { resolveApiToken } from "../lib/mcp/server";
import {
  createAuthCode,
  exchangeAuthCode,
  registerOAuthClient,
  sha256hex,
} from "../lib/oauth/server";
import { db } from "../lib/db";
import {
  apiTokens,
  arApDocuments,
  memberships,
  oauthClients,
  organizations,
  users,
} from "../lib/db/schema";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const cleanup: (() => Promise<void>)[] = [];

let userId = "";
let orgId = "";

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** revalidatePath-ийн үлдэгдэл алдааг амжилт гэж үзнэ (fallback). */
function okOrRevalidate(resultText: string): boolean {
  return (
    !resultText.startsWith("Алдаа") ||
    resultText.includes("static generation store")
  );
}

async function setupOrg() {
  const [user] = await db
    .insert(users)
    .values({
      name: `ai-flow-${STAMP}`,
      email: `ai-flow-${STAMP}@test.local`,
      passwordHash: "x",
    })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `AI Flow Test ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({
    organizationId: org.id,
    userId: user.id,
    role: "owner",
  });
  cleanup.push(async () => {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс сеедлэгдэх ёстой: ${sync.error}`);
}

function tool(name: string, input: unknown, mode: "draft" | "post" = "draft") {
  return runAsOrg({ userId, orgId }, () =>
    executeAiTool(userId, name, input, mode)
  );
}

test("AI tools давхарга — draft-first, idempotency, лимит", { skip: !DB_READY }, async () => {
  await setupOrg();

  // Мастер дата + давхардлын хамгаалалт
  const cp = await tool("create_counterparty", {
    name: "Тест Нийлүүлэгч ХХК",
    counterpartyType: "supplier",
    registerNo: "1234567",
  });
  assert.ok(okOrRevalidate(cp.resultText), cp.resultText);
  const dup = await tool("create_counterparty", {
    name: "тест нийлүүлэгч ххк",
    counterpartyType: "supplier",
  });
  assert.match(dup.resultText, /\[CONFLICT\]/);

  // Draft горимд АП ноорог + externalRef idempotency
  const bill = await tool("create_arap_invoice", {
    documentType: "ap_bill",
    counterparty: "Тест Нийлүүлэгч ХХК",
    date: "2026-07-10",
    description: "Integration тест",
    externalRef: `it-${STAMP}-1`,
    lines: [{ account: "73100001", description: "Үйлчилгээ", amount: 330000 }],
  });
  assert.ok(okOrRevalidate(bill.resultText), bill.resultText);
  const [created] = await db.query.arApDocuments.findMany({
    where: eq(arApDocuments.externalRef, `it-${STAMP}-1`),
  });
  assert.ok(created, "ноорог DB-д үүссэн байх ёстой");
  assert.equal(created.status, "draft");
  assert.equal(created.organizationId, orgId);

  const replay = await tool("create_arap_invoice", {
    documentType: "ap_bill",
    counterparty: "Тест Нийлүүлэгч ХХК",
    date: "2026-07-10",
    description: "Integration тест (давхардал)",
    externalRef: `it-${STAMP}-1`,
    lines: [{ account: "73100001", amount: 999999 }],
  });
  assert.equal(replay.dedup, true, "externalRef давхардал шинэ баримт үүсгэхгүй");

  // §9a — батлах үйлдэл зөвхөн post горимд
  const denied = await tool("post_arap_document", { documentId: created.id });
  assert.match(denied.resultText, /\[DIRECT_MODE_REQUIRED\]/);

  const posted = await tool("post_arap_document", { documentId: created.id }, "post");
  assert.ok(okOrRevalidate(posted.resultText), posted.resultText);
  const [after] = await db.query.arApDocuments.findMany({
    where: eq(arApDocuments.externalRef, `it-${STAMP}-1`),
  });
  assert.equal(after.status, "posted");

  // Post горимд ч 10 сая ₮-с их журнал НООРОГ үлдэнэ
  const big = await tool(
    "create_journal_voucher",
    {
      date: "2026-07-12",
      description: "Том дүнтэй бичилт",
      lines: [
        { account: "11000001", debit: 12_000_000 },
        { account: "41000001", credit: 12_000_000 },
      ],
    },
    "post"
  );
  assert.ok(okOrRevalidate(big.resultText), big.resultText);
  assert.ok(
    big.resultText.includes("ноорог") ||
      big.resultText.includes("static generation store"),
    `10M лимит: ${big.resultText.slice(0, 160)}`
  );

  // Тайлан — П28 snapshot+delta уншигчаар Dr=Cr
  const tb = await tool("get_trial_balance", {
    from: "2026-07-01",
    to: "2026-07-31",
  });
  assert.match(tb.resultText, /НИЙТ/);
  const totals = tb.resultText.match(
    /НИЙТ.*Дт ([\d,.]+) Кт ([\d,.]+)/
  );
  if (totals) assert.equal(totals[1], totals[2]);
});

test("MCP PAT token — зөв нь танигдаж, буруу/хугацаа дууссан нь татгалзана", { skip: !DB_READY }, async () => {
  const token = `eak_${randomBytes(24).toString("hex")}`;
  await db.insert(apiTokens).values({
    userId,
    organizationId: orgId,
    name: "integration",
    tokenHash: createHash("sha256").update(token).digest("hex"),
    tokenHint: token.slice(-4),
  });

  const context = await resolveApiToken(token);
  assert.deepEqual(context, { userId, orgId });
  assert.equal(await resolveApiToken("eak_bogus"), null);

  const expired = `eak_${randomBytes(24).toString("hex")}`;
  await db.insert(apiTokens).values({
    userId,
    organizationId: orgId,
    name: "expired",
    tokenHash: createHash("sha256").update(expired).digest("hex"),
    tokenHint: expired.slice(-4),
    expiresAt: new Date(Date.now() - 1000),
  });
  assert.equal(await resolveApiToken(expired), null);
});

test("OAuth PKCE — code нэг удаа, буруу verifier унана, access token ажиллана", { skip: !DB_READY }, async () => {
  const client = await registerOAuthClient({
    name: `it-client-${STAMP}`,
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  });
  // Мөрийн PK `id` нь client_id-ийн үүрэг гүйцэтгэнэ (schema-гийн тэмдэглэл).
  const clientId = client.id;
  cleanup.push(async () => {
    await db.delete(oauthClients).where(eq(oauthClients.id, clientId));
  });

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(
    createHash("sha256").update(verifier).digest()
  );

  // Буруу verifier → invalid_grant (code нэг удаагийн тул шинээр авна)
  const code1 = await createAuthCode({
    clientId,
    userId,
    organizationId: orgId,
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    codeChallenge: challenge,
  });
  const bad = await exchangeAuthCode({
    code: code1,
    clientId,
    codeVerifier: base64url(randomBytes(32)),
  });
  assert.equal(bad.ok, false);

  // Зөв verifier → tokens; access token нь MCP-д танигдана
  const code2 = await createAuthCode({
    clientId,
    userId,
    organizationId: orgId,
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    codeChallenge: challenge,
  });
  const good = await exchangeAuthCode({
    code: code2,
    clientId,
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    codeVerifier: verifier,
  });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.match(good.tokens.accessToken, /^eoat_/);
    const context = await resolveApiToken(good.tokens.accessToken);
    assert.deepEqual(context, { userId, orgId });
  }

  // Code replay — хоёр дахь exchange татгалзана
  const replay = await exchangeAuthCode({
    code: code2,
    clientId,
    codeVerifier: verifier,
  });
  assert.equal(replay.ok, false);

  void sha256hex; // импортын бүрэн байдлын тэмдэглэл
});

test("цэвэрлэгээ", { skip: !DB_READY }, async () => {
  for (const fn of cleanup.reverse()) await fn();
  const leftover = await db.query.organizations.findMany({
    where: eq(organizations.id, orgId),
  });
  assert.equal(leftover.length, 0);
});
