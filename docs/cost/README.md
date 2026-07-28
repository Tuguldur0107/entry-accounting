# Entry Accounting System — Inventory Costing Documentation Package

**Package status:** Implementation baseline with explicit open decisions  
**Decision authority:** Product owner  
**Audience:** Claude Code, Entry developers, accounting reviewers, QA  
**Normative language:** `MUST`, `MUST NOT`, `SHOULD`, and `MAY`

This package defines the approved baseline for Entry's inventory costing module.
It deliberately separates approved accounting decisions from unresolved items.
Claude Code must not infer, invent, or silently implement an accounting rule
listed as an open decision.

## Read order

1. [01-functional-specification.md](01-functional-specification.md)
2. [02-journal-posting-rules.md](02-journal-posting-rules.md)
3. [03-report-specifications.md](03-report-specifications.md)
4. [04-implementation-status.md](04-implementation-status.md)
5. [CLAUDE.md](CLAUDE.md)

## Approved decisions captured by this package

1. Version 1 uses **Periodic Weighted Average only**.
2. The Inventory Cost Control Report has these fixed column groups:
   `#`, `Item Code`, `Item Description`, `C1`, `Inbound`, `Outbound`, `C2`.
3. Each of `C1`, `Inbound`, `Outbound`, and `C2` has the subheaders:
   `Qty`, `Unit Cost`, `Amount`.
4. Under Periodic Weighted Average, `Outbound Unit Cost` and `C2 Unit Cost`
   are the same for an item and costing period.
5. Cost components are user-configurable master data. Freight, customs,
   insurance, purchase price, labor, depreciation, and similar labels must not
   be hardcoded as the only possible components.
6. Inventory Issue Types map issues to accounts and determine where issued
   cost goes, including COGS, administrative expense, production/WIP, and other
   configured destinations.
7. The Inventory Transaction Detail Report with Cost & Account exposes every
   inventory receipt and issue, its source document, quantity, cost, amount,
   debit account, credit account, and GL-bound status/reference.
8. The Inventory Ledger and Cost Ledger are the operational source of truth.
   General Ledger entries are generated from them; GL is not the source used to
   calculate item-level inventory cost.

## Scope discipline

Statements under **Approved Requirement** are normative. Statements under
**Open Decision** are not approved and must not be implemented without product
owner confirmation.

The package does not approve:

- FIFO, moving average, LIFO, standard cost, or another costing method;
- a fixed chart of accounts or fixed account numbers;
- a final temporary/clearing account workflow;
- negative inventory behavior;
- backdated recalculation behavior;
- return, correction, cancellation, or revaluation rules;
- rounding precision and rounding-difference posting;
- production overhead allocation bases;
- approval, close, version, or batch lifecycle;
- multi-currency accounting treatment.

## Definition of source of truth

The source-of-truth statement does not mean that one physical database table
must contain everything. It means:

- item quantity movement originates from the Inventory Ledger;
- item monetary valuation and periodic cost originate from the Cost Ledger;
- posting lines retain references to the originating inventory/cost records;
- GL receives generated accounting entries and is used for financial reporting
  and reconciliation;
- changing a GL line alone must never silently rewrite item quantity or cost.

## Change control

When an accounting decision is approved:

1. Update the relevant specification.
2. Move the item from **Open Decisions** into an **Approved Requirement**.
3. Add or update acceptance tests.
4. Record the decision in the table below.

| Version | Date | Decision | Status |
|---|---|---|---|
| 0.1 | 2026-07-28 | Initial package based on approved conversation decisions | Baseline |
| 0.2 | 2026-07-28 | **OD-001 Costing scope** — the costing scope is **item × warehouse × company**. Cost Ledger period results are keyed on that triple. | Approved |
| 0.2 | 2026-07-28 | **OD-002 Period lifecycle** — costing uses the platform's accounting period system (`accounting_periods`, calendar month, `open`/`closed`). An unregistered month is open; closing blocks writes on that date range; reopening is an explicit, recorded action. | Approved |
| 0.2 | 2026-07-28 | **OD-003 Rounding** — the periodic average and the C1/Inbound/Outbound/C2 amounts are stored at full precision (`numeric(28,10)`); rounding happens only for display and for GL posting (2dp). The residual between posted GL amounts and the full-precision Outbound Amount is reported, never plugged. | Approved |
| 0.2 | 2026-07-28 | **Previously shipped behaviour ratified** — returns (`return_in`/`return_out`), stock-count adjustments, NRV write-down/reversal, landed cost and the purchase clearing account remain supported. They are valued at the item-period weighted average and their accounts are now configuration, not constants. This closes OD-007, OD-008 and OD-015 for the current rules and partially answers OD-009/OD-010 (single configurable clearing account). | Approved |
| 0.2 | 2026-07-28 | **OD-005 Negative stock** — remains unapproved; a period whose available quantity is negative stops with a visible validation error rather than being valued. | Deferred (blocking behaviour implemented) |
| 0.3 | 2026-07-28 | **OD-017 Allocation** — three allocation bases are permitted and the base is chosen **per allocation document**: by value (purchase amount), by quantity, or manual per-item entry. A rounding residual is placed on the largest line so the allocated lines always sum exactly to the document total. A base whose weights total zero is rejected rather than defaulted. | Approved |
| 0.3 | 2026-07-28 | **OD-019 Posting timing** — cost is computed **after the month ends and all costs are recorded**, using the average method, so the control report and GL cannot diverge. Concretely: purchase receipts are valued and posted immediately (their cost comes from the source document and it defines the average); issues, count adjustments and returns are valued only by the month-end costing run, at the month's weighted average. | Approved |
| 0.3 | 2026-07-28 | **Unpriced inbound valuation** — count surplus and customer returns have no purchase price, so the average is computed from opening balance + priced inbound only, and unpriced inbound is then valued **at that average**. This keeps C1 + Inbound = Outbound + C2 exact. A month with no priced source at all blocks rather than inventing a cost. | Approved |
| 0.2 | 2026-07-28 | **OD-014 Transfers** — remain unapproved; transfers move quantity in the Inventory Ledger but are excluded from valuation, which surfaces as a visible reconciliation difference rather than an invented rule. | Deferred (neutral behaviour implemented) |

