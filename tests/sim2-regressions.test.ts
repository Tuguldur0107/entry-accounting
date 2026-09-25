// Сим 2.0-ийн олдворуудын (entry_sim2_tracker.xlsx, SIM2-xxx) DB integration
// регресс тест. DATABASE_URL шаарддаг: түр байгууллага, төгсгөлд purgeOrganization.

import "./helpers/load-env";

import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
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
import { getPayrollRunData } from "../lib/actions/payroll";
import { db } from "../lib/db";
import { employees, memberships, organizations, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

export function asOrg<T>(fn: () => Promise<T>) {
  return runAsOrg({ userId, orgId }, fn);
}
export function tool(name: string, input: unknown, mode: "draft" | "post" = "draft") {
  return asOrg(() => executeAiTool(userId, name, input, mode));
}
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `sim2-${STAMP}`, email: `sim2-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `SIM2 регресс ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

test("SIM2-019/020: сарын дунд орсон/гарсан ажилтны цалин хувь тэнцүүлэгдэнэ, гарсны дараа бодогдохгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_employee", { name: "Шинэ-Инженер", position: "Инженер", baseSalary: 3_000_000, hireDate: "2025-08-18" }));
  ok(await tool("create_employee", { name: "Багш06", position: "Багш", baseSalary: 1_800_000, hireDate: "2024-01-01" }));
  ok(await tool("create_employee", { name: "Бүтэн", position: "Нягтлан", baseSalary: 2_000_000, hireDate: "2024-01-01" }));

  // 2025-07: Шинэ-Инженер хараахан ороогүй
  ok(await tool("run_payroll", { period: "2025-07" }));
  const jul = await asOrg(() => getPayrollRunData("2025-07"));
  assert.deepEqual(jul.lines.map((l) => l.employeeName).sort(), ["Багш06", "Бүтэн"]);

  // 2025-08: 3,000,000 × 10/21 = 1,428,571 (цалингийн тооцоо бүхэл төгрөгөөр)
  const augText = ok(await tool("run_payroll", { period: "2025-08" })).resultText;
  assert.match(augText, /Шинэ-Инженер \[хэсэгчилсэн сар 10\/21/);
  const aug = await asOrg(() => getPayrollRunData("2025-08"));
  const eng = aug.lines.find((l) => l.employeeName === "Шинэ-Инженер")!;
  assert.equal(eng.earnings, 1_428_571);
  assert.equal(aug.lines.find((l) => l.employeeName === "Бүтэн")!.earnings, 2_000_000);

  // Багш06 2025-09-15-нд гарав → идэвхгүй, 9-р сар 11/22, 10-р сард бодогдохгүй
  ok(await tool("update_employee", { employee: "Багш06", terminationDate: "2025-09-15" }));
  const teacher = await db.query.employees.findFirst({
    where: and(eq(employees.organizationId, orgId), eq(employees.name, "Багш06")),
  });
  assert.equal(teacher?.isActive, false, "гарсан огноо өнгөрсөн тул идэвхгүй");
  ok(await tool("run_payroll", { period: "2025-09" }));
  const sep = await asOrg(() => getPayrollRunData("2025-09"));
  assert.equal(sep.lines.find((l) => l.employeeName === "Багш06")!.earnings, 900_000);
  ok(await tool("run_payroll", { period: "2025-10" }));
  const oct = await asOrg(() => getPayrollRunData("2025-10"));
  assert.equal(oct.lines.some((l) => l.employeeName === "Багш06"), false);
  assert.match((await tool("list_employees", { includeInactive: true })).resultText, /Багш06.*ГАРСАН 2025-09-15/);
});
