# Entry Inventory Costing Module

## Report Specifications

**Document status:** Approved baseline with explicit open presentation details  
**Version:** 0.2 — corrected against approved conversation decisions

---

## 1. Reporting principles

### RPT-PR-001

Inventory and cost reports MUST be generated from the Inventory Ledger and Cost
Ledger, with account and journal data joined through stable references.

### RPT-PR-002

The GL MUST NOT be the primary source for item quantity or item-level cost.

### RPT-PR-003

Every amount shown as GL-bound or posted MUST expose its debit account, credit
account, posting status, and journal reference when posted.

### RPT-PR-004

Reports MUST preserve drill-down from totals to item transactions and source
documents.

### RPT-PR-005

Filtering or grouping must not change the underlying valuation rule.

## 2. Inventory Cost Control Report

### 2.1 Purpose

Provide one compact control view of beginning inventory, period receipts,
period issues, and ending inventory by item using Periodic Weighted Average.

### 2.2 Fixed column hierarchy

This hierarchy is approved and MUST NOT be redesigned:

| Row header | Row header | Row header | C1 | C1 | C1 | Inbound | Inbound | Inbound | Outbound | Outbound | Outbound | C2 | C2 | C2 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| # | Item Code | Item Description | Qty | Unit Cost | Amount | Qty | Unit Cost | Amount | Qty | Unit Cost | Amount | Qty | Unit Cost | Amount |

`Qty`, `Unit Cost`, and `Amount` MUST be real second-level subheaders under each
of the four group headers. They must not be concatenated into a single
“Qty / Unit Cost / Amount” data column.

### 2.3 Column definitions

| Column | Definition |
|---|---|
| # | Display row number |
| Item Code | Item master code |
| Item Description | Item master description/name |
| C1 Qty | Beginning quantity |
| C1 Unit Cost | C1 Amount ÷ C1 Qty when Qty is non-zero |
| C1 Amount | Beginning inventory amount |
| Inbound Qty | Total eligible receipt quantity in the period |
| Inbound Unit Cost | Inbound Amount ÷ Inbound Qty when Qty is non-zero |
| Inbound Amount | Total eligible item-level inbound cost |
| Outbound Qty | Total issue quantity in the period |
| Outbound Unit Cost | Periodic Weighted Average |
| Outbound Amount | Outbound Qty × Periodic Weighted Average |
| C2 Qty | C1 Qty + Inbound Qty − Outbound Qty |
| C2 Unit Cost | Same Periodic Weighted Average as Outbound |
| C2 Amount | C2 Qty × Periodic Weighted Average |

### 2.4 Mandatory calculation rules

The report MUST display results produced in this exact sequence:

1. establish C1 Qty and Amount, then derive C1 Unit Cost;
2. aggregate Inbound Qty and item-level Inbound Amount, then derive Inbound
   Unit Cost;
3. calculate Goods Available Qty and Amount;
4. calculate one Periodic Weighted Average Unit Cost;
5. apply it to all Outbound Qty and calculate Outbound Amount;
6. calculate C2 Qty and apply the same unit cost to C2 Amount;
7. execute quantity and amount controls.

```text
C1 Unit Cost =
    C1 Amount / C1 Qty, when C1 Qty is not zero

Inbound Unit Cost =
    Inbound Amount / Inbound Qty, when Inbound Qty is not zero

Goods Available Qty =
    C1 Qty + Inbound Qty

Goods Available Amount =
    C1 Amount + Inbound Amount
```

```text
Periodic Weighted Average =
    Goods Available Amount / Goods Available Qty
```

```text
Outbound Unit Cost =
    Periodic Weighted Average

Outbound Amount =
    Outbound Qty × Outbound Unit Cost

C2 Qty =
    Goods Available Qty - Outbound Qty

C2 Unit Cost =
    Periodic Weighted Average

C2 Amount =
    C2 Qty × C2 Unit Cost
```

```text
Outbound Unit Cost = C2 Unit Cost
```

```text
C1 Qty + Inbound Qty = Outbound Qty + C2 Qty
```

```text
C1 Amount + Inbound Amount = Outbound Amount + C2 Amount
```

The amount equation is subject to a future approved rounding policy.

### 2.5 Row expansion

Each item row MUST support or provide access to the following breakdowns.

#### Inbound cost component breakdown

| Field | Requirement |
|---|---|
| Cost Component | User-configured component |
| Amount | Item-level component amount |
| Unit Cost Impact | Component Amount ÷ relevant inbound quantity, when meaningful |
| Source Document Type | Type of source |
| Source Document No. | Clickable or searchable reference |
| Transaction/Allocation Reference | Link to ledger lineage |

Examples such as purchase price, freight, customs, and insurance are not a
fixed list.

#### Outbound Issue Type breakdown

| Field | Requirement |
|---|---|
| Inventory Issue Type | User-configured issue type |
| Destination Classification | COGS, admin, production/WIP, etc. |
| Qty | Issue quantity for type |
| Unit Cost | Shared periodic average |
| Amount | Qty × periodic average |
| Debit Account | Resolved destination |
| Credit Account | Resolved inventory account |

Breakdown totals MUST equal the parent item's Outbound values.

### 2.6 Control indicators

The report MUST identify:

- quantity balanced/not balanced;
- amount balanced/not balanced;
- calculated/not calculated;
- GL reconciliation status when available.

Specific colors and icons are implementation/UI-system choices. Status must not
be conveyed by color alone.

### 2.7 Filters

Required filters:

- costing period;
- costing scope after OD-001 is approved;
- item;
- item code/name search;
- item group/category if available in Entry;
- warehouse if part of the approved scope.

Optional operational filters may be added without changing accounting logic.

### 2.8 Totals

The report MUST total quantities and amounts where aggregation is meaningful.
It MUST NOT sum item Unit Cost columns into a meaningless total.

An overall “average of unit costs” must not be displayed unless its definition
is separately approved.

### 2.9 Export

Export MUST preserve:

- two-level headers;
- displayed filters;
- item rows;
- quantity and amount totals;
- enough precision to reproduce displayed results;
- a marker or separate sheet/section for breakdowns if breakdowns are exported.

Export file format is an implementation choice.

### 2.10 Acceptance tests

1. Header groups and subheaders match the approved hierarchy.
2. Outbound and C2 Unit Cost match at calculation precision.
3. Quantity equation balances for valid data.
4. Amount equation balances under approved rounding.
5. Inbound expansion totals to Inbound Amount.
6. Outbound Issue Type expansion totals to Outbound Qty/Amount.
7. No unit-cost total is shown.

## 3. Inventory Transaction Detail Report with Cost & Account

### 3.1 Purpose

This is the bridge between Inventory, Cost, and GL. It enables a user to see
every receipt and issue at item level, understand its value, and identify its
debit/credit destination and journal status.

### 3.2 Coverage

The report MUST include all inventory receipt and issue transactions in the
selected scope and period, including transactions that are:

- not yet GL-bound;
- GL-bound but pending posting;
- posted;
- in posting error.

It MUST NOT show only posted GL transactions, because that would hide
subledger activity awaiting or failing posting.

### 3.3 Mandatory columns

| Group | Column | Requirement |
|---|---|---|
| Time | Transaction Date | Required |
| Time | Accounting/Posting Date | Required when distinct |
| Source | Source Document Type | Required |
| Source | Source Document No. | Required |
| Source | Source Document ID | Available for drill-down/export |
| Transaction | Inventory Transaction ID | Required |
| Transaction | Transaction Type | Receipt/issue and business type |
| Transaction | Direction | Inbound or Outbound |
| Item | Item Code | Required |
| Item | Item Description | Required |
| Location | Warehouse | Required where inventory uses warehouses |
| Quantity | Qty In | Receipt quantity, otherwise blank/zero |
| Quantity | Qty Out | Issue quantity, otherwise blank/zero |
| Quantity | Unit of Measure | Required |
| Cost | Unit Cost | Entered/allocated inbound cost or periodic issue cost |
| Cost | Amount | Transaction cost amount |
| Balance | Running Qty | Required |
| Balance | Running Amount | Required after the period is calculated |
| Cost | Cost Method | `Periodic Weighted Average` for valued issues |
| Classification | Cost Component | Required where transaction relates to component |
| Classification | Inventory Issue Type | Required for cost-bearing issues |
| Account | Debit Account Code | Required when GL-bound |
| Account | Debit Account Name | Required when GL-bound |
| Account | Credit Account Code | Required when GL-bound |
| Account | Credit Account Name | Required when GL-bound |
| GL | GL-bound Status | Required |
| GL | Journal No. | Required when posted |
| GL | Journal Line Reference | Available for drill-down/export |
| Audit | Created By | Required |
| Audit | Created At | Required |

### 3.4 Running quantities and amounts

The report MUST expose Running Qty and Running Amount. They are report
balances within the selected item, period, and valuation scope; they MUST NOT
recalculate a moving-average unit cost.

Rows use a stable display order based on accounting/posting date and stable
transaction identity. For each displayed row `n`:

```text
Running Qty(n) =
    C1 Qty
    + cumulative Qty In through row n
    - cumulative Qty Out through row n
```

After the Periodic Weighted Average result is calculated:

```text
Running Amount(n) =
    C1 Amount
    + cumulative Inbound Amount through row n
    - cumulative Outbound Amount through row n
```

where:

```text
Each receipt contribution =
    its eligible item-level Inbound Amount

Each issue contribution =
    its Qty Out × the one Periodic Weighted Average Unit Cost
```

The final row MUST reconcile to C2 Qty and C2 Amount. If the period is not yet
calculated or a row remains unvalued, Running Amount MUST show an explicit
not-calculated/incomplete status instead of applying a provisional
moving-average cost.

### 3.5 Required row drill-down

From a row, the user MUST be able to access or identify:

1. source business document;
2. inventory transaction;
3. quantity movement;
4. unit cost and amount;
5. Cost Component breakdown where applicable;
6. Inventory Issue Type where applicable;
7. resolved debit and credit accounts;
8. GL-bound status;
9. posted journal and lines;
10. user/audit information.

### 3.6 Filters

Required:

- date range/accounting period;
- direction: receipt/issue;
- inventory transaction type;
- source document type and number;
- item;
- item group/category when available;
- warehouse when available;
- Cost Component;
- Inventory Issue Type;
- debit account;
- credit account;
- GL-bound status;
- journal number;
- user.

Additional filters may include supplier, customer, production order, project,
cost center, department, batch, or serial only when those dimensions exist and
their accounting behavior is approved elsewhere.

### 3.7 Grouping

The report SHOULD support grouping by:

- item;
- transaction type;
- Cost Component;
- Inventory Issue Type;
- debit account;
- credit account;
- source document;
- GL-bound status.

Grouping MUST preserve access to underlying rows and must not change totals.

### 3.8 Totals

At minimum, total:

- Qty In;
- Qty Out;
- Amount.

When filtered/grouped by account, debit and credit amount totals must be
available and reconcilable.

Do not total Unit Cost.

### 3.9 GL-bound visibility

For each transaction:

- if not GL-bound, account columns may show unresolved/not applicable, but the
  status must be explicit;
- if GL-bound, debit and credit accounts must display;
- if posted, journal number and drill-down must display;
- if posting failed, the failure status must display without removing the
  subledger transaction.

### 3.10 Acceptance tests

1. Every ledger receipt and issue appears exactly once at the chosen reporting
   grain or has a clearly documented component split.
2. A posted issue can be traced to its source document and journal.
3. A pending issue appears even without a posted journal.
4. Issue Unit Cost equals the approved period average.
5. Debit account follows Inventory Issue Type.
6. Credit account follows inventory account configuration.
7. Filters by debit/credit account return the supporting item transactions.
8. Report totals tie to the selected Cost Ledger population.
9. Running Qty begins from C1 Qty and ends at C2 Qty.
10. Running Amount begins from C1 Amount, uses actual eligible inbound amounts
    and the one period cost for issues, and ends at C2 Amount.
11. Running balances do not recalculate unit cost transaction by transaction.

## 4. Cost Component Analysis

### 4.1 Purpose

Explain what formed item Inbound Amount using user-configured Cost Components.

### 4.2 Required columns

- costing period;
- item code;
- item description;
- Cost Component code;
- Cost Component name;
- source document type;
- source document number;
- item-level component amount;
- unit-cost impact when meaningful;
- transaction/allocation reference;
- GL-bound status;
- debit account;
- credit account;
- journal number when posted.

### 4.3 Controls

For an item and period:

```text
Sum(included Cost Component item-level amounts)
=
Inbound Amount represented by those components
```

The report must distinguish included-in-inventory amounts from amounts not
included, once eligibility rules are approved.

### 4.4 Open decisions

- allocation-method display;
- treatment of unallocated residuals;
- component eligibility;
- tax components;
- late-cost revaluation.

## 5. Inventory-to-GL Reconciliation

### 5.1 Purpose

Show whether inventory/cost subledger GL-bound values agree with the linked GL
entries and identify the source of differences.

### 5.2 Required summary

| Measure | Meaning |
|---|---|
| Inventory/Cost Subledger Amount | GL-bound amount from source ledgers |
| Linked GL Amount | Posted GL amount linked to those records |
| Difference | Subledger Amount − Linked GL Amount |
| Status | Reconciled / Difference / Pending |

### 5.3 Required breakdowns

The user must be able to break a difference down by:

- account;
- period/date;
- item;
- source document;
- inventory transaction;
- journal;
- posting status.

### 5.4 Difference categories

At minimum, the report should identify:

- subledger GL-bound entry not posted;
- posting error;
- posted GL entry missing a valid subledger reference;
- amount mismatch;
- account mismatch;
- duplicate posting.

This classification is diagnostic and does not authorize automatic corrections.

### 5.5 Reconciliation equations

For a selected account population:

```text
Subledger GL-bound debits = Linked GL debits
Subledger GL-bound credits = Linked GL credits
```

For inventory issues:

```text
Cost Ledger Outbound Amount
=
Linked GL credits to configured inventory accounts
```

The second equation must be scoped carefully so receipts, manual GL entries,
and other movements are not mixed into an issue-only comparison.

### 5.6 Manual GL entry behavior

A manual GL entry to an inventory account must not change the Inventory Ledger
or Cost Ledger. The reconciliation report must show it as an unlinked GL amount
or equivalent difference.

## 6. Temporary Account Reconciliation

This is a mandatory bridge report for configured inventory and production
temporary/clearing accounts. It explains what entered each temporary account,
what was allocated or cleared, and what remains by business object.

### 6.1 Mandatory behavior

| Column | Purpose |
|---|---|
| Temporary Account | Account being reconciled |
| Business Object Type | Shipment, receipt, invoice, landed-cost/allocation document, production order, cost allocation batch, or the process object used |
| Business Object ID | Stable matching key |
| Opening | Beginning balance |
| Increase | New temporary amount |
| Allocated/Cleared | Amount linked and cleared |
| Ending | Remaining balance |
| Source Document | Origin of remaining amount |
| Cost Component | Component classification |
| Item/Shipment/Production Reference | Business explanation when applicable |
| Status/Reason | Why balance remains |

### 6.2 Control

```text
Opening + Increase - Allocated/Cleared = Ending
```

The report MUST reconcile within each Temporary Account + Business Object Type
+ Business Object ID. It MUST NOT clear or hide a balance by netting unrelated
documents or unrelated business objects. Clearing retains source, Cost
Component, allocation, item, and journal linkage.

### 6.3 Open decisions

- exact configured account-role list;
- authorization/timing for partial clearing;
- aging;
- write-off;
- cross-period handling.

## 7. Report security and audit

Report access must honor Entry's authorization model.

At minimum:

- account fields are visible only to users authorized for accounting detail;
- source-document drill-down respects source-module permissions;
- exports use the same authorization as the on-screen report;
- report parameters and generation time are included in exports;
- posted historical results cannot be made to look recalculated without a
  visible status/version distinction.

The detailed permission matrix remains an open decision.

## 8. Performance and consistency requirements

1. The same filter population must return consistent totals across control,
   detail, and reconciliation reports.
2. Report caching must not serve results from a different period or costing
   scope.
3. A user must be able to identify the calculation/posting status of the data.
4. Exported totals must equal the displayed totals at the same precision.
5. Pagination must not alter totals.
6. Sorting must not change Periodic Weighted Average results.

## 9. Cross-report acceptance matrix

| Control | Expected relationship |
|---|---|
| Detail receipts | Sum to Inbound Qty and supported Inbound Amount |
| Detail issues | Sum to Outbound Qty and Outbound Amount |
| Issue Type breakdown | Sum to detail issues and Outbound |
| Cost Component breakdown | Sum to supported Inbound Amount |
| GL-bound detail | Sum to subledger side of reconciliation |
| Posted journals | Sum to linked GL side of reconciliation |
| Unlinked manual GL | Appears as reconciliation difference |
| Outbound Unit Cost | Equals C2 Unit Cost |
