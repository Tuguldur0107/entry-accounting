> ⚠️ **SUPERSEDED (2026)** — Энэ файл нь хуучин **Chakra UI**-д суурилсан спекийг тайлбарладаг.
> Entry Accounting нь одоо **AG Grid Community + shadcn/ui** ашигладаг. Шинэ стандартыг
> [knowledge/03-стандарт/ui-standards/2026-ag-grid/](./2026-ag-grid/) болон [CLAUDE.md](../../../CLAUDE.md#хүснэгтийн-стандарт-ag-grid-community)-аас үзнэ үү.

---

# 07. Хүснэгтийн каталог — бүх модулийн жагсаалт

> Entry-д **бүх жагсаалт нь `<StandardTable>`-ийг ашиглах ёстой** (`standards/01-tables.md` спекаар). Энэ файл нь системийн бүх 18 модулийн хүснэгтүүдийн нэгдсэн каталог — тус бүрд `storageKey`, баганын тодорхойлолт, filterable / groupable / numeric тэмдэглэгээ, default group-by, Excel экспортын нэрийг тогтоосон.
>
> Шинэ жагсаалт хуудас нэмэх үед энэ файлд бүртгэгдэх ёстой. Энд байхгүй жагсаалт `<StandardTable>`-аар хийгдээгүй гэж тооцно.

---

## 0. storageKey naming standard

```
<module>_<page>_<table>
```

| Хэсэг | Утга |
|-------|------|
| `module` | gl, ar, ap, cash, inv, fa, payroll, pos, agis, cost, mfg, tax, wallet, reports, admin, agents, approvals, audit |
| `page` | Page-ийн товч нэр (journals, invoices, txns) |
| `table` | Тухайн дэлгэц дотор нэгээс олон table байвал ялгах суффикс (main, summary, detail) |

> Бүх storageKey **уникаль** байх ёстой — codebase-аар grep шалгах. Module table-ийн localStorage entry хоёрхон key хариуцна: `<storageKey>_col_widths`, `<storageKey>_col_visible`.

---

## 1. GL (General Ledger) — `/modules/gl/`

### 1.1 Journal жагсаалт — `/modules/gl/journals`
- **storageKey:** `gl_journals_main`
- **Колонкууд:**

| key | label | isNumeric | filterable | groupable |
|-----|-------|:---------:|:----------:|:---------:|
| `#` | # |  |  |  |
| `journal_num` | Журнал # |  | ✓ |  |
| `journal_date` | Огноо |  | ✓ |  |
| `module` | Модуль |  | ✓ | ✓ |
| `adjustment_type` | Adjustment |  | ✓ | ✓ |
| `description` | Тайлбар |  | ✓ |  |
| `total_dr` | Дебит | ✓ |  |  |
| `total_cr` | Кредит | ✓ |  |  |
| `period` | Период |  | ✓ | ✓ |
| `status` | Статус |  | ✓ | ✓ |

- **defaultGroupBy:** `period`
- **Excel:** `gl-journals`
- **Custom render:** `module` (badge), `status` (`<StatusBadge>`), `journal_num` (link → §9.5)
- **getRowBg:** `is_reversed === true ? 'red.50' : undefined`

### 1.2 Chart of Accounts (COA) — `/modules/gl/chart_of_accounts`
- **storageKey:** `gl_coa_main`
- **Колонкууд:** `account_code` (10-сегмент дэлгэрсэн), `name`, `account_type` (groupable), `is_active`, `parent_code`, `level` (numeric)
- **defaultGroupBy:** `account_type`
- **Custom render:** `account_code` (mono), `is_active` (toggle badge)
- **Tree view alternative:** `<StandardTable>`-ийн доор tree view toggle (V1.07)

### 1.3 GL Periods — `/modules/gl/periods`
- **storageKey:** `gl_periods_main`
- **Колонкууд:** `period_year` (groupable), `period_num`, `period_name`, `start_date`, `end_date`, `status` (groupable, badge), `closed_at`, `closed_by`

### 1.4 Provisions — `/modules/gl/provisions`
- **storageKey:** `gl_provisions_main`
- **Колонкууд:** `provision_num`, `category` (groupable), `created_date`, `expected_date`, `amount` (numeric), `status` (groupable)

---

## 2. AR (Accounts Receivable) — `/modules/receivables/`

### 2.1 Invoice list — `/modules/receivables/InvoiceList`
- **storageKey:** `ar_invoices_main`
- **Колонкууд:**

| key | label | isNumeric | filterable | groupable |
|-----|-------|:---------:|:----------:|:---------:|
| `invoice_num` | Нэхэмжлэл # |  | ✓ |  |
| `invoice_date` | Огноо |  | ✓ |  |
| `customer_name` | Харилцагч |  | ✓ | ✓ |
| `total_amount` | Дүн (валют) | ✓ |  |  |
| `total_mnt` | Дүн (MNT) | ✓ |  |  |
| `paid_amount` | Төлсөн | ✓ |  |  |
| `balance` | Үлдэгдэл | ✓ |  |  |
| `currency` | Валют |  | ✓ | ✓ |
| `status` | Статус |  | ✓ | ✓ |

- **defaultGroupBy:** `customer_name`
- **Excel:** `ar-invoices`
- **getRowBg:** Хугацаа хэтэрсэн бол `red.50` (light) / `red.900` (dark)
- **Custom render:** `balance` (overdue улаан текст), `status` (badge)

### 2.2 Customer master — `/modules/receivables/customerList`
- **storageKey:** `ar_customers_main`
- **Колонкууд:** `customer_code`, `name`, `cardId` (мэдэгдэл), `segment` (groupable), `credit_limit` (numeric), `outstanding` (numeric), `is_active` (groupable), `created_at`

### 2.3 Revenue ledger — `/modules/receivables/revenue`
- **storageKey:** `ar_revenue_main`
- **Колонкууд:** `account_code` (51xxxxxx, groupable), `period` (groupable), `customer`, `invoice_num`, `amount` (numeric), `currency`

### 2.4 Reports tabs — `/modules/receivables/reports`
- **storageKey:** `ar_reports_<tab>` (tab бүр тусдаа: `issued`, `payments`, `balance`, `aging`)
- Бүгд `<StandardTable>`-аар. Aging-д `bucket` багана groupable.

---

## 3. AP (Accounts Payable) — `/modules/ap/`

### 3.1 Bill list — `/modules/ap/InvoiceList`
- **storageKey:** `ap_invoices_main`
- **Колонкууд:** `invoice_num`, `invoice_date`, `supplier_name` (groupable), `total_amount` (numeric), `wht_amount` (numeric), `net_payable` (numeric), `is_landed_cost` (groupable), `currency` (groupable), `status` (groupable)
- **defaultGroupBy:** `supplier_name`
- **Excel:** `ap-bills`

### 3.2 Supplier master — `/modules/ap/supplierList`
- **storageKey:** `ap_suppliers_main`
- **Колонкууд:** `supplier_code`, `name`, `cardId`, `payment_terms` (groupable), `tax_registration`, `outstanding` (numeric), `is_active`

### 3.3 Reports tabs — `/modules/ap/reports`
- **storageKey:** `ap_reports_<tab>` (issued / payments / balance / wht)

---

## 4. Cash — `/modules/Cash/`

### 4.1 Transaction list — `/modules/Cash/transactions`
- **storageKey:** `cash_txns_main`
- **Колонкууд:** `txn_num`, `txn_date`, `txn_type` (groupable, badge), `bank_account_code` (groupable), `amount` (numeric, signed), `mnt_eq` (numeric), `counterparty_name`, `recon_status` (groupable), `currency` (groupable), `posting_status` (groupable)
- **defaultGroupBy:** `bank_account_code`
- **Excel:** `cash-transactions`
- **Custom render:** `txn_type` (icon + label), `recon_status` (dot indicator)

### 4.2 Reconciliation panes — `/modules/Cash/reconciliation`
- **2 хүснэгт зэрэг:** Statement lines (зүүн) ба System txns (баруун)
- **storageKey:** `cash_recon_stmt`, `cash_recon_sys`
- **Колонкууд:** `date`, `description`, `amount` (numeric), `match_status` (groupable)

### 4.3 Reports tabs — `/modules/Cash/reports`
- **storageKey:** `cash_reports_<tab>` (transactions / balances / cash-flow-direct / cash-flow-indirect)

---

## 5. Inventory — `/modules/inv/`

### 5.1 On-hand — `/modules/inv/on-hand`
- **storageKey:** `inv_onhand_main`
- **Колонкууд:**

| key | label | isNumeric | filterable | groupable |
|-----|-------|:---------:|:----------:|:---------:|
| `item_code` | Item code |  | ✓ |  |
| `item_name` | Item нэр |  | ✓ |  |
| `category` | Категори |  | ✓ | ✓ |
| `warehouse_code` | Агуулах |  | ✓ | ✓ |
| `qty` | Бэлэн (qty) | ✓ |  |  |
| `unit` | Нэгж |  | ✓ | ✓ |
| `reorder_point` | Reorder point | ✓ |  |  |
| `last_moved` | Сүүлд хөдөлсөн |  | ✓ |  |

- **defaultGroupBy:** `warehouse_code`
- **Excel:** `inv-onhand`
- **getRowBg:** `qty < reorder_point` бол `orange.50`

### 5.2 Inventory transactions — `/modules/inv/transaction`
- **storageKey:** `inv_txns_main`
- **Колонкууд:** `txn_num`, `txn_date`, `txn_type` (groupable, color badge), `source_module` (groupable), `warehouse_code` (groupable), `lines_count` (numeric), `total_qty` (numeric), `status` (groupable)
- **defaultGroupBy:** `txn_type`
- **Excel:** `inv-transactions`

### 5.3 Stock card (drill-down panel) — `/modules/inv/on-hand` side panel
- **storageKey:** `inv_stockcard_<itemId>`
- **Колонкууд:** `txn_date`, `txn_type`, `qty_change` (numeric, signed), `running_balance` (numeric), `warehouse_code`

### 5.4 Transfer list — `/modules/inv/transfer`
- **storageKey:** `inv_transfers_main`
- **Колонкууд:** `transfer_num`, `from_warehouse` (groupable), `to_warehouse` (groupable), `txn_date`, `lines_count` (numeric), `status`

### 5.5 Counting list — `/modules/inv/counting`
- **storageKey:** `inv_counts_main`
- **Колонкууд:** `count_num`, `warehouse_code` (groupable), `count_date`, `lines_count` (numeric), `variance_qty` (numeric), `variance_value` (numeric), `status` (groupable)

### 5.6 BOM list — `/modules/inv/bom`
- **storageKey:** `inv_bom_main`
- **Колонкууд:** `template_code`, `product_code`, `version`, `batch_size` (numeric), `yield_pct` (numeric), `is_active` (groupable)

### 5.7 Production orders — `/modules/inv/production`
- **storageKey:** `inv_prodorders_main`
- **Колонкууд:** `order_num`, `product_code`, `qty_planned` (numeric), `qty_completed` (numeric), `cost_center` (groupable), `status` (groupable, kanban view alternative)

### 5.8 Reports tabs — `/modules/inv/report`
- **storageKey:** `inv_reports_<tab>` (onhand / movement / slow-moving / reorder / stock-card)

### 5.9 Settings tabs — `/modules/inv/settings/<tab>`
- **storageKey:** `inv_settings_<tab>` (item / branch / category / gs1 / rfid)

---

## 6. Fixed Assets — `/modules/fa/`

### 6.1 Asset register — `/modules/fa/assets`
- **storageKey:** `fa_assets_main`
- **Колонкууд:** `asset_code`, `name`, `category` (groupable), `acquisition_date`, `acquisition_cost` (numeric), `accumulated_depreciation` (numeric), `nbv` (numeric), `status` (groupable), `location` (groupable)
- **defaultGroupBy:** `category`
- **Excel:** `fa-register`

### 6.2 FA transactions — `/modules/fa/transactions`
- **storageKey:** `fa_txns_main`
- **Колонкууд:** `txn_num`, `txn_date`, `txn_type` (groupable: acquisition/disposal/impair/reval/hfs), `asset_code`, `amount` (numeric), `status`

### 6.3 Depreciation schedule — `/modules/fa/depreciation`
- **storageKey:** `fa_dep_main`
- **Колонкууд:** `period` (groupable), `asset_code`, `category` (groupable), `depreciation_amount` (numeric), `accumulated_depreciation` (numeric), `nbv` (numeric), `status`

### 6.4 Lease contracts — `/modules/fa/lease`
- **storageKey:** `fa_lease_main`
- **Колонкууд:** `contract_num`, `lessor`, `start_date`, `end_date`, `monthly_payment` (numeric), `interest_rate` (numeric), `rou_balance` (numeric), `lease_liability` (numeric), `status` (groupable)

### 6.5 Reports tabs — `/modules/fa/reports`
- **storageKey:** `fa_reports_<tab>` (register / depreciation / tax-dep / fair-value / impairment / hfs)

---

## 7. Payroll — `/modules/payroll/`

### 7.1 Employee list — `/modules/payroll/employees`
- **storageKey:** `payroll_emps_main`
- **Колонкууд:** `employee_code`, `name`, `department` (groupable), `position`, `hire_date`, `salary_type` (groupable), `gross_salary` (numeric), `is_active` (groupable)
- **defaultGroupBy:** `department`
- **Excel:** `payroll-employees`

### 7.2 Run list — `/modules/payroll/runs`
- **storageKey:** `payroll_runs_main`
- **Колонкууд:** `run_num`, `period`, `period_year` (groupable), `employee_count` (numeric), `total_gross` (numeric), `total_net` (numeric), `total_si_emp` (numeric), `total_pit` (numeric), `status` (groupable)
- **defaultGroupBy:** `period_year`

### 7.3 Run bulk grid (inline edit) — `/modules/payroll/runs/view/[id]`
- **storageKey:** `payroll_run_grid_<runId>`
- **editableCols:** `gross_override`, `bonus`, `deduction`, `notes`
- **Колонкууд:** `employee_code`, `name`, `dept`, `gross_salary` (numeric), `bonus` (numeric, edit), `gross_override` (numeric, edit), `si_emp` (numeric), `si_employer` (numeric), `pit` (numeric), `net_salary` (numeric), `notes` (edit)
- **selectionMode:** `cell` (V1.07-д)

### 7.4 Reports tabs — `/modules/payroll/reports`
- **storageKey:** `payroll_reports_<tab>` (payslip / summary / annual / department / disbursement)

---

## 8. POS — `/modules/pos/`

### 8.1 Sales list — `/modules/pos/sales`
- **storageKey:** `pos_sales_main`
- **Колонкууд:** `sale_num`, `sale_datetime`, `cashier_name` (groupable), `payment_method` (groupable), `customer_name`, `total_amount` (numeric), `vat_amount` (numeric), `ebarimt_status` (groupable), `is_refund` (groupable)
- **defaultGroupBy:** `cashier_name`
- **Excel:** `pos-sales`

### 8.2 On-hand (cashier view) — `/modules/pos/on-hand`
- **storageKey:** `pos_onhand_main`
- Inv 5.1-той ижил спек, read-only.

---

## 9. AGIS (Intercompany) — `/modules/agis/`

### 9.1 Transaction list — `/modules/agis/transactions`
- **storageKey:** `agis_txns_main`
- **Колонкууд:** `txn_num`, `txn_date`, `from_company` (groupable), `to_company` (groupable), `txn_type` (groupable), `amount` (numeric), `currency` (groupable), `status` (groupable)
- **defaultGroupBy:** `from_company`

### 9.2 Reconciliation matrix — `/modules/agis/reconciliation`
- **2D grid** — `<StandardTable>`-аас өөрөөр зурна (row = company A, col = company B). Excel pivot шиг.
- **storageKey:** `agis_recon_matrix`

---

## 10. Cost — `/modules/cost/`

> Cost модулийн end-to-end pipeline: **Inv хөдөлгөөн татах → өртөг тооцоолох → харах/шалгах → GL журнал бичих**. Бүх дөрвөн шатанд тусдаа `<StandardTable>` хүснэгт байна. Дэлгэрэнгүй: `02-modules/10-cost.md` §0.

### 10.1 Allocations list — `/modules/cost/allocations`
- **storageKey:** `cost_alloc_main`
- **Колонкууд:** `alloc_num`, `period`, `from_center` (groupable), `to_center` (groupable), `driver`, `amount` (numeric), `status` (groupable)

### 10.2 Cost centers tree — `/modules/cost/centers`
- **storageKey:** `cost_centers_main`
- Tree view + flat table toggle. **Колонкууд:** `code`, `name`, `parent_code`, `level` (numeric), `is_active`

### 10.3 Drivers — `/modules/cost/drivers`
- **storageKey:** `cost_drivers_main`
- **Колонкууд:** `driver_code`, `name`, `unit`, `period` (groupable), `value` (numeric)

### 10.4 Allocation rules — `/modules/cost/rules`
- **storageKey:** `cost_rules_main`
- **Колонкууд:** `rule_code`, `name`, `from_center`, `to_centers_count` (numeric), `driver`, `is_recurring` (groupable), `is_active`

### 10.5 Reports tabs — `/modules/cost/reports`
- **storageKey:** `cost_reports_<tab>` (center-spend / budget-variance / cogm / cascade-trace)

---

### 10.6 [INTAKE] Inv хөдөлгөөний intake — `/modules/cost/intake` (V1.07)

Inventory module-аас орж ирсэн event-уудын **read-only жагсаалт**. Listener энэ хүснэгтэд journal бичсэн / бичээгүй / алдсан төлөвийг харуулна.

- **storageKey:** `cost_intake_main`
- **Колонкууд:**

| key | label | isNumeric | filterable | groupable |
|-----|-------|:---------:|:----------:|:---------:|
| `event_id` | Event # |  | ✓ |  |
| `event_type` | Төрөл (txn.confirmed/transfer/counting/sale/mfg) |  | ✓ | ✓ |
| `inv_txn_num` | Эх Inv гүйлгээ # |  | ✓ |  |
| `inv_txn_type` | Inv төрөл |  | ✓ | ✓ |
| `warehouse_code` | Агуулах |  | ✓ | ✓ |
| `qty_total` | Нийт qty | ✓ |  |  |
| `received_at` | Хүлээн авсан |  | ✓ |  |
| `processed_at` | Боловсруулсан |  | ✓ |  |
| `lag_sec` | Lag (сек) | ✓ |  |  |
| `cost_status` | Cost status (pending/posted/failed/skipped) |  | ✓ | ✓ |
| `journal_id` | GL Journal # |  | ✓ |  |

- **defaultGroupBy:** `event_type`
- **Excel:** `cost-intake`
- **getRowBg:** `cost_status === 'failed'` бол `red.50`; `lag_sec > 60` бол `orange.50`
- **Custom render:** `cost_status` (badge), `inv_txn_num` (link → Inv §9.6 view), `journal_id` (link → GL §9.5 view)

### 10.7 [CALCULATE] Item cost setup — `/modules/cost/item-setup` (V1.07)
- **storageKey:** `cost_item_setup_main`
- **Колонкууд:** `item_code`, `item_name`, `cost_method` (groupable: avg/FIFO/standard), `gl_inventory_account`, `gl_cogs_account`, `standard_cost` (numeric), `last_updated`, `is_active` (groupable)
- **defaultGroupBy:** `cost_method`
- **Excel:** `cost-item-setup`

### 10.8 [CALCULATE] Inv valuation snapshot — `/modules/cost/inv-valuation` (V1.07)

Хадгалагдсан `cost_on_hand_value` хүснэгтийн browser. Бараа материалын **үнийн дүнг** (qty биш) харуулдаг гол дэлгэц.

- **storageKey:** `cost_valuation_main`
- **Колонкууд:**

| key | label | isNumeric | filterable | groupable |
|-----|-------|:---------:|:----------:|:---------:|
| `item_code` | Item code |  | ✓ |  |
| `item_name` | Item нэр |  | ✓ |  |
| `category` | Категори |  | ✓ | ✓ |
| `warehouse_code` | Агуулах |  | ✓ | ✓ |
| `cost_method` | Method (avg/FIFO/std) |  | ✓ | ✓ |
| `qty` | Бэлэн qty | ✓ |  |  |
| `avg_cost` | Дундаж өртөг | ✓ |  |  |
| `total_value` | Нийт үнэ | ✓ |  |  |
| `last_movement` | Сүүлд хөдөлсөн |  | ✓ |  |
| `nrv_per_unit` | NRV/нэгж | ✓ |  |  |
| `nrv_diff` | NRV зөрүү | ✓ |  |  |

- **defaultGroupBy:** `warehouse_code`
- **Excel:** `cost-valuation`
- **getRowBg:** `nrv_diff < 0` бол `red.50` (NRV write-down шаардлагатай)
- **Footer total:** `qty`, `total_value` бүхэнд Σ.

### 10.9 [CALCULATE] FIFO layers viewer — `/modules/cost/layers` (V1.07)

FIFO method-той item-ийн layered cost stack. Audit-д ашиглана.

- **storageKey:** `cost_layers_main`
- **Колонкууд:** `item_code` (groupable), `warehouse_code` (groupable), `layer_id`, `received_at`, `qty_received` (numeric), `qty_remaining` (numeric), `unit_cost` (numeric), `extended_value` (numeric), `inv_txn_num` (source receipt)
- **defaultGroupBy:** `item_code`
- **Excel:** `cost-fifo-layers`

### 10.10 [INSPECT] Cost postings list — `/modules/cost/postings` (V1.07)

Cost engine үүсгэсэн **GL журналын жагсаалт**. Inv гүйлгээ ↔ Journal entry-ийн pivotal link table.

- **storageKey:** `cost_postings_main`
- **Колонкууд:**

| key | label | isNumeric | filterable | groupable |
|-----|-------|:---------:|:----------:|:---------:|
| `posting_id` | Posting # |  | ✓ |  |
| `posted_at` | Огноо |  | ✓ |  |
| `posting_type` | Төрөл (receipt/issue/transfer/variance/landed/nrv) |  | ✓ | ✓ |
| `inv_txn_num` | Эх Inv гүйлгээ # |  | ✓ |  |
| `journal_num` | GL Journal # |  | ✓ |  |
| `warehouse_code` | Агуулах |  | ✓ | ✓ |
| `item_code` | Item |  | ✓ | ✓ |
| `qty` | Qty | ✓ |  |  |
| `total_dr` | Дебит | ✓ |  |  |
| `total_cr` | Кредит | ✓ |  |  |
| `period` | Период |  | ✓ | ✓ |
| `posted_by` | Бичсэн хүн |  | ✓ | ✓ |
| `is_reversed` | Reverse-эсэн |  | ✓ | ✓ |

- **defaultGroupBy:** `posting_type`
- **Excel:** `cost-postings`
- **getRowBg:** `is_reversed` бол `gray.100` (light) / `whiteAlpha.200` (dark)
- **Custom render:** `journal_num` (link → GL §9.5), `inv_txn_num` (link → Inv §9.6), `posting_type` (badge)
- **Хэзээ ашиглах:** Cost flow-ийн "INSPECT" шат — өртгийн нягтлан болон аудитор гол дэлгэц

### 10.11 [INSPECT] Cost-Inv reconciliation — `/modules/cost/reconciliation` (V1.07)

Inventory-ийн **qty × avg_cost** vs GL `14000001 Inventory` дансны **balance**-ийг warehouse-аар жиш. Period close-ын өмнөх ёс журам.

- **storageKey:** `cost_recon_main`
- **Колонкууд:** `warehouse_code` (groupable), `category` (groupable), `inv_qty` (numeric), `inv_value_calc` (numeric, `qty × avg_cost`), `gl_inventory_balance` (numeric), `variance` (numeric), `variance_pct` (numeric), `last_recon_at`, `status` (groupable: matched/variance/critical)
- **defaultGroupBy:** `warehouse_code`
- **getRowBg:** `Math.abs(variance_pct) > 1` бол `red.50` (>1% зөрүү шалгах)

### 10.12 [INSPECT] NRV check candidates — `/modules/cost/nrv` (V1.07)

NRV write-down шаардлагатай item-ийн scan list. Хэрэглэгч approve хийсэн л үед journal үүснэ.

- **storageKey:** `cost_nrv_main`
- **Колонкууд:** `item_code`, `item_name`, `warehouse_code` (groupable), `qty` (numeric), `avg_cost` (numeric), `selling_price` (numeric), `nrv_per_unit` (numeric), `writedown_value` (numeric, `qty × MAX(0, avg_cost - nrv)`), `last_sold_date`, `slow_moving_days` (numeric), `proposed_journal` (link)
- **defaultGroupBy:** `warehouse_code`
- **selectable:** ✓ — Bulk approve

### 10.13 [INTAKE / OPS] Event queue health — `/modules/cost/events` (V1.07)

`inv_event_outbox`-ийн observability. Listener-ийн ажиллах байдлыг хянах.

- **storageKey:** `cost_events_main`
- **Колонкууд:** `event_id`, `event_type` (groupable), `created_at`, `processed_at`, `lag_sec` (numeric), `status` (groupable: pending/processing/done/dead-letter), `retry_count` (numeric), `last_error`
- **defaultGroupBy:** `status`
- **getRowBg:** `status === 'dead-letter'` бол `red.100`; `lag_sec > 60` бол `orange.50`

---

### 10.14 Cost flow tables — нэгдсэн харагдац

| Шат | Дэлгэц | Хүснэгт (storageKey) | Зорилго |
|-----|--------|----------------------|---------|
| 1. **INTAKE** | §10.6 Intake | `cost_intake_main` | Inv-аас ирсэн event-ыг бүртгэх |
| 1. INTAKE / Ops | §10.13 Event queue | `cost_events_main` | Outbox observability |
| 2. **CALCULATE** | §10.7 Item setup | `cost_item_setup_main` | cost_method config |
| 2. CALCULATE | §10.8 Valuation snapshot | `cost_valuation_main` | qty × avg_cost dynamic view |
| 2. CALCULATE | §10.9 FIFO layers | `cost_layers_main` | Layered stack history |
| 3. **INSPECT** | §10.10 Cost postings | `cost_postings_main` | Inv ↔ GL journal link |
| 3. INSPECT | §10.11 Recon | `cost_recon_main` | Inv qty×avg vs GL balance |
| 3. INSPECT | §10.12 NRV check | `cost_nrv_main` | Write-down candidate scan |
| 4. **POST** | (GL §9.5) | (Cost-аас бичигдсэн) `journal_entries` | `module='Cost'` source-аар filter |

> **Гол санал:** Cost модулийн UI бол "GL дансны баланс хаанаас гарсан вэ?"-ийг **бараа материалын хөдөлгөөн хүртэл буцаан тайлбарлах** ил тод pipeline. §10.6 → §10.10 → GL §9.5 source link замаар хэрэглэгч full traceability авна.

---

## 11. Manufacturing (Inv module дотор) — `/modules/inv/bom`, `/modules/inv/production`

### 11.1 BOM templates — see §5.6
### 11.2 Production orders — see §5.7
### 11.3 Order detail tabs (modal w/ tabs)
- **storageKey:** `mfg_order_<tab>_<orderId>` (components / outputs / charges / scrap)
- Тус бүрд жижиг grid, inline-edit V1.07-д.

---

## 12. Tax (V1.07-д төлөвлөгдсөн) — `/modules/tax/`

### 12.1 VAT filings list — `/modules/tax/vat`
- **storageKey:** `tax_vat_main`
- **Колонкууд:** `period` (groupable), `total_output` (numeric), `total_input` (numeric), `payable` (numeric), `status` (groupable), `filed_at`

### 12.2 CIT list — `/modules/tax/cit`
- **storageKey:** `tax_cit_main`
- **Колонкууд:** `period`, `quarter` (groupable), `book_pnl` (numeric), `tax_pnl` (numeric), `cit_amount` (numeric), `status`

### 12.3 WHT summary — `/modules/tax/wht`
- **storageKey:** `tax_wht_main`
- **Колонкууд:** `period` (groupable), `supplier_name`, `gross_amount` (numeric), `wht_rate` (numeric), `wht_amount` (numeric), `certificate_status`

### 12.4 eBarimt console — `/modules/tax/ebarimt`
- **storageKey:** `tax_ebarimt_<tab>` (status / retry-queue / reconciliation)

---

## 13. Wallet — `/modules/wallet/`

### 13.1 Top-ups — `/modules/wallet/topups`
- **storageKey:** `wallet_topups_main`
- **Колонкууд:** `topup_num`, `requested_at`, `level` (groupable), `amount` (numeric), `granted_by`, `status` (groupable)

### 13.2 Transactions ledger — `/modules/wallet/transactions`
- **storageKey:** `wallet_txns_main`
- **Колонкууд:** `txn_num`, `txn_date`, `type` (groupable), `level` (groupable), `amount` (numeric), `running_balance` (numeric), `reference`

---

## 14. Reports — `/modules/reports/`

### 14.1 Trial Balance — `/modules/reports/trial-balance`
- **storageKey:** `rep_tb_main`
- **Колонкууд:** `account_code`, `account_name`, `account_type` (groupable), `opening_balance` (numeric), `period_dr` (numeric), `period_cr` (numeric), `closing_balance` (numeric)
- **defaultGroupBy:** `account_type`

### 14.2 Balance Sheet — `/modules/reports/balance-sheet`
- **storageKey:** `rep_bs_main`
- Hierarchy view (asset/liability/equity 3 түвшин). **Колонкууд:** `caption`, `note_ref`, `current_period` (numeric), `prior_period` (numeric), `change_pct` (numeric)

### 14.3 Income Statement — `/modules/reports/income-statement`
- **storageKey:** `rep_is_main`
- **Колонкууд:** `caption`, `note_ref`, `current_period` (numeric), `prior_period` (numeric), `change_pct` (numeric)

### 14.4 General Ledger detail — `/modules/reports/general-ledger`
- **storageKey:** `rep_gl_main`
- **Колонкууд:** `journal_date`, `journal_num`, `description`, `account_code` (groupable), `debit` (numeric), `credit` (numeric), `running_balance` (numeric)
- **defaultGroupBy:** `account_code`

### 14.5 Consolidation — `/modules/reports/consolidation`
- **storageKey:** `rep_consol_main`
- 3-step builder; final хүснэгт нь BS/IS-той ижил формат.

### 14.6 Equity Method — `/modules/reports/equity-method`
- **storageKey:** `rep_equity_main`
- **Колонкууд:** `investment_code`, `investee_name`, `ownership_pct` (numeric), `cost` (numeric), `share_of_profit` (numeric), `dividends_received` (numeric), `carrying_amount` (numeric)

### 14.7 (V1.07) Cash Flow Statement — `/modules/reports/cash-flow`
- **storageKey:** `rep_cf_main`
- IAS 7 Direct + Indirect mode toggle.

---

## 15. Admin — `/admin/`

### 15.1 Tenants list — `/admin/tenants` (Superadmin)
- **storageKey:** `admin_tenants_main`
- **Колонкууд:** `name`, `code`, `business_type` (groupable), `plan` (groupable), `companies_count` (numeric), `users_count` (numeric), `is_active` (groupable), `created_at`

### 15.2 Companies — `/admin/companies`
- **storageKey:** `admin_companies_main`
- **Колонкууд:** `code`, `name`, `business_type` (groupable), `tenant_name` (groupable), `users_count` (numeric), `is_active`

### 15.3 Users — `/admin/users`
- **storageKey:** `admin_users_main`
- **Колонкууд:** `username`, `email`, `full_name`, `role` (groupable), `last_login`, `is_active` (groupable)

### 15.4 Permissions matrix — `/admin/permissions`
- **2D grid** (user × module × CRUD) — `<StandardTable>` нь user мөр, багана нь module:action.
- **storageKey:** `admin_perm_matrix`

### 15.5 Errors — `/admin/errors`
- **storageKey:** `admin_errors_main`
- **Колонкууд:** `created_at`, `user_name`, `path`, `error_type` (groupable), `message`, `count` (numeric)

### 15.6 Knowledge — `/admin/knowledge`
- **storageKey:** `admin_kb_main`
- **Колонкууд:** `doc_id`, `title`, `category` (groupable), `embedding_status` (groupable), `chunk_count` (numeric), `last_indexed`

---

## 16. Agents — `/modules/agents/`

### 16.1 Active agents grid — `/modules/agents/dashboard`
- **storageKey:** `agents_active_main`
- Card grid — но cards нь `<StandardTable>`-ийн альтернатив (24-agent registry).

### 16.2 Activity feed (V1.07) — `/modules/agents/activity`
- **storageKey:** `agents_activity_main`
- **Колонкууд:** `called_at`, `agent_name` (groupable), `user_name`, `tools_used` (numeric), `tokens_in` (numeric), `tokens_out` (numeric), `cost_mnt` (numeric), `latency_ms` (numeric), `status` (groupable)

### 16.3 Proposals queue (V1.07) — `/modules/agents/proposals`
- **storageKey:** `agents_proposals_main`
- **Колонкууд:** `proposed_at`, `agent_name`, `entity_type` (groupable), `summary`, `status` (groupable), `approver`

---

## 17. Approvals (V1.07) — `/modules/approvals/`

### 17.1 Inbox — `/modules/approvals`
- **storageKey:** `approvals_inbox_main`
- **Колонкууд:** `requested_at`, `module` (groupable), `entity_type` (groupable), `summary`, `requested_by`, `next_approver`, `days_waiting` (numeric), `status` (groupable)

### 17.2 History — `/modules/approvals/history`
- **storageKey:** `approvals_history_main`
- **Колонкууд:** `decided_at`, `module` (groupable), `entity_summary`, `requested_by`, `decided_by`, `decision` (groupable), `comment`

---

## 18. Audit (V1.07) — `/admin/audit/`

### 18.1 Audit logs — `/admin/audit`
- **storageKey:** `audit_logs_main`
- **Колонкууд:** `created_at`, `user_name` (groupable), `method` (groupable, color badge), `path`, `status_code` (groupable), `entity_type` (groupable), `ip_address`, `tags` (groupable), `latency_ms` (numeric)
- **defaultGroupBy:** `user_name`
- **Excel:** `audit-logs`
- **Saved filter presets:** localStorage `audit_logs_filters_<presetName>`

### 18.2 Entity timeline — `/admin/audit/entity/:type/:id`
- **storageKey:** `audit_entity_<type>_<id>` (динамик)
- **Колонкууд:** `created_at`, `user_name`, `action` (groupable), `field`, `old_value`, `new_value`

### 18.3 User activity — `/admin/audit/user/:userId`
- **storageKey:** `audit_user_<userId>`
- Heatmap + table combo.

---

## 19. Багажилтын summary

| Module | Хүснэгтийн тоо | Notes |
|--------|:---------:|-------|
| GL | 4 | Journal/COA/Periods/Provisions |
| AR | 4+ | Invoice/Customer/Revenue/Reports tabs |
| AP | 3+ | Bill/Supplier/Reports tabs |
| Cash | 4+ | Txn/Recon (×2)/Reports tabs |
| Inventory | 9+ | On-hand/Stock card/Txn/Transfer/Counting/BOM/Production/Reports/Settings |
| FA | 5+ | Register/Txn/Depreciation/Lease/Reports |
| Payroll | 4+ | Employee/Run list/Run grid/Reports |
| POS | 2 | Sales/On-hand |
| AGIS | 2 | Txn/Recon matrix |
| Cost | 5+ | Alloc/Centers/Drivers/Rules/Reports (+8 V1.07) |
| Mfg | 3+ | BOM/Prod orders/Order tabs |
| Tax | 4 | VAT/CIT/WHT/eBarimt (V1.07) |
| Wallet | 2 | Top-ups/Txns |
| Reports | 6+ | TB/BS/IS/GL/Consol/Equity (+CF V1.07) |
| Admin | 6 | Tenants/Companies/Users/Perm matrix/Errors/Knowledge |
| Agents | 3 | Active/Activity/Proposals (+V1.07) |
| Approvals | 2 | Inbox/History (V1.07) |
| Audit | 3+ | Logs/Entity/User (V1.07) |
| **Нийт** | **70+** | – |

---

## 20. Шалгалт

- [ ] Бүх жагсаалт хуудас `<StandardTable>`-ийг ашигласан (raw `<Table>` ашиглаагүй).
- [ ] Бүх `storageKey` уникаль, naming standard дагасан.
- [ ] Numeric багана `isNumeric: true` тэмдэглэсэн (баруун align + sum).
- [ ] Filterable / groupable багана зорилгын дагуу зөв тэмдэглэгдсэн.
- [ ] `defaultGroupBy` хэрэглэгчийн ердийн зорилгод тохирсон (e.g. customer-by, period-by).
- [ ] Excel export `excelColumns + excelFilename`-той.
- [ ] Custom render (badge, link, mono) `renderCell`-аар хийгдсэн.
- [ ] Каталог-д бүртгэлгүй хүснэгт алга — энэ файл authoritative source.
