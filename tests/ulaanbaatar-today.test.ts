// «Өнөөдөр» = Улаанбаатарын өнөөдөр (docs/ontology-audit.md M3, R12).
// AI tool огноогүй дуудагдахад (settle_arap_offset, get_counterparty_balance,
// close_purchase_order) болон хангамж, хэд хэдэн UI анхдагч огноогоо
// `new Date().toISOString().slice(0, 10)` — UTC-ээр бодож, УБ-ын 00:00–08:00
// цагт ӨЧИГДРИЙН (сарын 1-нд өмнөх САРЫН) огноо авдаг байв.
//   • статик: UTC-ийн «өнөөдөр» ба гар «+8 цаг» ХОРИОТОЙ — ulaanbaatarToday();
//   • DB: УБ-ын 2026-04-01 04:00 (UTC 03-31 20:00) цагт огноогүй дуудлага 04-01-ийг авна.
// DB хэсэг DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test, { mock } from "node:test";
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
import { arApDocuments, arApSettlements, memberships, organizations, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";
import { ulaanbaatarToday } from "../lib/periods/document-date";

const ROOT = process.cwd();
const SCANNED = ["lib", "app", "components", "custom"];
const FORBIDDEN: [RegExp, string][] = [
  [/new Date\(\)\s*\.toISOString\(\)\s*\.slice\(0,\s*(7|10)\)/, "UTC-ийн өнөөдөр/сар"],
  [/Date\.now\(\)\s*\+\s*8\s*\*\s*60\s*\*\s*60\s*\*\s*1000/, "гар +8 цаг"],
  [/new Date\(\)\.toLocaleDateString\("(sv-SE|en-CA)"\)/, "хөтчийн цагийн бүс"],
];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

test("статик: «өнөөдөр»-ийг UTC / гар +8 цагаар бодохгүй — ulaanbaatarToday()", () => {
  const found: string[] = [];
  for (const file of SCANNED.flatMap((dir) => sourceFiles(path.join(ROOT, dir)))) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const [pattern, label] of FORBIDDEN)
        if (pattern.test(line)) found.push(`${path.relative(ROOT, file)}:${index + 1} (${label})`);
    });
  }
  assert.deepEqual(found, [], `lib/periods/document-date.ts-ийн ulaanbaatarToday() / currentDocumentDate() хэрэглэнэ:\n${found.join("\n")}`);
});

test("ulaanbaatarToday: УБ-ын 00:00–08:00 цагт UTC-ээс нэг өдөр түрүүлнэ", () => {
  assert.equal(ulaanbaatarToday(new Date("2026-03-31T20:00:00Z")), "2026-04-01");
  assert.equal(ulaanbaatarToday(new Date("2026-03-31T15:59:59Z")), "2026-03-31");
});

// ─── DB ───────────────────────────────────────────────────────────────────────

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
/** УБ-ын 2026-04-01 04:00 — UTC-ээр хараахан 03-31. */
const UB_EARLY_MORNING = Date.parse("2026-03-31T20:00:00Z");
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const tool = (name: string, input: unknown, mode: "draft" | "post" = "post") =>
  runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, mode));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}

/** Зөвхөн `Date`-ийг хуурамчаар (таймер, DB-ийн хүлээлт хэвийн). */
async function atUbEarlyMorning<T>(fn: () => Promise<T>): Promise<T> {
  mock.timers.enable({ apis: ["Date"], now: UB_EARLY_MORNING });
  try {
    return await fn();
  } finally {
    mock.timers.reset();
  }
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `m3-${STAMP}`, email: `m3-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `M3 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
  ok(await tool("create_counterparty", { name: "Түнш", counterpartyType: "both" }));
}

async function postedInvoice(documentType: "ar_invoice" | "ap_bill", account: string) {
  const externalRef = `m3-${documentType}-${STAMP}`;
  ok(await tool("create_arap_invoice", {
    documentType,
    counterparty: "Түнш",
    date: "2026-04-01",
    description: `M3 ${documentType}`,
    externalRef,
    lines: [{ account, amount: 110_000 }],
  }));
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, externalRef)),
  });
  assert.equal(doc?.status, "posted");
  return doc!;
}

test("get_counterparty_balance: огноогүй — УБ-ын өнөөдрийн (04-01) нэхэмжлэх үлдэгдэлд орно", { skip: !DB_READY }, async () => {
  await setupOrg();
  await postedInvoice("ar_invoice", "51100000");
  const result = ok(await atUbEarlyMorning(() => tool("get_counterparty_balance", { counterparty: "Түнш" })));
  assert.doesNotMatch(result.resultText, /2026-03-31/, result.resultText);
  assert.doesNotMatch(result.resultText, /үлдэгдэлтэй нэхэмжлэх алга/, result.resultText);
});

test("settle_arap_offset: огноогүй — суутгал УБ-ын өнөөдрөөр (өмнөх сар руу ОРОХГҮЙ)", { skip: !DB_READY }, async () => {
  await setupOrg();
  const ar = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.documentType, "ar_invoice")),
  });
  assert.ok(ar, "өмнөх тестийн нэхэмжлэх");
  const ap = await postedInvoice("ap_bill", "61100000");
  ok(await atUbEarlyMorning(() => tool("settle_arap_offset", { arInvoice: ar.documentNo, apBill: ap.documentNo })));
  const settlements = await db.query.arApSettlements.findMany({ where: eq(arApSettlements.documentId, ar.id) });
  assert.ok(settlements.length > 0, "суутгал бүртгэгдсэн");
  for (const settlement of settlements) assert.equal(settlement.settlementDate, "2026-04-01");
});
