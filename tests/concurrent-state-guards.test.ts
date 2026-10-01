// Зэрэгцээ засах/устгах/батлах (docs/ontology-audit.md C4, lib/state-guard.ts).
// Action баримтаа уншаад бичих хооронд өөр хүсэлт (AI-ийн параллель tool
// дуудлага, давхар товшилт) баримтыг батлах/засах боломжтой байсан:
//   • засах зам батлагдсан журналыг НООРОГ болгож дарж бичдэг, батлагдсан
//     касс/АР/АП баримтын дүнг GL-ээс салгаж өөрчилдөг;
//   • батлах зам транзакцаас гадна уншсан ХУУЧИН дүнгээр журнал бичдэг;
//   • ноорог устгах зам хооронд нь батлагдсан баримтыг журналгүй устгадаг.
// Уралдааныг ТОДОРХОЙ давтана: тусдаа холболтоор мөрийг түгжиж «зэрэгцээ»
// өөрчлөлтөө хийнэ → action бичих гээд хүлээнэ (pg_stat_activity-аар
// харна) → commit → action ИЛ алдаа өгч, юу ч дарж бичихгүй байх ёстой.
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts, updateVoucher } from "../lib/actions/gl";
import { deleteArApDocument, postArApDocument, updateArApDocument } from "../lib/actions/arap";
import { deleteCashDocument, postCashDocument, updateCashDocument } from "../lib/actions/cash";
import { deleteInventoryMovement } from "../lib/actions/inventory";
import { db } from "../lib/db";
import {
  arApDocuments,
  cashDocuments,
  inventoryMovements,
  journalLines,
  journalVouchers,
  memberships,
  organizationProfile,
  organizations,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown, mode: "draft" | "post" = "draft") =>
  asOrg(() => executeAiTool(userId, name, input, mode));
function ok<T extends { resultText: string }>(result: T) {
  assert.ok(
    !result.resultText.startsWith("Алдаа") || result.resultText.includes("static generation store"),
    result.resultText
  );
  return result;
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `c4-${STAMP}`, email: `c4-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `C4 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `C4 ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
  ok(await tool("create_cash_account", { name: "Банк", accountType: "bank", currency: "MNT", glAccount: "11000001" }));
  ok(await tool("create_counterparty", { name: "Харилцагч", counterpartyType: "customer" }));
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

/** Action-ийн хүлээлтийг харах — энэ DB дээр түгжээ хүлээж буй өөр сесс. */
async function waitForLockWaiter(sql: postgres.Sql) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await sql`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`;
    if (row.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("action түгжээ хүлээсэнгүй — тест уралдааныг үүсгэж чадсангүй");
}

/**
 * `concurrent`-ийг тусдаа транзакцад ажиллуулж мөрийг түгжээд, action-ийг
 * эхлүүлнэ; action түгжээ хүлээж эхэлмэгц commit хийнэ. Action-ийн үр дүнг буцаана.
 */
async function race<T>(
  concurrent: (tx: postgres.TransactionSql) => Promise<unknown>,
  action: () => Promise<T>
): Promise<{ result?: T; error?: unknown }> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let pending!: Promise<{ result?: T; error?: unknown }>;
    const held = sql.begin(async (tx) => {
      await concurrent(tx);
      pending = action().then(
        (result) => ({ result }),
        (error) => ({ error })
      );
      await waitForLockWaiter(sql);
      release();
    });
    await gate;
    await held;
    return await pending;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function failedWithStateChange(outcome: { result?: unknown; error?: unknown }) {
  const text =
    outcome.error instanceof Error
      ? outcome.error.message
      : String((outcome.result as { error?: string } | undefined)?.error ?? "");
  assert.match(text, /STATE_CHANGED|Зөвхөн ноорог/, `алдаа гарах ёстой байв: ${JSON.stringify(outcome.result)}`);
}

async function draftVoucher(description: string) {
  ok(
    await tool("create_journal_voucher", {
      date: "2025-03-10",
      description,
      lines: [
        { account: "11000001", debit: 1000 },
        { account: "51100000", credit: 1000 },
      ],
    })
  );
  const voucher = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.description, description)),
  });
  assert.equal(voucher?.status, "draft");
  return voucher!;
}

async function draftCash(description: string) {
  ok(
    await tool("create_cash_transaction", {
      documentType: "receipt",
      cashAccount: "Банк",
      date: "2025-03-11",
      amount: 5000,
      counterAccount: "51100000",
      description,
    })
  );
  const document = await db.query.cashDocuments.findFirst({
    where: and(eq(cashDocuments.organizationId, orgId), eq(cashDocuments.description, description)),
  });
  assert.equal(document?.status, "draft");
  return document!;
}

async function draftInvoice(description: string) {
  ok(
    await tool("create_arap_invoice", {
      documentType: "ar_invoice",
      counterparty: "Харилцагч",
      date: "2025-03-12",
      description,
      lines: [{ description: "Үйлчилгээ", amount: 20_000, account: "51100000" }],
    })
  );
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.description, description)),
  });
  assert.equal(document?.status, "draft");
  return document!;
}

test("журнал: засвар зэрэгцээ батлагдсан журналыг ноорог болгож дарж бичихгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const voucher = await draftVoucher("C4 журнал");
  const outcome = await race(
    (tx) => tx`update journal_vouchers set status = 'posted' where id = ${voucher.id}`,
    () =>
      asOrg(() =>
        updateVoucher(voucher.id, {
          date: "2025-03-10",
          description: "C4 журнал (засвар)",
          status: "draft",
          lines: [
            { account: "11000001", debit: 7000, credit: 0, description: "" },
            { account: "51100000", debit: 0, credit: 7000, description: "" },
          ],
        })
      )
  );
  failedWithStateChange(outcome);
  const after = await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, voucher.id) });
  assert.equal(after?.status, "posted", "батлагдсан хэвээр");
  const lines = await db.query.journalLines.findMany({ where: eq(journalLines.voucherId, voucher.id) });
  assert.deepEqual(lines.map((line) => Number(line.debit) + Number(line.credit)).sort(), [1000, 1000]);
});

test("касс: засвар зэрэгцээ батлагдсан баримтын дүнг өөрчлөхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const document = await draftCash("C4 касс засвар");
  const outcome = await race(
    (tx) => tx`update cash_documents set status = 'posted' where id = ${document.id}`,
    () => asOrg(() => updateCashDocument(document.id, { amount: 9999 }))
  );
  failedWithStateChange(outcome);
  const after = await db.query.cashDocuments.findFirst({ where: eq(cashDocuments.id, document.id) });
  assert.equal(Number(after?.amount), 5000);
});

test("касс: батлалт зэрэгцээ засварын өмнөх ХУУЧИН дүнгээр журнал бичихгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const document = await draftCash("C4 касс батлах");
  const outcome = await race(
    (tx) => tx`update cash_documents set amount = 8000, base_amount = 8000 where id = ${document.id}`,
    () => asOrg(() => postCashDocument(document.id))
  );
  failedWithStateChange(outcome);
  const after = await db.query.cashDocuments.findFirst({ where: eq(cashDocuments.id, document.id) });
  assert.equal(after?.status, "draft", "батлагдаагүй");
  assert.equal(after?.voucherId, null, "журнал үүсээгүй");
});

test("касс: ноорог устгалт зэрэгцээ батлагдсан баримтыг устгахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const document = await draftCash("C4 касс устгах");
  const outcome = await race(
    (tx) => tx`update cash_documents set status = 'posted' where id = ${document.id}`,
    () => asOrg(() => deleteCashDocument(document.id))
  );
  failedWithStateChange(outcome);
  assert.ok(await db.query.cashDocuments.findFirst({ where: eq(cashDocuments.id, document.id) }), "баримт үлдсэн");
});

test("АР: засвар зэрэгцээ батлагдсан нэхэмжлэхийг өөрчлөхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const document = await draftInvoice("C4 АР засвар");
  const outcome = await race(
    (tx) => tx`update ar_ap_documents set status = 'posted' where id = ${document.id}`,
    () =>
      asOrg(() =>
        updateArApDocument(document.id, {
          lines: [{ description: "Үйлчилгээ", amount: 99_000, account: "51100000" }],
        })
      )
  );
  failedWithStateChange(outcome);
  const after = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, document.id) });
  assert.equal(Number(after?.totalAmount), 20_000);
});

test("АР: батлалт зэрэгцээ мөр солисон засварын өмнөх мөрөөр журнал бичихгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const document = await draftInvoice("C4 АР батлах");
  // Засвар нь толгойг (ижил утгаар) шинэчилж мөрийг солино — updateArApDocument-тэй ижил.
  const outcome = await race(
    async (tx) => {
      await tx`update ar_ap_documents set description = description where id = ${document.id}`;
      await tx`update ar_ap_document_lines set amount = 20000, account_number = account_number,
        id = gen_random_uuid() where document_id = ${document.id}`;
    },
    () => asOrg(() => postArApDocument(document.id))
  );
  failedWithStateChange(outcome);
  const after = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, document.id) });
  assert.equal(after?.status, "draft");
});

test("АР: ноорог устгалт зэрэгцээ батлагдсан нэхэмжлэхийг устгахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const document = await draftInvoice("C4 АР устгах");
  const outcome = await race(
    (tx) => tx`update ar_ap_documents set status = 'posted' where id = ${document.id}`,
    () => asOrg(() => deleteArApDocument(document.id))
  );
  failedWithStateChange(outcome);
  assert.ok(await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, document.id) }), "баримт үлдсэн");
});

test("бараа: ноорог устгалт зэрэгцээ баталгаажсан хөдөлгөөнийг шалгалтгүй устгахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_warehouse", { code: "WH1", name: "Агуулах" }, "post"));
  ok(await tool("create_inventory_item", { code: "IT1", name: "Бараа", unit: "ш" }, "post"));
  ok(
    await tool("create_inventory_movement", {
      movementType: "receipt",
      date: "2025-03-13",
      itemCode: "IT1",
      warehouseCode: "WH1",
      quantity: 5,
      description: "C4 хөдөлгөөн",
    })
  );
  const movement = await db.query.inventoryMovements.findFirst({
    where: and(eq(inventoryMovements.organizationId, orgId), eq(inventoryMovements.description, "C4 хөдөлгөөн")),
  });
  assert.equal(movement?.status, "draft");
  const outcome = await race(
    (tx) => tx`update inventory_movements set status = 'confirmed' where id = ${movement!.id}`,
    () => asOrg(() => deleteInventoryMovement(movement!.id))
  );
  failedWithStateChange(outcome);
  assert.ok(await db.query.inventoryMovements.findFirst({ where: eq(inventoryMovements.id, movement!.id) }));
});
