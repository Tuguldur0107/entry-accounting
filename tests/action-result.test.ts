import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Server action-ы алдааны мессеж PRODUCTION дээр далдлагддаг:
// Next.js нь шидсэн алдааг React #441 "An error occurred in the Server
// Components render..." болгон орлуулдаг тул хэрэглэгч ойлгомжгүй код
// хардаг (2026-09-19: ҮХ-ийн элэгдэл дээр бодитоор тохиолдсон).
//
// ДҮРЭМ (lib/action-result.ts): client component-оос дуудагддаг action нь
// алдааг throw биш `{ error }` УТГААР буцаана.
//
// Энэ тест тэр дүрмийг АВТОМАТААР сахиулна: шинэ (эсвэл өөрчилсөн) action
// хамгаалалтгүй бол тест УНАНА. Одоо байгаа хамгаалалтгүй action-ууд
// KNOWN_UNGUARDED жагсаалтад ил бүртгэгдсэн — засах бүрд жагсаалтаас
// хасна, жагсаалт хоосрох ёстой. Жагсаалтад ЗӨВХӨН хасалт хийнэ, нэмэлт
// оруулахыг хориглоно.

const ACTIONS_DIR = "lib/actions";
const CLIENT_DIRS = ["components", "app"];

/** Засагдаагүй хуучин өр — ЗӨВХӨН багасна (шинээр нэмэхгүй). */
const KNOWN_UNGUARDED = new Set([
  "ai.ts:saveAiChatPrefs",
  "ai.ts:saveAiSettings",
  "ai.ts:setAiApiKey",
  "ai.ts:setAiOpenAiApiKey",
  "arap.ts:getArapDocPanelData",
  "arap.ts:toggleCounterparty",
  "cash.ts:getCashNewPanelData",
  "company.ts:updateCompanySettings",
  "cost-allocation.ts:createCostAllocation",
  "costing-master.ts:saveCostingAccountSettings",
  "costing.ts:createNrvEntry",
  "costing.ts:deleteCostEntry",
  "costing.ts:postCostEntries",
  "costing.ts:postCostEntry",
  "costing.ts:reverseCostEntry",
  "costing.ts:runCosting",
  "costing.ts:upsertCostingItemSetting",
  "costing.ts:upsertIssueType",
  "fa.ts:getFaAssetPanelData",
  "fa.ts:getFaTieOutDetail",
  "inventory-import.ts:importInventoryItems",
  "inventory.ts:confirmInventoryMovements",
  "inventory.ts:createInventoryCategory",
  "inventory.ts:createInventoryItem",
  "inventory.ts:createWarehouse",
  "inventory.ts:toggleInventoryCategory",
  "inventory.ts:updateInventoryCategory",
  "inventory.ts:updateInventoryItem",
  "inventory.ts:updateWarehouse",
  "invoice-send.ts:createInvoiceLink",
  "invoice-send.ts:getInvoiceSendContext",
  "notification-preferences.ts:saveNotificationPreferences",
  "telegram-link.ts:startTelegramLink",
  "telegram-link.ts:verifyTelegramLink",
  "vat.ts:createVatSettlementDraft",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Client component-ууд ямар action нэр импортолдог вэ. */
function clientImportedActionNames(): Set<string> {
  const names = new Set<string>();
  for (const dir of CLIENT_DIRS) {
    for (const file of walk(dir)) {
      const src = readFileSync(file, "utf8");
      if (!src.slice(0, 80).includes('"use client"')) continue;
      const imports = src.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*"@\/lib\/actions\/[^"]+"/g
      );
      for (const match of imports)
        for (const raw of match[1].split(",")) {
          const name = raw.trim().split(/\s+as\s+/)[0].trim();
          if (name && !name.startsWith("type ")) names.add(name);
        }
    }
  }
  return names;
}

test("client-ээс дуудагддаг server action алдааг throw хийхгүй (React #441)", () => {
  const clientNames = clientImportedActionNames();
  assert.ok(clientNames.size > 20, "client импортууд олдсонгүй — тест эвдэрсэн");

  const offenders: string[] = [];
  const stale: string[] = [];

  for (const file of readdirSync(ACTIONS_DIR)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(join(ACTIONS_DIR, file), "utf8");
    if (!src.slice(0, 200).includes('"use server"')) continue;

    const fns = [
      ...src.matchAll(
        /export async function (\w+)\s*\(([^)]*)\)\s*:?\s*([^{]*)\{/g
      ),
    ];
    for (const [index, match] of fns.entries()) {
      const name = match[1];
      const returnType = match[3];
      const start = match.index!;
      const end = fns[index + 1]?.index ?? src.length;
      const body = src.slice(start, end);

      const guarded =
        returnType.includes("ActionResult") ||
        body.includes("return { error") ||
        body.includes("return actionError");
      const throws = body.includes("throw new Error");
      const key = `${file}:${name}`;

      if (!clientNames.has(name)) continue;
      if (guarded || !throws) {
        // Засагдсан action жагсаалтад үлдсэн бол жагсаалтыг цэвэрлэнэ.
        if (KNOWN_UNGUARDED.has(key)) stale.push(key);
        continue;
      }
      if (!KNOWN_UNGUARDED.has(key)) offenders.push(key);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Эдгээр action алдааг throw хийж байна — production дээр React #441 болно.\n` +
      `lib/action-result.ts-ийн actionError-оор { error } буцаана уу:\n  ` +
      offenders.join("\n  ")
  );
  assert.deepEqual(
    stale,
    [],
    `Эдгээр action ЗАСАГДСАН — KNOWN_UNGUARDED жагсаалтаас хасна уу:\n  ` +
      stale.join("\n  ")
  );
});
