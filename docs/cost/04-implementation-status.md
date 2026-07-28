# Entry Inventory Costing Module

## Implementation Status

**Document status:** Living record of what is built  
**Version:** 0.2 · 2026-07-28  
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

---

## 3. Open decisions still open

These are **not** implemented as accounting policy. Where the module had to
behave somehow, it blocks or stays neutral and makes the gap visible.

| ID | Status in code |
|---|---|
| OD-004 / OD-005 zero and negative quantity | Period stops with a visible error; nothing is valued |
| OD-006 backdated transactions | Recalculation rewrites **draft** results only; posted entries keep their historical amounts and any resulting gap appears in reconciliation |
| OD-011 late landed cost | Existing date-effective behaviour retained under the 0.2 ratification; the prior-period revaluation rule is still undecided |
| OD-012 taxes | Not implemented |
| OD-013 currency | Not implemented — costing is MNT only |
| OD-014 transfers | Excluded from valuation; the quantity movement still occurs |
| OD-016 manufacturing | Not implemented beyond an issue type being able to point at a production/WIP account |
| OD-017 allocation bases | Not implemented; cost components can be recorded but no allocation engine exists |
| OD-018 receipt types | Not implemented |
| OD-019 posting timing | Immediate per-entry posting retained; period-end aggregation not built |
| OD-020 dimensions | Not implemented as columns; dimensions remain inside the account segment string |

---

## 4. Known gaps against the baseline

1. **Cost Component Analysis (§4)** is not built as a separate report.
   Components can be created and referenced, and they appear as a column in
   the transaction detail report, but there is no allocation flow that
   attaches components to a receipt at item level, so the report would have
   nothing to analyse. Building it requires OD-017.
2. **Per-transaction issue valuation still uses the perpetual average.**
   `lib/costing/costing.ts` values each issue as it is confirmed so that GL
   posting can happen immediately (the ratified current behaviour, OD-019).
   The period results in `cost_period_results` are the specification's
   Periodic Weighted Average and are the source for the control report. Where
   the two differ, the difference is visible in reconciliation. Unifying them
   requires deciding OD-019 (posting timing) and OD-006 (backdating).
3. **Running balances (§3.4)** are not implemented — the specification
   leaves their ordering and opening point open.
4. **Temporary Account Reconciliation (§6)** is not built; it becomes
   mandatory only once a temporary-account design is approved beyond the
   single clearing account ratified in 0.2.
5. **Export (§2.9)** relies on AG Grid's built-in CSV export; a two-level
   header export has not been verified.
6. **Authorization (§7)** follows the platform's per-user data scoping.
   The detailed permission matrix remains an open decision.
