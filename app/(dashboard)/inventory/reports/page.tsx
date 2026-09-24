import { Suspense } from "react";
import { and, eq, inArray } from "drizzle-orm";

import {
  InventoryReportView,
  type QtyFlowRow,
} from "@/components/inventory/inventory-report-view";
import {
  InventoryReportTabs,
  SalesReportView,
  type SalesReportOptions,
} from "@/components/pos/sales-report-view";
// ⚠️ `isSalesView` / `toInventoryReportTab` нь ЦЭВЭР модульд — «use client»
// файлаас server component функц дуудах боломжгүй (2026-09-24-ний доголдол).
import {
  isSalesView,
  toInventoryReportTab,
  type InventoryReportTab,
  type SalesView,
} from "@/lib/pos/report-views";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { db } from "@/lib/db";
import {
  counterparties,
  inventoryMovements,
  memberships,
  users,
} from "@/lib/db/schema";
import { movementEffects } from "@/lib/inventory/balances";
import { loadInventoryBase, toMovementRefs } from "@/lib/inventory/load-data";
import { buildCategoryTree } from "@/lib/inventory/category-tree";
import { loadQtyBalancesFast } from "@/lib/inventory/period-balances";
import { loadPaymentMethodViews } from "@/lib/pos/load-data";
import { loadSalesReport } from "@/lib/pos/reports";

// Огноо `start`/`end` хоёр табд НИЙТЛЭГ (deep link cookie-г дарна — CLAUDE.md
// §4); борлуулалтын шүүлтүүр wh/cashier/cp/method/item/cat, дэд таб `view`.
type SearchParams = Promise<{
  tab?: string;
  start?: string;
  end?: string;
  view?: string;
  wh?: string;
  cashier?: string;
  cp?: string;
  method?: string;
  item?: string;
  cat?: string;
}>;

const isIsoDate = (value: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");
const orNull = (value: string | undefined) => (value && value.trim() ? value : null);

export default async function InventoryReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const params = await searchParams;
  const period = await getPeriodSelection();
  const start = isIsoDate(params.start) ? params.start! : period.from;
  const end = isIsoDate(params.end) ? params.end! : period.to;
  const tab: InventoryReportTab = toInventoryReportTab(params.tab);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Бараа материалын тайлан
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Тоо хэмжээний урсгал (баталсан хөдөлгөөнөөр) ба POS борлуулалтын
          дэлгэрэнгүй — огнооны муж хоёр табд нийтлэг.
        </p>
      </div>
      <Suspense fallback={null}>
        <InventoryReportTabs value={tab} />
      </Suspense>
      {tab === "sales" ? (
        <Suspense fallback={null}>
          <SalesTab orgId={orgId} start={start} end={end} params={params} />
        </Suspense>
      ) : (
        <FlowTab orgId={orgId} start={start} end={end} />
      )}
    </div>
  );
}

// ─── Тоо хэмжээний урсгал (өмнөх хуудасны логик, өөрчлөлтгүй) ───────────────

async function FlowTab({ orgId, start, end }: { orgId: string; start: string; end: string }) {
  const [{ itemViews, warehouseViews }, movements] = await Promise.all([
    loadInventoryBase(orgId),
    db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.organizationId, orgId),
    }),
  ]);

  const refs = toMovementRefs(
    movements.filter((movement) => movement.status === "confirmed")
  );

  // Эхний үлдэгдэл (< start), тайлант үеийн орлого/зарлага (start..end).
  const opening = new Map<string, number>();
  const inQty = new Map<string, number>();
  const outQty = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, delta: number) =>
    map.set(key, Math.round(((map.get(key) ?? 0) + delta) * 10000) / 10000);

  for (const movement of refs) {
    if (movement.date > end) continue;
    for (const effect of movementEffects(movement)) {
      const key = `${effect.itemId}|${effect.warehouseId}`;
      if (movement.date < start) add(opening, key, effect.delta);
      else if (effect.delta > 0) add(inQty, key, effect.delta);
      else add(outQty, key, -effect.delta);
    }
  }

  const itemById = new Map(itemViews.map((item) => [item.id, item]));
  const warehouseById = new Map(warehouseViews.map((w) => [w.id, w]));
  const keys = new Set([...opening.keys(), ...inQty.keys(), ...outQty.keys()]);
  const rows: QtyFlowRow[] = [];
  for (const key of keys) {
    const [itemId, warehouseId] = key.split("|");
    const item = itemById.get(itemId);
    const warehouse = warehouseById.get(warehouseId);
    if (!item || !warehouse) continue;
    const openingQty = opening.get(key) ?? 0;
    const inTotal = inQty.get(key) ?? 0;
    const outTotal = outQty.get(key) ?? 0;
    rows.push({
      key,
      itemLabel: `${item.code} · ${item.name}`,
      unit: item.unit,
      warehouseName: warehouse.name,
      opening: openingQty,
      inQty: inTotal,
      outQty: outTotal,
      closing: Math.round((openingQty + inTotal - outTotal) * 10000) / 10000,
    });
  }
  rows.sort((a, b) => a.itemLabel.localeCompare(b.itemLabel));

  return <InventoryReportView rows={rows} start={start} end={end} />;
}

// ─── Борлуулалт (docs/pos §5) — зөвхөн энэ таб идэвхтэй үед ачаална ─────────

async function SalesTab({
  orgId,
  start,
  end,
  params,
}: {
  orgId: string;
  start: string;
  end: string;
  params: Awaited<SearchParams>;
}) {
  const filters = {
    warehouseId: orNull(params.wh),
    cashierUserId: orNull(params.cashier),
    counterpartyId: orNull(params.cp),
    methodId: orNull(params.method),
    itemId: orNull(params.item),
    categoryCode: orNull(params.cat),
  };
  const view: SalesView = isSalesView(params.view) ? params.view : "lines";

  const [report, { itemViews, warehouseViews, categoryViews }, cashierRows, customerRows, methods, balances] =
    await Promise.all([
      loadSalesReport(orgId, { from: start, to: end, ...filters }),
      loadInventoryBase(orgId),
      db
        .select({ id: users.id, name: users.name })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.organizationId, orgId)),
      db.query.counterparties.findMany({
        where: and(
          eq(counterparties.organizationId, orgId),
          inArray(counterparties.counterpartyType, ["customer", "both"])
        ),
        columns: { id: true, name: true, isActive: true },
        orderBy: (cp, { asc }) => [asc(cp.name)],
      }),
      loadPaymentMethodViews(orgId),
      loadQtyBalancesFast(orgId),
    ]);

  // Бараа бүрийн нийт үлдэгдэл (бүх агуулах) — "Бараагаар" табын Үлдэгдэл багана.
  const stock: Record<string, number> = {};
  for (const [key, qty] of balances) {
    const itemId = key.split("|")[0];
    stock[itemId] = Math.round(((stock[itemId] ?? 0) + qty) * 10000) / 10000;
  }

  const options: SalesReportOptions = {
    warehouses: warehouseViews
      .filter((w) => w.isActive || w.id === filters.warehouseId)
      .map((w) => ({ value: w.id, label: w.name, hint: w.code })),
    cashiers: cashierRows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => ({ value: row.id, label: row.name })),
    customers: customerRows
      .filter((cp) => cp.isActive || cp.id === filters.counterpartyId)
      .map((cp) => ({ value: cp.id, label: cp.name })),
    methods: methods
      .filter((method) => method.isActive || method.id === filters.methodId)
      .map((method) => ({ value: method.id, label: method.name, hint: method.code })),
    items: itemViews
      .filter((item) => item.isActive || item.id === filters.itemId)
      .map((item) => ({ value: item.id, label: item.name, hint: item.code })),
    // Модны дарааллаар, бүтэн замтай — эцэг сонгоход дэд ангилал ч орно.
    categories: buildCategoryTree(categoryViews)
      .filter((row) => row.node.isActive || row.node.code === filters.categoryCode)
      .map((row) => ({ value: row.node.code, label: row.pathLabel, hint: row.node.code })),
  };

  return (
    <SalesReportView
      data={report}
      start={start}
      end={end}
      view={view}
      filters={filters}
      options={options}
      stock={stock}
    />
  );
}
