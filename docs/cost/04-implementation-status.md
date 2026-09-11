# Entry Inventory Costing Module

## Implementation Status

**Document status:** Living record of what is built  
**Version:** 0.6 · 2026-09-11  
**Companion documents:** `README.md`, `01-functional-specification.md`,
`02-journal-posting-rules.md`, `03-report-specifications.md`, `CLAUDE.md`

This file records what has been implemented against the baseline, which
approved requirements are satisfied, and which open decisions remain open.
It does **not** approve anything; approvals live in the README change-control
table.

---

## 1. Prerequisite delivered outside this package

The specification's Periodic Weighted Average is undefined without period
boundaries, and the platform had no period entity. OD-002 was decided in
favour of a shared platform period system, so it was built first:

| Artifact | Purpose |
|---|---|
| `accounting_periods` table | Calendar month, `open`/`closed`, close timestamp |
| `lib/periods/period.ts` | Pure helpers: code from date, inclusive month range, navigation, writability |
| `lib/periods/guard.ts` | `assertPeriodOpen` — rejects writes into a closed period |
| `app/(dashboard)/settings/periods` | Close / reopen UI with per-month activity counts |

An unregistered month is treated as open, so an installation that never
closes anything is unaffected. Closing is blocked while draft vouchers or
draft cost entries remain in the month, because a draft cannot later be
posted into a closed period.

Posting paths guarded: GL create/post/unpost/update, cash post/reverse,
AR/AP post, FA depreciation post/reverse, costing post/reverse. Reversals
guard the **original** date, because the reversing entry is written there.

---

## 2. Approved requirements satisfied

### Costing method and calculation

| Requirement | Where |
|---|---|
| FR-PR-001 Periodic Weighted Average only (for period results) | `lib/costing/periodic.ts` |
| §5.3 formulas | `computePeriodResult` |
| FR-COST-001 Outbound Unit Cost = C2 Unit Cost | One `averageUnitCost` field feeds both; the report binds the same field to both columns |
| FR-COST-002 three meaningful unit costs | C1, Inbound and the shared Outbound/C2 unit cost are all exposed |
| FR-COST-003 quantity control | `qtyBalanced` on every result row |
| FR-COST-004 amount control | `amountBalanced`, evaluated at full precision |
| FR-COST-005 no zero-division, no invented cost | Blocking statuses with Mongolian reasons |
| AC-001 | `tests/periodic-costing.test.ts` — the specification's worked example verbatim |
| AC-002 (valuation half) | Test asserts one unit cost across three destinations |
| AC-006 header structure | `components/costing/cost-control-report.tsx` |

Scope is item × warehouse × company (OD-001). Periods chain: C2 becomes the
next period's C1. A blocked period blocks the next one, because its opening
balance is unknown — the alternative would be to invent a starting value.

### Master data

| Requirement | Where |
|---|---|
| FR-MD-CC-001/002 user-configurable Cost Components, no closed list | `cost_components` table + settings UI |
| FR-MD-CC-003 historical integrity | Deactivate only; no delete path exists |
| FR-MD-IT-001/002 Issue Types determine the debit destination | `inventory_issue_types` with a `fixed` / `item_cogs` posting profile |
| FR-MD-IT-003 mapping changes do not rewrite history | Resolved accounts are snapshotted on the cost entry at posting time |
| FR-AUD-002 configuration changes auditable | `created_by` / `updated_by` / `updated_at` on both master-data tables |
| FR-AUD-004 no deletion of referenced configuration | Only activate/deactivate; the last active issue type cannot be deactivated |
| FR-PR-005 / JPR-006 configurable accounts | `costing_account_settings`; `entryPostingAccounts` takes the roles as a parameter |

Classification fields are free text. The specification lists example
classifications but leaves the permitted list open, so an enum would have
encoded an unapproved policy.

### Ledgers and traceability

| Requirement | Where |
|---|---|
| FR-LEDGER-COST-002 period result per item/scope/period | `cost_period_results` |
| FR-LEDGER-COST-005 reproducibility | The engine returns the movement ids that formed each result |
| FR-ARCH-001 traceable chain | `journal_lines.cost_entry_id` / `inventory_movement_id`; `cost_entries` carries movement, item, warehouse, period, issue type, cost component |
| FR-ARCH-002 no GL-first costing | The engine reads the Inventory Ledger and cost entries only |
| JPR-005 historical account mapping | `cost_entries.debit_account_number` / `credit_account_number` written at posting |
| FR-ISSUE-001/002 every cost-bearing issue carries an issue type | Movement form field; the run copies it onto the cost entry; posting resolves the debit from it |

### Reports

| Report | Route | Notes |
|---|---|---|
| Inventory Cost Control (§2) | `/costing/control` | Fixed two-level headers as real column groups; totals exclude unit cost (§2.8); not-calculated and not-balanced states visible (§2.6, FR-UX-003) |
| Transaction Detail with Cost & Account (§3) | `/costing/detail` | Includes unvalued and pending rows (§3.2); journal link opens the voucher panel; totals exclude unit cost (§3.8) |
| Inventory-to-GL Reconciliation (§5) | `/costing/detail` → GL тулгалт | Subledger vs GL per account, difference shown, GL lines without a subledger reference counted separately (§5.4, §5.6) |
| Cost Component Analysis (§4) | `/costing/components` | Per item/warehouse/component amount, unit-cost impact, source and allocation document, accounts and GL status; per-item totals shown for the §4.3 control |

### Allocation and month-end costing (0.3)

| Requirement | Where |
|---|---|
| FR-ALLOC-001 selection from master data | Allocation document picks an active Cost Component |
| FR-ALLOC-002 item-level result | Each allocation line becomes a `landed_cost` cost entry on a specific receipt movement, so the amount lands on one item in one warehouse in one period |
| FR-ALLOC-003 breakdown retained | `cost_allocations` / `cost_allocation_lines` keep the total, the base, the weight used and the resulting amount |
| FR-ALLOC-004 no invented allocation base | Three bases only, chosen per document; a zero-weight base is rejected |
| FR-ALLOC-005 user-visible lineage | Component, amount, item, source document and allocation document all appear in the §4 report |
| OD-019 posting timing | `computePeriodCosting` values issues/adjustments/returns at the month average; receipts stay immediate |
| §12 posting validation | The month-end run refuses to create any entry when a scope in that month is blocked |

---

### Production costing (0.4)

| Piece | Where |
|---|---|
| Stages / pools / mapping rules master data | `production_stages`, `cost_pools`, `cost_pool_rules` + Өртгийн тохиргоо → Үйлдвэрлэл tab |
| GL collection per month | `collectGlPools` (`lib/actions/production.ts`) — posted lines keyed by (S2 cost center, main account), matched by priority-ordered rules; known-cost-center lines with no match are listed in the UI with voucher links, never dropped |
| Stage-chain engine | `lib/costing/production.ts` `computeProductionRun` — pure, 9 tests: the ER report's sales-value split, chained stages at computed unit cost, blocked propagation, manual-base validation |
| Run workspace | `/costing/production` — top-down pipeline per period (topbar anchor month); compute saves a draft, confirm creates receipt movements + draft cost entries per output and issue movements for inventory-sourced inputs |

### Procurement and landed cost (0.6)

Design: `docs/procurement/00-proposal.md`; function signatures:
`docs/procurement/01-implementation-contract.md`.

| Requirement | Where |
|---|---|
| FR-PROC-006 purchase order as the business object | `purchase_orders` / `purchase_order_lines`; `lib/actions/procurement.ts` (`createPurchaseOrder`, `updatePurchaseOrder`, `approvePurchaseOrder`, `cancelPurchaseOrder`, `deletePurchaseOrder`); approval writes no journal; `lib/procurement/constants.ts` `PO_BUSINESS_OBJECT` is the single source of the reconciliation key |
| FR-PROC-007 goods receipt document | `goods_receipts` / `goods_receipt_lines`; `createGoodsReceipt` / `confirmGoodsReceipt` / `reverseGoodsReceipt`. Confirming creates the `po_receipt` movement per line, values it as `qty × PO unit price × receipt-date rate`, writes the `receipt_capitalize` cost entry (`valuationSource: "po_receipt"`) and one posted voucher, all keyed to the order |
| FR-PROC-008 two clearing roles | `costing_account_settings.clearingAccountNumber` (inventory) + new `apClearingAccountNumber` (payable, default account 31000099 added to the standard chart). AR/AP lines of a PO-linked document are forced onto the payable role and throw otherwise; `createMovementDraftsForArApDocument` returns early for a PO-linked document so the invoice cannot duplicate the receipt |
| FR-PROC-009 purchase-order close entry | `lib/procurement/close-lines.ts` `buildPoCloseLines` — pure, tested: `Dr` inventory clearing, `Cr` payable clearing, the remainder to the configured FX loss/gain role, an impossible direction throws instead of being plugged. `closePurchaseOrder` posts it and stores `closeVoucherId`; `reopenPurchaseOrder` reverses the journal rather than deleting it |
| FR-PROC-009 close conditions | `lib/procurement/po-math.ts` `poCloseBlockers` — pure, tested: unreceived, over-received, uninvoiced, over-invoiced, order-currency amount mismatch, unallocated cost; each returns a Mongolian reason, shown on the order panel |
| FR-PROC-010 allocation, value base = (a) | `loadPoAllocationTargets` weights a target by the sum of its `receipt_capitalize` entries — the PO line total price — so earlier `landed_cost` amounts stay out of the weight; the three OD-017 bases keep `ALLOCATION_BASE_LABELS` with no pre-selected default; `createCostAllocation` takes `sourceLineId`, locks the invoice line `for update` and rejects `Σ > line amount` with `[ALLOCATION_EXCEEDS_LINE]`; `reverseCostAllocation` reverses the cost entries |
| FR-PROC-010 tax treatment | A capitalizing cost is an ordinary Cost Component line (`ar_ap_document_lines.costComponentId`); import VAT is passed as a component-less line with an explicit account, so it is never in Inbound Amount. The CHECK constraint forbids `itemId` and `costComponentId` on one line |
| FR-PROC-011 attachments | `document_attachments` (polymorphic `entityType`, base64 payload like `ai_attachments`); `POST /api/attachments`, `GET /api/attachments/[id]` with the organization check on read (no IDOR), `lib/actions/attachments.ts`, `components/attachments/attachment-list.tsx`. Supplier identification is read from `counterparties` (`contactPerson`, `bankName`, `bankAccountNo`) and not copied onto the order |
| FR-PROC-012 period-close control | `closePeriod` blocks with code `open-purchase-orders` when the month holds a confirmed receipt on an `open` order, and counts draft goods receipts with the other drafts (`lib/actions/periods.ts`); `lib/actions/month-end.ts` exposes the `procurement` checklist block and `/close` disables the close action while `openOrdersWithReceipts > 0` |
| OD-013 rate source | `lib/cash/exchange-rates.ts` `pickOfficialRate` (pure, tested) + `getOfficialRateForDate` — Bank of Mongolia official rate by date, MNT → 1, **throws** when the date has no rate so nothing is invented; the resolved rate is stored on the receipt (`exchangeRate`, `rateSource`, `rateDate`) and is user-correctable while the receipt is a draft |
| Lineage | `journal_lines` and `cost_entries` carry `businessObjectType` / `businessObjectId` at write time; `cost_entries.sourceLineId` and `cost_allocations.sourceLineId` / `purchaseOrderId` link an allocation back to the invoice line that funded it; `clearing-reconciliation.ts` reconciles both roles by object and names them by order number; the detail report labels `po_receipt` as "Хүлээн авалт (PO)" |

`po_receipt` movements are excluded from the `/costing` manual-price worklist and
from `runCosting`'s receipt-cost pass, because they are already valued at
confirmation; they also cannot be edited or deleted through the inventory
module, only reversed through the receipt that created them.

Tests: `tests/po-close-lines.test.ts`, `tests/po-math.test.ts`,
`tests/exchange-rates.test.ts` (pure) and `tests/procurement-flow.test.ts`
(database) — the §4 worked example end to end at explicit rates 3,450 / 3,470:
receipt, supplier invoice, customs and freight, all three allocation bases, the
close with its FX difference and both clearing roles at zero, and the period-close
block.

### Corrected-baseline (0.2C) conformance

The corrected package upgraded three areas. Current state against them:

| Corrected requirement | Status |
|---|---|
| Exact seven-step periodic sequence (C1 → Inbound → Goods Available → PWA → Outbound → C2 → controls), computed once per item-period | **Conforms** — `lib/costing/periodic.ts` implements exactly this order with the two control equations; the average never refreshes per transaction. Tests assert AC-001 and the control identities |
| Running Qty / Running Amount mandatory in the transaction detail report, periodic semantics, final row reconciles to C2 | **Conforms** — `lib/costing/running-balance.ts` (pure, 7 tests): per item×warehouse×period from that period's C1; receipts at actual inbound amounts, issues/average-valued inbound at the one PWA; unvalued rows/blocked periods/transfers turn Running Amount into an explicit "—" (qty keeps running). Columns in the detail report |
| Temporary/clearing flow (Dr component clearing / Cr source; Dr inventory / Cr same clearing) matched by Business Object Type + ID + Component; §6 temporary-account report mandatory | **Conforms** — a Cost Component may carry its own clearing account (`cost_components.account_number`; landed-cost postings credit it, falling back to the global clearing role); `lib/costing/clearing-reconciliation.ts` + the Клирингийн тулгалт tab reconcile per Account + Object Type + ID (+ component) with Opening + Increase − Cleared = Ending per object, objects resolved from movements / allocations / AR-AP / cash documents, and unknown-object (manual GL) residuals surfaced — never netted |

## 3. Open decisions still open

These are **not** implemented as accounting policy. Where the module had to
behave somehow, it blocks or stays neutral and makes the gap visible.

| ID | Status in code |
|---|---|
| OD-004 / OD-005 zero and negative quantity | Period stops with a visible error; nothing is valued |
| OD-006 backdated transactions | Recalculation rewrites **draft** results only; posted entries keep their historical amounts and any resulting gap appears in reconciliation |
| OD-011 late landed cost | **Closed for the procurement path in 0.6** (FR-PROC-012): a cost may not arrive after the receipt month is closed, so the period close refuses a month holding a confirmed receipt on an `open` order. An allocation inside an open month still raises that month's Inbound Amount; one dated into a closed month is still rejected by the period guard. Prior-period revaluation reached by some other path remains undecided |
| OD-012 taxes | **Closed in 0.6** (FR-PROC-010): customs duty capitalizes as an ordinary Cost Component and reaches item cost through allocation; import VAT does not capitalize and posts from a component-less invoice line straight to the configured VAT-receivable account. No other tax rule is implemented |
| OD-013 currency | **Closed for procurement in 0.6** (FR-PROC-007, FR-PROC-009): the Bank of Mongolia official rate is the base rate — inventory at the receipt-date rate, the payable at the invoice-date rate, the remaining difference realized as FX gain/loss on the order close, settlement on the existing commercial-rate cash path. A missing rate throws instead of being invented. Costing itself still stores MNT amounts only; period-end revaluation of inventory in a foreign currency is not implemented |
| OD-014 transfers | Excluded from valuation; the quantity movement still occurs |
| OD-016 manufacturing | Not implemented beyond an issue type being able to point at a production/WIP account |
| OD-018 receipt types | Not implemented |
| OD-020 dimensions | Not implemented as columns; dimensions remain inside the account segment string |

---

## 4. Known gaps against the baseline

1. ~~Running balances (§3.4)~~ — **implemented in 0.5** (2026-07-30):
   `lib/costing/running-balance.ts`, shown in the transaction detail
   report; final row reconciles to C2, unvalued rows show an explicit "—".
2. ~~Temporary Account Reconciliation (§6)~~ — **implemented in 0.5**
   (2026-07-30): `lib/costing/clearing-reconciliation.ts`, reconciles by
   Account + Business Object Type + ID (+ component); unknown-object
   residuals surface explicitly and are never netted.
3. **Export (§2.9)** relies on AG Grid's built-in CSV export; a two-level
   header export has not been verified.
4. **Authorization (§7)** follows the platform's per-user data scoping.
   The detailed permission matrix remains an open decision.
5. **Procurement phase 2** — deliberately outside version 1
   (`docs/procurement/00-proposal.md` §7): procurement reports (open
   commitments, supplier performance), prepayment / letter-of-credit links,
   receipt types (OD-018), commitment accounting, one payment across several
   orders, standard-cost variance, and a sequential `PO-YYYY-NNNN` numbering
   series. Order numbers are unique per organization but not generated from a
   sequence.
