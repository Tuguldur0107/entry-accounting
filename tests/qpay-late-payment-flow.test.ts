// QPay хоцорсон төлбөр — QR Entry-д хаагдсаны (expired / cancelled) дараа QPay
// мөнгө хүлээн авсан бол markIntentPaid түүнийг ЧИМЭЭГҮЙ алгасахгүй: paid +
// [QPAY_LATE_PAYMENT] (баннер, attention), дүн зөрвөл failed + payment (мэдэгдэл).
// DATABASE_URL байхгүй бол алгасна.

import "./helpers/load-env";

import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";

import { db } from "../lib/db";
import { memberships, organizations, posQpayIntents, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";
import { countAmountMismatch, countPaidUnfinalized, listPendingIntents, markIntentPaid } from "../lib/qpay/store";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);

test("хоцорсон төлбөр: expired/cancelled → paid + тэмдэг; дүн зөрвөл failed; finalized идемпотент", { skip: !DB_READY }, async () => {
  const [user] = await db
    .insert(users)
    .values({ name: `ql-${STAMP}`, email: `ql-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `QPay late ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  try {
    const past = new Date(Date.now() - 60 * 60_000);
    const intent = async (status: string, invoice: string) => {
      const [row] = await db
        .insert(posQpayIntents)
        .values({
          organizationId: org.id,
          cashierUserId: user.id,
          amount: "4200",
          cartSnapshot: { lines: [{ itemId: "x", quantity: 1 }] },
          status,
          qpayInvoiceId: `${invoice}-${STAMP}`,
          expiresAt: past,
        })
        .returning({ id: posQpayIntents.id });
      return row.id;
    };
    const expired = await intent("expired", "inv-exp");
    const cancelled = await intent("cancelled", "inv-can");
    const lateMismatch = await intent("expired", "inv-mis");
    const finalized = await intent("finalized", "inv-fin");
    const paidAt = new Date(Date.now() - 30 * 60_000);
    const signal = (paidAmount: number | null) => ({ paidAmount, paymentId: "pay-1", paidAt, source: "webhook" as const });

    const a = await markIntentPaid(org.id, expired, signal(4200));
    assert.deepEqual([a.changed, a.status, a.late], [true, "paid", true]);
    const b = await markIntentPaid(org.id, cancelled, signal(null));
    assert.deepEqual([b.changed, b.status, b.late], [true, "paid", true]);
    // Давтагдсан webhook — идемпотент.
    const again = await markIntentPaid(org.id, expired, signal(4200));
    assert.deepEqual([again.changed, again.status], [false, "paid"]);
    const c = await markIntentPaid(org.id, lateMismatch, signal(5000));
    assert.deepEqual([c.changed, c.status, c.late], [true, "failed", true]);
    const d = await markIntentPaid(org.id, finalized, signal(4200));
    assert.deepEqual([d.changed, d.status], [false, "finalized"]);

    const rows = await db.select().from(posQpayIntents).where(eq(posQpayIntents.organizationId, org.id));
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.match(byId.get(expired)!.lastError ?? "", /QPAY_LATE_PAYMENT.*хугацаа дууссаны/);
    assert.match(byId.get(cancelled)!.lastError ?? "", /QPAY_LATE_PAYMENT.*цуцлагдсаны/);
    assert.equal(byId.get(expired)!.paymentId, "pay-1");
    assert.match(byId.get(lateMismatch)!.lastError ?? "", /QPAY_AMOUNT_MISMATCH.*хаагдсаны дараа/);

    // Баннер, attention, мэдэгдлийн тоолуурт харагдана — мөнгө чимээгүй үлдэхгүй.
    const pending = (await listPendingIntents(org.id)).map((view) => view.id).sort();
    assert.deepEqual(pending, [expired, cancelled, lateMismatch].sort());
    assert.equal((await countPaidUnfinalized(org.id)).count, 2);
    assert.equal(await countAmountMismatch(org.id), 1);
  } finally {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  }
});
