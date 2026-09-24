import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  REPORT_REGISTRY,
  findActiveReportHref,
  reportModuleOfHref,
} from "../lib/constants/report-registry";

// ТАЙЛАНГИЙН СТАНДАРТ (CLAUDE.md «Тайлангийн стандарт») — статик хамгаалалт.
//
// 2026-09-24: тайлан бүр өөр зарчимтай байв — зарим нь топбарын сонгогчоор,
// зарим нь хуудас доторх табаар ӨӨР тайлан руу шилждэг; зарим нь өөрийн
// огнооны талбар + «Шинэчлэх» товчтой, зарим нь хөл дүнгүй. Дүрэм:
//   1. Тайлан солих = ЗӨВХӨН топбарын сонгогч → тайлангийн route бүр registry-д
//   2. Хуудас доторх таб = НЭГ тайлангийн зүсэлт л
//   3. Огноо = ЗӨВХӨН топбарын период → тайлангийн view-д огнооны input байхгүй
//   4. Жааз = components/reports/report-layout.tsx (ReportPage/Header/Toolbar/Empty)

const ROOT = path.join(import.meta.dirname, "..");
const DASHBOARD = path.join(ROOT, "app", "(dashboard)");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** app/(dashboard)/x/reports/y/page.tsx → "/x/reports/y" */
function routeOf(pageFile: string): string {
  const rel = path.relative(DASHBOARD, path.dirname(pageFile)).split(path.sep).join("/");
  return `/${rel}`;
}

const REPORT_ROUTES = walk(DASHBOARD)
  .filter((file) => file.endsWith(`${path.sep}page.tsx`))
  .map(routeOf)
  .filter((route) => /(^|\/)reports(\/|$)/.test(route));

/** Тайлангийн харагдац (client view) — огнооны талбаргүй, нэгдсэн жаазтай. */
const REPORT_VIEWS = [
  "components/inventory/inventory-report-view.tsx",
  "components/pos/sales-report-view.tsx",
  "components/cash/cash-report-view.tsx",
  "components/fa/fa-report-view.tsx",
  "components/procurement/procurement-report-view.tsx",
  "components/payroll/salary-payment-report-view.tsx",
  "components/payroll/payslip-report-view.tsx",
  "components/costing/cost-control-report.tsx",
  "components/costing/costing-report-view.tsx",
  "components/costing/transaction-detail-report.tsx",
  "components/costing/component-analysis-report.tsx",
  "components/gl/reports-view.tsx",
];

test("тайлангийн route бүр топбарын registry-д бүртгэлтэй (өөр тайлан руу зөвхөн сонгогчоор)", () => {
  assert.ok(REPORT_ROUTES.length >= 10, `тайлангийн route олдсонгүй: ${REPORT_ROUTES}`);
  const registered = new Set(
    REPORT_REGISTRY.flatMap((reportModule) => reportModule.entries.map((entry) => entry.href.split("?")[0]))
  );
  const missing = REPORT_ROUTES.filter((route) => !registered.has(route));
  assert.deepEqual(missing, [], `registry-д нэмнэ үү (lib/constants/report-registry.ts): ${missing}`);
});

test("registry-ийн href бүр бодит хуудас руу заана", () => {
  for (const reportModule of REPORT_REGISTRY) {
    for (const entry of reportModule.entries) {
      const [pathname] = entry.href.split("?");
      const file = path.join(DASHBOARD, ...pathname.split("/").filter(Boolean), "page.tsx");
      assert.ok(existsSync(file), `${reportModule.moduleId}/${entry.value}: ${pathname} хуудас алга`);
    }
  }
});

test("registry: утга/href давхардахгүй, параметртэй модулийн href параметрээ хэрэглэнэ", () => {
  const hrefs = REPORT_REGISTRY.flatMap((reportModule) => reportModule.entries.map((entry) => entry.href));
  assert.equal(new Set(hrefs).size, hrefs.length, "давхардсан href");
  for (const reportModule of REPORT_REGISTRY) {
    const values = reportModule.entries.map((entry) => entry.value);
    assert.equal(new Set(values).size, values.length, `${reportModule.moduleId}: давхардсан value`);
    if (!reportModule.param) continue;
    reportModule.entries.forEach((entry, index) => {
      const url = new URL(entry.href, "http://x");
      assert.equal(url.pathname, reportModule.basePath, `${entry.href} basePath-аас гадуур`);
      // Эхний мөр = default (параметргүй байж болно); бусад нь ?<param>=<value>.
      const value = url.searchParams.get(reportModule.param!);
      if (index === 0 && value === null) return;
      assert.equal(value, entry.value, `${entry.href}: ?${reportModule.param}=${entry.value} байх ёстой`);
    });
  }
});

test("findActiveReportHref — параметртэй ба route-той модулиуд", () => {
  const params = (map: Record<string, string>) => (key: string) => map[key] ?? null;
  assert.equal(findActiveReportHref("/inventory/reports", params({})), "/inventory/reports");
  assert.equal(
    findActiveReportHref("/inventory/reports", params({ tab: "sales", view: "items" })),
    "/inventory/reports?tab=sales"
  );
  assert.equal(
    findActiveReportHref("/payroll/reports", params({ view: "payslip" })),
    "/payroll/reports?view=payslip"
  );
  // Танигдахгүй утга → default тайлан.
  assert.equal(findActiveReportHref("/payroll/reports", params({ view: "zzz" })), "/payroll/reports");
  assert.equal(
    findActiveReportHref("/gl/reports", params({ report: "cash-flow" })),
    "/gl/reports?report=cash-flow"
  );
  assert.equal(
    findActiveReportHref("/costing/reports/detail", params({ from: "2026-09-01" })),
    "/costing/reports/detail"
  );
  assert.equal(findActiveReportHref("/tax/vat", params({})), "/tax/vat");
  assert.equal(findActiveReportHref("/gl/journal", params({})), null);
  assert.equal(reportModuleOfHref("/inventory/reports?tab=sales")?.moduleId, "inventory");
  assert.equal(reportModuleOfHref("/costing/reports/valuation")?.moduleId, "costing");
});

test("тайлангийн view: огнооны талбар / «Шинэчлэх» товч БАЙХГҮЙ, нэгдсэн жаазтай", () => {
  for (const rel of REPORT_VIEWS) {
    const source = readFileSync(path.join(ROOT, rel), "utf8");
    // NRV диалог шиг БИЧИЛТИЙН огноо зөвшөөрөгдөнө — тэр нь Dialog дотор.
    const outsideDialogs = source.replace(/<Dialog[\s\S]*?<\/Dialog>/g, "");
    assert.ok(
      !/type="date"/.test(outsideDialogs),
      `${rel}: тайлангийн огноо зөвхөн топбарын периодоос — огнооны input хасна уу`
    );
    assert.ok(!/>\s*Шинэчлэх\s*</.test(source), `${rel}: «Шинэчлэх» товч хэрэггүй (URL/период)`);
    assert.ok(source.includes("<ReportPage>"), `${rel}: ReportPage жааз хэрэглэнэ`);
    assert.ok(source.includes("<ReportHeader"), `${rel}: ReportHeader хэрэглэнэ`);
  }
});

test("хуудас доторх таб ӨӨР тайлан руу шилжүүлэхгүй (хасагдсан компонентууд эргэж ирэхгүй)", () => {
  const sources = walk(path.join(ROOT, "components"))
    .concat(walk(path.join(ROOT, "app")))
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => [file, readFileSync(file, "utf8")] as const);
  for (const [file, source] of sources) {
    for (const banned of ["InventoryReportTabs", "PayrollReportTabs"]) {
      assert.ok(!source.includes(banned), `${path.relative(ROOT, file)}: ${banned} — топбарын сонгогч хэрэглэнэ`);
    }
  }
  const arap = readFileSync(path.join(ROOT, "components/arap/arap-workspace.tsx"), "utf8");
  assert.ok(!arap.includes(`label="Тайлант огноо"`), "Насжилтын огноо = топбарын периодын төгсгөл");
  const costingReportsLayout = readFileSync(
    path.join(DASHBOARD, "costing", "reports", "layout.tsx"),
    "utf8"
  );
  assert.ok(
    !costingReportsLayout.includes("CostingSectionTabs"),
    "Өртгийн тайлангууд хооронд топбарын сонгогчоор шилжинэ"
  );
});
