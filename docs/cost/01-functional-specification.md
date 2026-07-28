# Entry Inventory Costing Module

## Comprehensive Functional Specification

**Document status:** Implementation baseline with explicit open decisions  
**Version:** 0.1  
**Decision authority:** Product owner  
**Related documents:** `02-journal-posting-rules.md`,
`03-report-specifications.md`, `CLAUDE.md`

---

## 1. Purpose

This specification defines the functional behavior of inventory costing in the
Entry Accounting System. It covers:

- item quantity movement;
- periodic inventory valuation;
- user-configurable cost components;
- cost destination controlled by Inventory Issue Type;
- inventory and cost subledgers;
- journal generation;
- control, detail, and reconciliation reporting;
- traceability from business document to inventory, cost, and GL.

The principal UX objective is that a user can understand what happened to an
item, how it was valued, and where its value was posted without switching
between disconnected reports.

## 2. Scope

### 2.1 In scope

- Periodic Weighted Average costing;
- inventory receipts and issues;
- beginning balance (`C1`);
- period inbound movements (`Inbound`);
- period outbound movements (`Outbound`);
- ending balance (`C2`);
- configurable cost components;
- configurable Inventory Issue Types and account destinations;
- inventory transaction details with cost and account;
- item-level cost control;
- GL-bound journal generation and traceability;
- reconciliation between inventory/cost subledger and GL.

### 2.2 Not approved for Version 1

The following must not be treated as approved requirements:

- FIFO;
- LIFO;
- moving average/perpetual weighted average;
- standard cost;
- serial-specific or lot-specific costing;
- fixed account numbers;
- exact temporary/clearing account lifecycle;
- exact manufacturing overhead allocation logic;
- backdated recalculation rules;
- return and cancellation valuation rules;
- negative stock behavior;
- rounding policy;
- multi-currency valuation;
- cost batch/version/approval workflow.

These topics are listed again in Section 18 as open decisions.

## 3. Normative principles

### FR-PR-001 — Costing method

**Approved Requirement:** The module MUST use Periodic Weighted Average as its
only costing method in Version 1.

The system MUST NOT calculate outbound cost by FIFO, moving average, LIFO, or
standard cost.

### FR-PR-002 — Operational source of truth

**Approved Requirement:** The Inventory Ledger and Cost Ledger MUST be the
operational source of truth for item quantity and item monetary valuation.

### FR-PR-003 — GL relationship

**Approved Requirement:** The GL MUST receive journal entries generated from
the inventory/cost process. The GL MUST NOT be queried as the primary source
for calculating item-level inventory cost.

### FR-PR-004 — Traceability

**Approved Requirement:** A GL-bound inventory amount MUST remain traceable to:

1. its source business document;
2. its inventory transaction;
3. its item;
4. its quantity;
5. its calculated or entered cost;
6. its debit account;
7. its credit account;
8. its generated journal, when posted.

### FR-PR-005 — Configuration over hardcoding

**Approved Requirement:** Cost components and Inventory Issue Types MUST be
master data. The implementation MUST NOT assume that a closed hardcoded list is
sufficient for all organizations.

## 4. Terminology

| Term | Definition |
|---|---|
| C1 | Beginning inventory for the selected costing period |
| Inbound | Inventory received during the selected costing period |
| Outbound | Inventory issued during the selected costing period |
| C2 | Ending inventory for the selected costing period |
| Periodic Weighted Average | One period cost used for both Outbound and C2 |
| Inventory Ledger | Item-level source of truth for quantity movements |
| Cost Ledger | Item-level source of truth for monetary valuation and cost results |
| Cost Component | User-configurable classification of a cost forming inventory or production cost |
| Inventory Issue Type | User-configurable reason/type for an issue that controls its account destination |
| Source Document | Business document that caused or supports an inventory/cost transaction |
| GL-bound entry | A subledger posting line intended for or already linked to GL |
| Posting profile | Configuration used to resolve debit/credit accounts without hardcoded account numbers |

## 5. Costing model

### 5.1 Costing boundary

The average is calculated for an item within a selected costing period and the
system's configured inventory valuation scope.

**Open Decision:** Whether the valuation scope is per legal entity only, per
warehouse, per site, or another dimension has not been approved.

### 5.2 Required values by item and period

For each item in the costing scope, the system MUST produce:

| Group | Qty | Unit Cost | Amount |
|---|---:|---:|---:|
| C1 | required | derived or carried | required |
| Inbound | required | derived | required |
| Outbound | required | periodic average | derived |
| C2 | derived | periodic average | derived |

### 5.3 Periodic Weighted Average formulas

For an item and costing period:

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
```

When `Inbound Qty` is not zero:

```text
Inbound Unit Cost = Inbound Amount / Inbound Qty
```

When `C1 Qty` is not zero:

```text
C1 Unit Cost = C1 Amount / C1 Qty
```

### FR-COST-001 — Shared unit cost

**Approved Requirement:** For the same item, costing scope, and period:

```text
Outbound Unit Cost = C2 Unit Cost
```

### FR-COST-002 — Three meaningful unit-cost values

**Approved Requirement:** The control view MUST preserve and show the three
meaningfully distinct unit-cost positions:

1. C1 Unit Cost;
2. Inbound Unit Cost;
3. the shared Outbound/C2 Unit Cost.

### FR-COST-003 — Quantity control

The calculation MUST expose whether this equation balances:

```text
C1 Qty + Inbound Qty = Outbound Qty + C2 Qty
```

### FR-COST-004 — Amount control

Subject to the approved rounding policy, the calculation MUST expose whether
this equation balances:

```text
C1 Amount + Inbound Amount = Outbound Amount + C2 Amount
```

**Open Decision:** Decimal precision, rounding level, and treatment of rounding
differences have not been approved.

### FR-COST-005 — Zero denominator

The engine MUST NOT divide by zero or silently create a unit cost.

**Open Decision:** The permitted business behavior when `Available Qty = 0`
has not been approved. Until approved, the implementation should stop the
calculation with a visible validation error rather than invent a result.

## 6. Logical architecture

```text
Business Documents
        |
        v
Inventory Ledger  <---- item quantity movement
        |
        +--------------------+
        |                    |
        v                    v
Cost Ledger           Journal Generation
        |                    |
        v                    v
Cost & Control Reports      General Ledger
        \____________________/
             Reconciliation
```

### FR-ARCH-001 — One traceable chain

The implementation MUST maintain a stable traceable relationship across:

```text
Source Document
→ Inventory Transaction
→ Cost Ledger Entry/Result
→ GL-bound Posting Line
→ Posted Journal
```

### FR-ARCH-002 — No GL-first costing

The cost calculation MUST NOT aggregate a GL account balance and divide it by
inventory quantity to create item cost.

### FR-ARCH-003 — Separation of concerns

- Inventory Ledger records item quantity movement.
- Cost Ledger records item monetary valuation and cost calculation results.
- Journal Generation maps approved subledger events to debit/credit lines.
- GL stores posted financial entries.
- Reports may combine these sources through stable references.

Physical table design is an implementation choice, provided these logical
responsibilities and traceability requirements are preserved.

## 7. Master data

### 7.1 Cost Component

#### FR-MD-CC-001 — User configurability

**Approved Requirement:** Authorized users MUST be able to create and maintain
Cost Components in master data and select them during relevant cost entry or
allocation processes.

#### FR-MD-CC-002 — No closed hardcoded list

Purchase price, freight, customs, insurance, broker fee, labor, depreciation,
utilities, and overhead are examples only. They MUST NOT be implemented as the
only possible Cost Components.

#### Minimum logical fields

The following fields are necessary to identify, select, report, and account for
a component without hardcoding:

| Field | Requirement |
|---|---|
| Component ID | Stable internal identifier |
| Code | User-visible unique code |
| Name | User-visible name |
| Active | Controls future selection without deleting history |
| Component classification/type | Supports grouping and reporting |
| Account/posting configuration reference | Connects component to journal resolution |

The precise list of classifications and the exact posting configuration are
open decisions. Implementations may add technical audit fields, but must not
assign unapproved accounting meaning.

#### FR-MD-CC-003 — Historical integrity

Deactivating or renaming a component MUST NOT remove or reclassify historical
transactions silently.

### 7.2 Inventory Issue Type

#### FR-MD-IT-001 — Purpose

**Approved Requirement:** Inventory Issue Type MUST determine where the cost of
an inventory issue is posted.

Supported business outcomes are configurable and include, without being limited
to:

- Cost of Goods Sold (COGS);
- administrative expense;
- production/WIP;
- selling/marketing expense;
- loss or shrinkage expense;
- project cost;
- capitalization or another configured destination.

The examples do not approve fixed account numbers.

#### FR-MD-IT-002 — Account mapping

Each active Inventory Issue Type MUST resolve the debit destination account or
posting profile. The inventory credit account MUST be resolved through the
approved inventory account configuration.

#### Minimum logical fields

| Field | Requirement |
|---|---|
| Issue Type ID | Stable internal identifier |
| Code | User-visible unique code |
| Name | User-visible name |
| Active | Controls future use |
| Debit account or posting profile | Required destination mapping |
| Destination classification | COGS, admin, production/WIP, or configured category |

Potential dimensional requirements—cost center, project, department,
production order, customer, or sales order—were discussed but not approved.
They belong to Open Decisions.

#### FR-MD-IT-003 — Historical integrity

Changing an Issue Type mapping MUST NOT silently rewrite previously posted
transactions.

### 7.3 Inventory Receipt Type

Inventory Receipt Type was mentioned in the architecture discussion but its
behavior and mandatory fields were not approved.

**Open Decision:** Define whether receipt types control accounts, validations,
cost behavior, or only transaction classification.

### 7.4 Item accounting configuration

The credit account for an issue and the debit account for a receipt must be
resolved without hardcoding a single inventory account for all items.

**Open Decision:** The approved precedence among item, item group, warehouse,
legal entity, and posting profile has not been decided.

## 8. Inventory Ledger

### FR-LEDGER-INV-001 — Coverage

The Inventory Ledger MUST contain every inventory receipt and issue used by
costing and inventory reports.

### FR-LEDGER-INV-002 — Minimum traceable facts

Each inventory transaction MUST expose at least:

- transaction ID;
- transaction date;
- source document type;
- source document ID/number;
- transaction direction: receipt or issue;
- transaction type;
- item ID/code;
- item description or reference to item master;
- quantity;
- unit of measure;
- warehouse/location reference when used by inventory;
- Inventory Issue Type for issues where applicable;
- link to related cost record(s);
- posting status;
- link to GL-bound and posted journal records.

### FR-LEDGER-INV-003 — Immutability of posted history

Posted history MUST remain auditable. Corrections must not destroy the original
business event or its accounting trace.

**Open Decision:** The exact reversal/correction workflow has not been approved.

### FR-LEDGER-INV-004 — Quantity first-class

Quantity MUST remain available independently of GL. A GL balance alone is not a
substitute for item-level quantity movement.

## 9. Cost Ledger

### FR-LEDGER-COST-001 — Coverage

The Cost Ledger MUST retain sufficient item-level monetary data to reproduce
the Cost Control Report and Inventory Transaction Detail Report with Cost &
Account.

### FR-LEDGER-COST-002 — Period result

For each item, period, and costing scope, the Cost Ledger MUST expose:

- C1 Qty, Unit Cost, Amount;
- Inbound Qty, Unit Cost, Amount;
- calculated periodic average unit cost;
- Outbound Qty, shared periodic average unit cost, Amount;
- C2 Qty, shared periodic average unit cost, Amount;
- calculation status;
- source or lineage to included transactions.

### FR-LEDGER-COST-003 — Transaction linkage

Cost amounts MUST be traceable to the inventory transaction(s) they value and,
where applicable, to their Cost Component.

### FR-LEDGER-COST-004 — GL linkage

The ledger MUST expose the GL-bound debit/credit mapping and, after posting, the
journal reference.

### FR-LEDGER-COST-005 — Reproducibility

A user or auditor must be able to identify which C1 and Inbound records formed
the periodic average and which Outbound records received that average.

## 10. Cost component entry and allocation

### FR-ALLOC-001 — Selection from master data

When a user records or classifies a cost component, the UI MUST allow selection
from active Cost Component master data.

### FR-ALLOC-002 — Item-level result

Any cost component included in inventory valuation MUST ultimately be traceable
to an item-level amount before it contributes to Inbound Amount.

### FR-ALLOC-003 — Breakdown

The system MUST retain the component breakdown required to show how an item's
Inbound Amount was formed.

### FR-ALLOC-004 — No invented allocation base

Quantity, value, weight, volume, machine hours, labor hours, and manual
allocation were discussed as possible bases. No universal/default allocation
rule was approved. Claude Code MUST NOT select one as accounting policy.

### FR-ALLOC-005 — User-visible lineage

For each allocated component amount, the system should expose:

- Cost Component;
- allocated amount;
- item;
- source document;
- allocation document/reference, if used;
- allocation basis or method, after that decision is approved.

## 11. Procurement and landed cost

The approved business intent is that purchased inventory can include purchase
price and additional user-configured Cost Components, and that those components
can be assigned to inventory items.

### FR-PROC-001

Purchase-related Cost Components MUST be selected from Cost Component master
data rather than from a closed hardcoded list.

### FR-PROC-002

The item-level cost resulting from purchase-related components MUST feed
Inbound Amount for the relevant costing period when it is eligible for that
period.

**Open Decisions:**

- timing rule for whether a late invoice belongs to the current or prior period;
- goods-received-not-invoiced treatment;
- invoice-before-receipt treatment;
- exact landed-cost document lifecycle;
- temporary account postings and clearing;
- tax capitalization rules;
- multi-currency conversion date and exchange rate.

## 12. Manufacturing relationship

The approved direction is that inventory issued to production can post to
production/WIP through an Inventory Issue Type, and finished product can become
inventory Inbound.

### FR-MFG-001 — Material issue

An issue classified by an Inventory Issue Type whose destination is
production/WIP MUST use the item's periodic average cost and map the amount to
the configured production/WIP destination.

### FR-MFG-002 — Finished-goods receipt

A completed product receipt, once its approved production cost is available,
MUST be capable of contributing to the finished item's Inbound Qty and Inbound
Amount.

### FR-MFG-003 — Cost component reuse

Production costs that become part of inventory cost MUST be classifiable by
user-configurable Cost Components.

**Open Decisions:**

- production order structure;
- BOM and routing behavior;
- WIP stages;
- normal loss, scrap, by-product, and co-product treatment;
- actual versus planned production cost;
- direct labor source;
- depreciation source;
- overhead pool and allocation bases;
- incomplete production at period end;
- production variance treatment;
- exact WIP and clearing journal rules.

## 13. Inventory issue workflow

### FR-ISSUE-001

Every cost-bearing issue MUST have an Inventory Issue Type, whether assigned by
the source document or selected by an authorized user.

### FR-ISSUE-002

The Issue Type MUST determine the debit destination. The configured inventory
account MUST be credited.

### FR-ISSUE-003

All issues for the same item and period MUST use the same approved periodic
average unit cost for valuation, regardless of their destination account.

Example:

| Issue Type destination | Qty | Unit Cost | Amount |
|---|---:|---:|---:|
| COGS | 100 | Period average | Qty × period average |
| Administrative expense | 10 | Period average | Qty × period average |
| Production/WIP | 50 | Period average | Qty × period average |

The account numbers and exact Issue Type codes are configurable, not fixed by
this example.

### FR-ISSUE-004

The sum of issue-type breakdown quantities and amounts MUST equal the Outbound
Qty and Outbound Amount for that item and period.

## 14. Journal generation integration

### FR-JRN-001

Journal generation MUST consume GL-bound entries originating from the Inventory
Ledger/Cost Ledger process.

### FR-JRN-002

Every generated journal line MUST retain a reference to its source inventory
and cost record.

### FR-JRN-003

For an inventory issue:

```text
Debit  = account resolved from Inventory Issue Type
Credit = configured inventory account
Amount = issue quantity × periodic average unit cost
```

### FR-JRN-004

The journal generator MUST NOT recalculate item unit cost from GL balances.

### FR-JRN-005

Before GL posting, the sum of debit lines MUST equal the sum of credit lines for
the generated journal.

Exact receipt and clearing postings are defined only to the extent approved in
`02-journal-posting-rules.md`.

## 15. User experience requirements

### FR-UX-001 — Business-first display

Operational screens and reports should prioritize business concepts—item,
receipt, issue, cost component, issue type, source document, and cost—while
still exposing debit and credit accounts where accounting review is intended.

### FR-UX-002 — Drill-down

From an inventory transaction detail row, a user MUST be able to access or
identify:

- source document;
- inventory transaction;
- item cost;
- Cost Component breakdown when applicable;
- Inventory Issue Type when applicable;
- debit and credit accounts;
- GL-bound status;
- posted journal reference when available.

### FR-UX-003 — No hidden mismatch

If quantity, amount, or posting reconciliation fails, the system MUST make the
difference visible. It MUST NOT display the period as balanced.

### FR-UX-004 — Configurable master-data selection

The cost-entry UI MUST select Cost Components from master data. The issue UI
MUST use Inventory Issue Types and their mappings.

## 16. Reporting requirements

The module MUST provide:

1. Inventory Cost Control Report;
2. Inventory Transaction Detail Report with Cost & Account;
3. Cost Component Analysis or equivalent component breakdown;
4. Inventory-to-GL Reconciliation;
5. visibility of unresolved temporary/clearing balances if such accounts are
   approved and implemented.

The full specifications are in `03-report-specifications.md`.

## 17. Roles, controls, and audit

### FR-AUD-001

The system MUST record who created and last changed master data and
transactions, with timestamps.

### FR-AUD-002

Changes to Cost Component and Inventory Issue Type configuration MUST be
auditable.

### FR-AUD-003

Posted records MUST retain their original account and configuration result even
if master data changes later.

### FR-AUD-004

Users must not be able to delete configuration that is referenced by historical
transactions; deactivation is required.

**Open Decisions:**

- detailed permission matrix;
- approval workflow;
- segregation of duties;
- period lock and reopen authority;
- override rights and required explanations.

## 18. Open decisions — do not implement as accounting policy

| ID | Topic | Decision required |
|---|---|---|
| OD-001 | Costing scope | Legal entity, warehouse, site, or another scope |
| OD-002 | Period lifecycle | Open, calculate, review, close, reopen behavior |
| OD-003 | Rounding | Unit cost precision, amount precision, residual treatment |
| OD-004 | Zero/negative quantity | Blocking and valuation behavior |
| OD-005 | Negative stock | Allowed or blocked; effect on costing |
| OD-006 | Backdated transaction | Recalculation and prior-period handling |
| OD-007 | Returns | Purchase return and sales return valuation |
| OD-008 | Corrections | Void, reverse, replace, and audit workflow |
| OD-009 | Receipt accounting | Account resolution and timing |
| OD-010 | Temporary accounts | Required accounts, event rules, and clearing |
| OD-011 | Late landed cost | Current/prior period treatment and revaluation |
| OD-012 | Taxes | Capitalizable versus recoverable amounts |
| OD-013 | Currency | Exchange rates and realized/unrealized differences |
| OD-014 | Transfers | Same-scope and cross-scope valuation/accounting |
| OD-015 | Stock adjustment | Surplus/shortage valuation and accounts |
| OD-016 | Manufacturing | WIP, overhead, scrap, variance, completion logic |
| OD-017 | Allocation | Permitted bases, defaults, residual handling |
| OD-018 | Receipt types | Master-data behavior and account mapping |
| OD-019 | Posting timing | Immediate, provisional, period-end, or hybrid |
| OD-020 | Dimensions | Cost center, project, department, order requirements |

Until an item is approved, the implementation MUST either keep it
configuration-free and neutral or stop with a clear “decision/configuration
required” validation. It MUST NOT create a hidden default accounting rule.

## 19. Acceptance criteria

### AC-001 — Periodic average calculation

Given:

```text
C1 Qty       = 100
C1 Amount    = 1,000,000
Inbound Qty  = 50
Inbound Amount = 600,000
Outbound Qty = 30
```

The system calculates:

```text
C1 Unit Cost          = 10,000
Inbound Unit Cost     = 12,000
Periodic Average      = 10,666.666...
Outbound Unit Cost    = Periodic Average
C2 Unit Cost          = Periodic Average
C2 Qty                = 120
```

Displayed amounts depend on the approved rounding policy. The test MUST assert
that Outbound and C2 use the same unrounded calculation basis.

### AC-002 — Issue destinations

Given multiple issues of the same item in one period with Issue Types mapped to
COGS, administrative expense, and production/WIP:

- all issues use the same periodic average unit cost;
- each issue debits the account resolved by its Issue Type;
- each issue credits the configured inventory account;
- their total equals the item's Outbound Qty and Amount.

### AC-003 — Configurable component

Given an authorized user creates a new Cost Component not shipped with the
application:

- it can be selected in the relevant cost process;
- its item-level amount appears in cost breakdown;
- it contributes to Inbound Amount when included in valuation;
- its source document is traceable;
- its historical use survives later deactivation.

### AC-004 — Detail-to-GL trace

For a posted issue, the transaction detail report shows:

- date and document;
- item and quantity;
- periodic unit cost and amount;
- Issue Type;
- debit and credit accounts;
- GL-bound/posted status;
- journal number;
- drill-down or stable reference to the source document and journal.

### AC-005 — Source-of-truth protection

Changing or manually posting a GL entry alone does not silently change:

- item quantity;
- item periodic average;
- Outbound cost;
- C2 cost.

The reconciliation report exposes the resulting difference.

### AC-006 — Control report structure

The rendered report has:

```text
# | Item Code | Item Description |
C1      [Qty | Unit Cost | Amount] |
Inbound [Qty | Unit Cost | Amount] |
Outbound[Qty | Unit Cost | Amount] |
C2      [Qty | Unit Cost | Amount]
```

`Qty`, `Unit Cost`, and `Amount` are true second-level column headers, not text
embedded in one cell.

## 20. Implementation completion gate

The inventory costing feature is not complete until:

- the approved formulas pass automated tests;
- the fixed control report hierarchy is implemented;
- Outbound and C2 share the same unit-cost basis;
- custom Cost Components work end to end;
- Inventory Issue Type account routing works end to end;
- every receipt/issue is visible in the transaction detail report;
- GL-bound entries and posted journals are traceable;
- inventory/cost-to-GL differences are visible;
- open decisions have not been silently encoded as accounting policy.

