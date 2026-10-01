// Журналын DB түвшний хамгаалалтыг deploy бүрд тавина — `drizzle-kit push`-ийн
// ДАРАА ажиллана (push нь схемд зарлагдаагүй CHECK constraint-ийг устгадаг тул
// өмнө нь тавибал тэр даруй алга болно). Логик, шалтгаан:
// scripts/lib/ledger-invariants.mjs.
//
// ДҮРЭМ: идемпотент, өгөгдөл ХӨНДӨХГҮЙ. Зөрчилтэй DB дээр тухайн хамгаалалтыг
// алгасаж чанга анхааруулна. Deploy-г зогсоохгүй (exit 0) — төлөв нь логт
// болон `/api/health`-ийн `ledger` хэсэгт ил.
//
// Ажиллуулах: node scripts/apply-ledger-invariants.mjs   (preDeploy автоматаар)

import { config } from "dotenv";
import postgres from "postgres";

import { applyLedgerInvariants } from "./lib/ledger-invariants.mjs";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("apply-ledger-invariants: DATABASE_URL алга — алгаслаа");
  process.exit(0);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  const { failures, skipped, status } = await applyLedgerInvariants(sql);
  const summary = status
    ? `trigger ${status.triggers}/${status.expectedTriggers}, Дт xor Кт constraint ${status.drXorCr ? "бий" : "АЛГА"}`
    : "төлөв уншигдсангүй";
  console.log(
    failures === 0 && skipped === 0
      ? `apply-ledger-invariants: журналын хамгаалалт бүрэн (${summary})`
      : `apply-ledger-invariants: ⚠ ${failures} алдаа, ${skipped} алгассан — ${summary} (дээрх мөрүүдийг шалга)`
  );
} catch (error) {
  console.error("apply-ledger-invariants:", error);
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(0);
