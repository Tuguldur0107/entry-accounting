// Хяналтын дансны хамгаалалт — гар журналаас ГАДНАХ замууд (docs/ontology-audit.md
// M6, R6). `control_account_guard` зөвхөн GL-ийн гар журналд ажилладаг байсан тул:
//   • нэхэмжлэхгүй кассын баримт харилцах данс нь 13110000 / 31000001 —
//     хяналтын дансыг дэд дэвтэргүйгээр хөдөлгөнө;
//   • ҮХ-ийн карт `capitalizeFrom: 31000001` — өглөгийн нэхэмжлэхгүй Кт өглөг;
// хоёулаа дэд дэвтэр ↔ GL зөрүүг ЧИМЭЭГҮЙ үүсгэдэг байв. Одоо гар журналтай
// ИЖИЛ дүрэм: «warn» — анхааруулга, «block» — `[CONTROL_ACCOUNT]`.
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { and, eq } from "drizzle-orm";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { db } from "../lib/db";
import { arApDocuments, cashDocuments, memberships, organizationProfile, organizations, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const tool = (name: string, input: unknown, mode: "draft" | "post" = "post") =>
  runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, mode));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result.resultText;
}
const setGuard = (mode: "warn" | "block") =>
  // Хоригийг AI сулруулахгүй (H6) — тест вэбийн хүний тохиргоог дуурайна.
  db.update(organizationProfile).set({ controlAccountGuard: mode }).where(eq(organizationProfile.organizationId, orgId));

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `m6-${STAMP}`, email: `m6-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `M6 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `M6 ${STAMP}` });
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
  ok(await tool("create_cash_account", { name: "Банк", accountType: "bank", currency: "MNT", glAccount: "11000001" }));
  ok(await tool("create_counterparty", { name: "Түнш", counterpartyType: "both" }));
}

const receipt = (ref: string, counterAccount: string, extra: Record<string, unknown> = {}) =>
  tool("create_cash_transaction", {
    documentType: "receipt",
    cashAccount: "Банк",
    date: "2025-04-10",
    amount: 100_000,
    counterAccount,
    counterparty: "Түнш",
    description: `M6 ${ref}`,
    externalRef: `m6-${ref}-${STAMP}`,
    ...extra,
  });

test("касс: нэхэмжлэхгүй орлого Кт хяналтын данс — warn анхааруулна, block хориглоно", { skip: !DB_READY }, async () => {
  await setupOrg();
  await setGuard("warn");
  assert.match(ok(await receipt("warn", "13110000")), /⚠ Хяналтын данс \(13110000\)/);

  await setGuard("block");
  const blocked = await receipt("block", "13110000");
  assert.match(blocked.resultText, /CONTROL_ACCOUNT/, blocked.resultText);
  const left = await db.query.cashDocuments.findFirst({
    where: and(eq(cashDocuments.organizationId, orgId), eq(cashDocuments.externalRef, `m6-block-${STAMP}`)),
  });
  assert.notEqual(left?.status, "posted", "хяналтын дансыг хөдөлгөөгүй");

  // Хяналтын бус данс (урьдчилгаа, орлого) — хэвийн.
  assert.doesNotMatch(ok(await receipt("advance", "31300001")), /Хяналтын данс/);
  await setGuard("warn");
});

test("касс: нэхэмжлэхтэй төлбөр block горимд ч хэвийн (регресс биш)", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_arap_invoice", {
    documentType: "ar_invoice",
    counterparty: "Түнш",
    date: "2025-04-01",
    description: "M6 нэхэмжлэх",
    externalRef: `m6-inv-${STAMP}`,
    lines: [{ account: "51100000", amount: 100_000 }],
  }));
  const invoice = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `m6-inv-${STAMP}`)),
  });
  assert.equal(invoice?.status, "posted");
  await setGuard("block");
  const paid = ok(await tool("pay_arap_document", { documentId: invoice!.documentNo, cashAccount: "Банк", date: "2025-04-12" }));
  assert.doesNotMatch(paid, /CONTROL_ACCOUNT|Хяналтын данс/);
  await setGuard("warn");
});

test("ҮХ: capitalizeFrom = хяналтын данс — warn анхааруулна, block хориглоно", { skip: !DB_READY }, async () => {
  await setupOrg();
  const asset = (name: string) =>
    tool("create_fixed_asset", {
      name, acquisitionDate: "2025-04-15", cost: 2_000_000, usefulLifeMonths: 36,
      custodian: "Оффис", capitalizeFrom: "31000001",
    });
  await setGuard("warn");
  assert.match(ok(await asset(`Компьютер warn ${STAMP}`)), /⚠ Хяналтын данс \(31000001\)/);

  await setGuard("block");
  const blocked = await asset(`Компьютер block ${STAMP}`);
  assert.match(blocked.resultText, /CONTROL_ACCOUNT/, blocked.resultText);
  // Түр данс (20000099) — хэвийн.
  assert.doesNotMatch(
    ok(await tool("create_fixed_asset", {
      name: `Ширээ ${STAMP}`, acquisitionDate: "2025-04-15", cost: 500_000, usefulLifeMonths: 36,
      custodian: "Оффис", capitalizeFrom: "20000099",
    })),
    /Хяналтын данс/
  );
  await setGuard("warn");
});
