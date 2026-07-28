# Claude Code Instructions — Entry Inventory Costing

Read these files completely before changing inventory costing:

1. `README.md`
2. `01-functional-specification.md`
3. `02-journal-posting-rules.md`
4. `03-report-specifications.md`

They are the implementation baseline for this module.

## Non-negotiable approved decisions

- Use **Periodic Weighted Average only**.
- Do not implement FIFO, moving average, LIFO, or standard cost.
- The Cost Control Report columns are:
  `#`, `Item Code`, `Item Description`, `C1`, `Inbound`, `Outbound`, `C2`.
- Under each of `C1`, `Inbound`, `Outbound`, and `C2`, render true subheaders:
  `Qty`, `Unit Cost`, `Amount`.
- `Outbound Unit Cost` and `C2 Unit Cost` must use the same period average.
- Cost Components are user-configurable master data; do not hardcode a closed
  list.
- Inventory Issue Types are user-configurable and map issued cost to accounts,
  including COGS, admin expense, production/WIP, and other configured
  destinations.
- The Inventory Transaction Detail Report with Cost & Account must expose every
  receipt/issue, source document, item, quantity, unit cost, amount, debit
  account, credit account, GL-bound status, and journal reference when posted.
- Inventory Ledger and Cost Ledger are the item-level source of truth.
- Generate GL entries from the subledgers. Never calculate item cost from GL
  balances.
- Preserve traceability:
  `Source Document → Inventory Transaction → Cost Record → GL-bound Line → Journal`.

## Accounting safety rule

Do not invent an accounting policy. Anything marked **Open Decision** is not
approved.

If a requested implementation depends on an open decision:

1. stop that accounting portion;
2. state the exact open-decision ID/topic;
3. show the minimum choices and their impact;
4. ask the product owner to decide;
5. update the specification and tests only after approval.

Do not hide an assumption in code, seed data, a migration, an enum default, a
fallback account, or a UI default.

## Required calculation

```text
Available Qty    = C1 Qty + Inbound Qty
Available Amount = C1 Amount + Inbound Amount

Periodic Average Unit Cost =
    Available Amount / Available Qty

Outbound Amount =
    Outbound Qty × Periodic Average Unit Cost

C2 Qty =
    Available Qty - Outbound Qty

C2 Amount =
    C2 Qty × Periodic Average Unit Cost

Outbound Unit Cost = C2 Unit Cost
```

Do not invent zero-denominator, negative-stock, rounding, backdate, return, or
revaluation behavior. Those decisions are open.

## Implementation sequence

Before coding:

1. Inspect the existing Entry architecture, conventions, migrations, account
   mapping, authorization, and test framework.
2. Map existing code to the logical entities in the specification.
3. Report conflicts between existing behavior and the specification.
4. Identify any open decision needed for the requested slice.
5. Propose a small implementation plan that preserves existing compatible
   behavior.

While coding:

1. Reuse existing platform conventions.
2. Keep account numbers configurable.
3. Keep Cost Components and Inventory Issue Types data-driven.
4. Store stable lineage IDs across source, subledger, and journal.
5. Make posting idempotent; a retry must not duplicate a journal.
6. Never let a GL-only edit silently rewrite item quantity or cost.
7. Keep historical master-data mappings auditable.
8. Make reconciliation differences visible; do not auto-plug them.

Before completion:

1. Run relevant existing tests.
2. Add tests for approved formulas and account routing.
3. Verify the fixed two-level report headers.
4. Verify custom Cost Component end to end.
5. Verify Issue Type routing to at least COGS, admin expense, and
   production/WIP using configurable accounts.
6. Verify every detail row traces to source and GL-bound/posted status.
7. Verify a manual GL-only entry creates a reconciliation difference without
   changing item cost.
8. List open decisions that remain; do not claim they are implemented.

## Minimum tests

- C1 and Inbound calculate one period average.
- Outbound Unit Cost equals C2 Unit Cost at calculation precision.
- Quantity control balances.
- Amount control balances under the approved rounding policy once defined.
- Different Issue Types use the same item-period unit cost but different
  configured debit destinations.
- Custom Cost Component appears in item cost breakdown.
- Detail report shows unposted, pending, posted, and error states.
- Posted row links to its journal.
- Cost Control, transaction detail, and reconciliation totals agree for the
  same population.
- GL-only manual posting does not change Inventory Ledger or Cost Ledger.

## Completion response format

Report:

1. what was implemented;
2. files changed;
3. tests and results;
4. migrations/configuration required;
5. approved requirements satisfied;
6. open decisions or blockers;
7. any existing behavior that conflicts with the specification.

