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
4. [CLAUDE.md](CLAUDE.md)

## Approved decisions captured by this package

1. Version 1 uses **Periodic Weighted Average only**.
2. The Inventory Cost Control Report has these fixed column groups:
   `#`, `Item Code`, `Item Description`, `C1`, `Inbound`, `Outbound`, `C2`.
3. Each of `C1`, `Inbound`, `Outbound`, and `C2` has the subheaders:
   `Qty`, `Unit Cost`, `Amount`.
4. Under Periodic Weighted Average, `Outbound Unit Cost` and `C2 Unit Cost`
   are the same for an item and costing period.
5. The calculation follows the fixed sequence:
   `C1 → Inbound average → Goods Available → Periodic Weighted Average →
   Outbound → C2 → controls`.
6. Cost components are user-configurable master data. Freight, customs,
   insurance, purchase price, labor, depreciation, and similar labels must not
   be hardcoded as the only possible components.
7. Inventory Issue Types map issues to accounts and determine where issued
   cost goes, including COGS, administrative expense, production/WIP, and other
   configured destinations.
8. Temporary/clearing accounts are configurable. Cost source recognition and
   item-level inventory/production allocation clear through the same configured
   role and reconcile by Business Object Type and Business Object ID.
9. The Inventory Transaction Detail Report with Cost & Account exposes every
   inventory receipt and issue, its source document, quantity, cost, amount,
   debit account, credit account, Running Qty, Running Amount, and GL-bound
   status/reference.
10. The Inventory Ledger and Cost Ledger are the operational source of truth.
   General Ledger entries are generated from them; GL is not the source used to
   calculate item-level inventory cost.

## Scope discipline

Statements under **Approved Requirement** are normative. Statements under
**Open Decision** are not approved and must not be implemented without product
owner confirmation.

The package does not approve:

- FIFO, moving average, LIFO, standard cost, or another costing method;
- a fixed chart of accounts or fixed account numbers;
- an organization-specific closed list of temporary/clearing accounts;
- automatic residual/write-off treatment for temporary accounts;
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
| 0.2 | 2026-07-28 | Corrected full periodic sequence, mandatory running balances, and business-object clearing | Corrected baseline |
| 0.3 | 2026-07-28 | **Product-owner decisions taken in-session** (recorded here because the corrected package was generated from the earlier conversation and predates them): OD-001 costing scope = item × warehouse × company; OD-002 period lifecycle = the platform accounting-period system (calendar month, open/closed, unregistered month = open); OD-003 precision = full-precision (numeric 28,10) storage with display/GL rounding only; OD-017 allocation = three bases (value / quantity / manual) chosen per document; OD-019 posting timing = purchases valued immediately, issues/adjustments/returns valued by the month-end run at the month average; unpriced inbound (count surplus, customer returns) valued AT the period average computed from opening + priced inbound only; previously shipped returns/adjustment/NRV/landed-cost behaviour ratified with accounts moved to configuration. | Approved |
| 0.4 | 2026-07-30 | **OD-016 Manufacturing (core)** — production costing added as a second classification alongside trading: user-defined dynamic stages, cost pools per stage with VARIABLE/FIXED behaviour, priority-ordered GL mapping rules (S2 cost-center × account-prefix), stage totals = pools + consumed inputs (inventory at period average, or an earlier stage's output at its computed unit cost), allocated to output products by relative sales value / quantity / manual chosen per stage per run. Confirming a run emits receipt movements + draft cost entries that flow through the ordinary periodic pipeline. Unmapped known-cost-center GL lines are surfaced, never dropped. Still open: WIP carry-over across months, scrap/loss, variances, by-products. | Approved (partial) |
