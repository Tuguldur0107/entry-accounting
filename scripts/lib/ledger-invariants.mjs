// Журналын DB түвшний хамгаалалт (П26) — ЭХ СУРВАЛЖ НЭГ ЭНД.
//
// ШАЛТГААН (2026-10-01, production P0 хэмжилт): хамгаалалтыг
// `lib/db/migrations/manual/2026-08-19-ledger-invariants.sql`-аар ГАРААР
// тавьдаг байсан тул deploy-оор хэзээ ч тавигдаагүй:
//   • SaaS DB-д trigger-үүд гараар суусан, харин Дт/Кт CHECK constraint
//     алга — `drizzle-kit push --force` схемд зарлагдаагүй CHECK-ийг deploy
//     бүрд УСТГАДАГ (локал DB дээр нотолсон). Trigger, function-ийг push
//     хөндөхгүй.
//   • SmartGPS (dedicated) DB-д нэг ч хамгаалалт байгаагүй.
// Одоо `scripts/apply-ledger-invariants.mjs` push-ийн ДАРАА deploy бүрд
// идемпотентоор тавина (CI-ийн DB тестүүд ч хамгаалалттай ажиллана).
//
// Тэмдэглэл:
//   * Дүнгийн ТЭМДГИЙГ хязгаарлахгүй — буцаалт улаан сторно (сөрөг дүн)
//     тул debit>=0 CHECK зориуд ТАВИХГҮЙ.
//   * Батлагдсан журналд мөр ШИНЭЭР нэмэхийг хориглохгүй — post урсгалууд
//     "posted" журнал үүсгээд мөрөө нэг транзакцад оруулдаг; тэнцлийг
//     commit үед deferred trigger шалгана.
//   * Батлагдсан журналыг БҮХЛЭЭР нь устгах нь зөвшөөрөгдсөн урсгал
//     (тайлант үе нээлттэй, integrity guard-тай) — cascade саадгүй; зөвхөн
//     МӨРИЙГ дангаар нь өөрчлөх/устгахыг хориглоно.
//
// ЦЭВЭР хэсэг (`planLedgerInvariants`) нь тесттэй; `applyLedgerInvariants`
// нь дуудагчийн өгсөн `postgres` холболтоор ажиллана.

/** Хамгаалалт тус бүрийн DB дахь нэр — health ба тест эндээс уншина. */
export const LEDGER_TRIGGER_NAMES = [
  "ea_journal_lines_balanced",
  "ea_journal_vouchers_balanced",
  "ea_journal_lines_protect",
];
export const LEDGER_CONSTRAINT_NAME = "journal_lines_dr_xor_cr";

/**
 * 1. Нэг мөрөнд Дт, Кт зэрэг бөглөгдөхгүй.
 * push нь deploy бүрд устгадаг тул дахин тавина: эхлээд `NOT VALID` (хүснэгт
 * уншихгүй, түгжээ агшин зуурынх — шинэ мөрөнд даруй хүчинтэй), дараа нь
 * ТУСДАА транзакцад `VALIDATE` (SHARE UPDATE EXCLUSIVE — уншилт/бичилтийг
 * хаахгүй). Хүчинтэйгээр байгаа бол хөндөхгүй.
 */
const DR_XOR_CR_ADD_SQL = [
  `ALTER TABLE journal_lines DROP CONSTRAINT IF EXISTS ${LEDGER_CONSTRAINT_NAME}`,
  `ALTER TABLE journal_lines ADD CONSTRAINT ${LEDGER_CONSTRAINT_NAME}
     CHECK (NOT (debit <> 0 AND credit <> 0)) NOT VALID`,
];
const DR_XOR_CR_VALIDATE_SQL = `ALTER TABLE journal_lines VALIDATE CONSTRAINT ${LEDGER_CONSTRAINT_NAME}`;

/** 2. Батлагдсан/буцаагдсан журнал бүр commit үед ΣДт = ΣКт (±0.011). */
const BALANCE_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION ea_assert_voucher_balanced() RETURNS trigger AS $$
DECLARE
  v_id uuid;
  v_status text;
  imbalance numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_vouchers' THEN
    v_id := NEW.id;
  ELSE
    v_id := COALESCE(NEW.voucher_id, OLD.voucher_id);
  END IF;

  SELECT status INTO v_status FROM journal_vouchers WHERE id = v_id;
  -- Журнал устсан (cascade) эсвэл ноорог — шалгах зүйлгүй.
  IF v_status IS NULL OR v_status NOT IN ('posted', 'reversed') THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit - credit), 0) INTO imbalance
  FROM journal_lines WHERE voucher_id = v_id;

  IF ABS(imbalance) > 0.011 THEN
    RAISE EXCEPTION
      'Журнал тэнцэхгүй байна: ваучер %, ΣДт−ΣКт = %', v_id, imbalance;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql`;

/**
 * 3. Батлагдсан/буцаагдсан журналын мөрийг дангаар өөрчлөх/устгахыг хориглоно.
 * (Журналаа БҮХЛЭЭР нь устгахад эцэг мөр эхэлж устдаг тул SELECT юу ч
 * олохгүй → cascade саадгүй.)
 */
const PROTECT_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION ea_protect_posted_lines() RETURNS trigger AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM journal_vouchers WHERE id = OLD.voucher_id;
  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION
      'Батлагдсан журналын мөрийг өөрчлөх/устгах хориотой — буцаалтаар засна (voucher %)',
      OLD.voucher_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql`;

/**
 * Trigger бүрийн тодорхойлолт. Байхгүй үед л үүсгэнэ — deploy бүрд DROP +
 * CREATE хийвэл journal_lines-ийг (апп ажиллаж байх зуур) дахин дахин түгжинэ.
 * Функцийн биеийг CREATE OR REPLACE шинэчилдэг (хүснэгт түгжихгүй). Trigger-ийн
 * ТОДОРХОЙЛОЛТ (event, WHEN) өөрчлөгдвөл нэрийг нь шинэчилнэ.
 */
const TRIGGERS = {
  ea_journal_lines_balanced: `CREATE CONSTRAINT TRIGGER ea_journal_lines_balanced
     AFTER INSERT OR UPDATE OR DELETE ON journal_lines
     DEFERRABLE INITIALLY DEFERRED
     FOR EACH ROW EXECUTE FUNCTION ea_assert_voucher_balanced()`,
  // Ноорог батлагдах мөч (status UPDATE) мөн шалгагдана.
  ea_journal_vouchers_balanced: `CREATE CONSTRAINT TRIGGER ea_journal_vouchers_balanced
     AFTER UPDATE OF status ON journal_vouchers
     DEFERRABLE INITIALLY DEFERRED
     FOR EACH ROW
     WHEN (NEW.status IN ('posted', 'reversed'))
     EXECUTE FUNCTION ea_assert_voucher_balanced()`,
  ea_journal_lines_protect: `CREATE TRIGGER ea_journal_lines_protect
     BEFORE UPDATE OR DELETE ON journal_lines
     FOR EACH ROW EXECUTE FUNCTION ea_protect_posted_lines()`,
};

/** Тавихаас ӨМНӨ одоо байгаа зөрчлийг тоолох асуулга (docs/ontology-audit.md §7.2 V01, V02). */
export const IMBALANCED_VOUCHERS_SQL = `select count(*)::int as n from (
  select v.id from journal_vouchers v join journal_lines l on l.voucher_id = v.id
  where v.status in ('posted', 'reversed')
  group by v.id having abs(sum(l.debit) - sum(l.credit)) > 0.011
) q`;
export const DUAL_SIDED_LINES_SQL = `select count(*)::int as n from journal_lines
  where debit <> 0 and credit <> 0`;

/**
 * Аль хамгаалалтыг тавихыг шийднэ (ЦЭВЭР).
 *
 * Зөрчилтэй DB дээр хамгаалалт ТАВИХГҮЙ, харин чанга анхааруулна:
 *   • constraint — одоо байгаа зөрчилтэй мөр дээр ADD CONSTRAINT унана;
 *   • тэнцлийн trigger — тэнцээгүй журналд хамаарах дараагийн ямар ч
 *     өөрчлөлт (жишээ нь буцаалт) commit дээр унаж засах замыг хаана.
 * Зөрчлийг нягтлан бодогч залруулах журналаар засна (ontology-audit P4) —
 * АВТОМАТААР нөхөхгүй. Мөрийн хамгаалалт өгөгдлөөс хамаарахгүй тул үргэлж.
 *
 * @param {{ imbalancedVouchers: number, dualSidedLines: number }} counts
 */
export function planLedgerInvariants({ imbalancedVouchers, dualSidedLines }) {
  const warnings = [];
  if (dualSidedLines > 0)
    warnings.push(
      `${dualSidedLines} журналын мөрөнд Дт, Кт зэрэг бөглөгдсөн — ${LEDGER_CONSTRAINT_NAME} тавигдсангүй (ontology-audit V02)`
    );
  if (imbalancedVouchers > 0)
    warnings.push(
      `${imbalancedVouchers} батлагдсан журнал тэнцээгүй — тэнцлийн trigger тавигдсангүй (ontology-audit V01)`
    );
  return {
    constraint: dualSidedLines === 0,
    balanceTriggers: imbalancedVouchers === 0,
    protectTrigger: true,
    warnings,
  };
}

/** Хамгаалалтын бүлгүүд (төлөвлөгөөний түлхүүрээр). */
export const LEDGER_INVARIANT_GROUPS = [
  { key: "constraint", label: `${LEDGER_CONSTRAINT_NAME} (Дт xor Кт)` },
  {
    key: "balanceTriggers",
    label: "тэнцлийн trigger (commit үед ΣДт = ΣКт)",
    functionSql: BALANCE_FUNCTION_SQL,
    triggers: ["ea_journal_lines_balanced", "ea_journal_vouchers_balanced"],
  },
  {
    key: "protectTrigger",
    label: "батлагдсан мөрийн хамгаалалт",
    functionSql: PROTECT_FUNCTION_SQL,
    triggers: ["ea_journal_lines_protect"],
  },
];

/** DB-д одоо тавигдсан хамгаалалтын төлөв (health, баталгаажуулалт). */
export async function readLedgerInvariantStatus(sql) {
  const [row] = await sql.unsafe(
    `select
       (select count(*)::int from pg_trigger
         where not tgisinternal and tgname in (${LEDGER_TRIGGER_NAMES.map((name) => `'${name}'`).join(", ")})) as triggers,
       (select count(*)::int from pg_constraint where conname = '${LEDGER_CONSTRAINT_NAME}') as constraints`
  );
  return {
    triggers: Number(row?.triggers ?? 0),
    expectedTriggers: LEDGER_TRIGGER_NAMES.length,
    drXorCr: Number(row?.constraints ?? 0) > 0,
  };
}

/** Хуучин апп хүсэлт үйлчилж байх зуур удаан түгжээнд гацахгүй. */
async function inTx(sql, statements) {
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local lock_timeout = '15s'`);
    for (const statement of statements) await tx.unsafe(statement);
  });
}

async function ensureConstraint(sql) {
  const [existing] = await sql.unsafe(
    `select convalidated from pg_constraint where conname = '${LEDGER_CONSTRAINT_NAME}'`
  );
  if (existing?.convalidated) return "бий";
  if (!existing) await inTx(sql, DR_XOR_CR_ADD_SQL);
  await inTx(sql, [DR_XOR_CR_VALIDATE_SQL]);
  return existing ? "баталгаажуулав" : "тавив";
}

async function ensureTriggers(sql, group) {
  const rows = await sql.unsafe(
    `select tgname from pg_trigger where not tgisinternal
       and tgname in (${group.triggers.map((name) => `'${name}'`).join(", ")})`
  );
  const present = new Set(rows.map((row) => row.tgname));
  const missing = group.triggers.filter((name) => !present.has(name));
  // Функц + дутуу trigger НЭГ транзакцад — дутуу үед л journal_lines түгжигдэнэ.
  await inTx(sql, [group.functionSql, ...missing.map((name) => TRIGGERS[name])]);
  return missing.length === 0 ? "бий" : `тавив (${missing.join(", ")})`;
}

/**
 * Хамгаалалтыг тавина (идемпотент). ХЭЗЭЭ Ч шидэхгүй — алдаа бүр `log`-оор
 * ил гарч, үр дүнд тоологдоно.
 *
 * @param {import("postgres").Sql} sql
 * @param {(line: string) => void} [log]
 */
export async function applyLedgerInvariants(sql, log = console.log) {
  let counts;
  try {
    const [imbalanced] = await sql.unsafe(IMBALANCED_VOUCHERS_SQL);
    const [dualSided] = await sql.unsafe(DUAL_SIDED_LINES_SQL);
    counts = { imbalancedVouchers: Number(imbalanced.n), dualSidedLines: Number(dualSided.n) };
  } catch (error) {
    log(`✗ журналын хамгаалалт: зөрчлийн шалгалт уншигдсангүй — ${error.message}`);
    return { failures: 1, skipped: LEDGER_INVARIANT_GROUPS.length, status: null };
  }

  const plan = planLedgerInvariants(counts);
  for (const warning of plan.warnings) log(`⚠ ${warning}`);

  let failures = 0;
  let skipped = 0;
  for (const group of LEDGER_INVARIANT_GROUPS) {
    if (!plan[group.key]) {
      skipped += 1;
      log(`⊘ ${group.label}: алгаслаа (дээрх анхааруулга)`);
      continue;
    }
    try {
      const outcome = group.key === "constraint" ? await ensureConstraint(sql) : await ensureTriggers(sql, group);
      log(`✓ ${group.label}: ${outcome}`);
    } catch (error) {
      failures += 1;
      log(`✗ ${group.label}: ${error.message}`);
    }
  }

  const status = await readLedgerInvariantStatus(sql).catch(() => null);
  return { failures, skipped, status };
}
