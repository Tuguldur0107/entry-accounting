# Entry Inventory Costing Module

## Journal Posting Rules

**Document status:** Approved baseline plus explicit unresolved rules  
**Version:** 0.2 — corrected against approved conversation decisions  

---

## 1. Purpose

This document defines only the journal rules supported by approved decisions.
It does not invent a fixed chart of accounts, temporary-account workflow,
receipt posting rule, tax rule, or production overhead rule.

## 2. Posting principles

### JPR-001 — Subledger origin

All inventory journals MUST originate from GL-bound records produced by the
Inventory Ledger/Cost Ledger process.

### JPR-002 — No GL-derived costing

The journal generator MUST use the unit cost and amount supplied by the Cost
Ledger. It MUST NOT derive item cost from GL balances.

### JPR-003 — Balanced journal

Each generated journal MUST have equal debit and credit totals before posting.

### JPR-004 — Traceability

Each journal line MUST retain:

- journal line ID;
- source document reference;
- inventory transaction reference;
- cost record/reference;
- item reference where applicable;
- Inventory Issue Type where applicable;
- Cost Component where applicable;
- debit or credit account;
- amount;
- posting status and journal number.

### JPR-005 — Historical mapping

A posted journal MUST preserve the account mapping used at posting time. Later
changes to master data MUST NOT silently rewrite it.

### JPR-006 — Configurable accounts

This specification defines account roles, not account numbers. Account numbers
MUST come from Entry configuration.

## 3. Approved inventory issue rule

### 3.1 General template

For every cost-bearing inventory issue:

```text
Debit:  account resolved from Inventory Issue Type
Credit: configured inventory account
Amount: issue quantity × Periodic Weighted Average Unit Cost
```

The Periodic Weighted Average Unit Cost is shared by Outbound and C2 for the
same item, costing scope, and period.

### 3.2 Destination examples

The following examples describe configurable destinations. They do not mandate
codes or account numbers.

#### Sale / COGS issue

```text
Dr  Configured Cost of Goods Sold account
Cr  Configured Inventory account
```

#### Administrative consumption

```text
Dr  Configured Administrative Expense account
Cr  Configured Inventory account
```

#### Production material issue

```text
Dr  Configured Production/WIP account
Cr  Configured Raw Material/Inventory account
```

#### Selling or marketing consumption

```text
Dr  Configured Selling/Marketing Expense account
Cr  Configured Inventory account
```

#### Loss, damage, or shrinkage

```text
Dr  Configured Loss/Expense account
Cr  Configured Inventory account
```

#### Project consumption

```text
Dr  Configured Project Cost account
Cr  Configured Inventory account
```

#### Capitalization

```text
Dr  Configured Capital Asset/Capital Work account
Cr  Configured Inventory account
```

Capitalization criteria and asset-module integration are open decisions; this
template only shows how an approved Issue Type could route an issue.

## 4. Issue aggregation and detail

### JPR-ISS-001

Multiple inventory issue transactions MAY be summarized into a journal only if
the report and audit model retain drill-down to every source transaction.

### JPR-ISS-002

Journal aggregation MUST NOT combine amounts that require different:

- debit accounts;
- credit accounts;
- legal entities;
- accounting periods;
- required accounting dimensions after those dimensions are approved.

### JPR-ISS-003

The sum of GL-bound issue amounts for an item and period MUST equal the item's
Outbound Amount in the Cost Ledger, subject only to an approved and separately
visible rounding rule.

### JPR-ISS-004

Issue-type breakdown totals MUST reconcile:

```text
Sum(Issue Type Qty)    = Outbound Qty
Sum(Issue Type Amount) = Outbound Amount
```

## 5. Receipt and inbound valuation

The approved functional principle is:

- an inventory receipt contributes quantity to Inbound;
- user-configured Cost Components may contribute to Inbound Amount;
- item-level Inbound Amount feeds the periodic weighted average;
- the corresponding GL-bound entries must be visible and traceable.

The generic Cost Component temporary-account and capitalization sequence is
approved. Specific GRNI, invoice-before-receipt, tax, currency, late-cost, and
price-difference rules remain open.

### JPR-IN-001 — Required inbound posting interface

The implementation MUST provide a posting interface that accepts:

- source document;
- item;
- Cost Component;
- Inbound Qty;
- item-level Inbound Amount;
- configured debit account role;
- configured credit account role;
- GL-bound status.

It MUST also carry a stable Business Object Type and Business Object ID for
temporary-account clearing and reconciliation.

### JPR-IN-002 — Cost source recognition

When a Cost Component source amount is recognized before item-level
capitalization, the GL-bound posting follows:

```text
Dr  Configured Cost Component temporary/clearing account
Cr  Configured source counter-account
```

For a supplier invoice the counter-account may be supplier payable, resolved
from configuration. This requirement does not approve a fixed account number.

### JPR-IN-003 — Item-level allocation/capitalization

When the recognized Cost Component amount is allocated to inventory or to a
production/WIP cost destination:

```text
Dr  Configured Inventory or Production/WIP destination
Cr  The same configured Cost Component temporary/clearing account
```

The debit amount MUST equal the sum of the item-level allocation lines linked
to that clearing line. Those item-level amounts feed Inbound Amount.

### JPR-IN-004 — Clearing identity

The source recognition and allocation/capitalization lines MUST be matched by:

```text
Temporary/Clearing Account
+ Business Object Type
+ Business Object ID
+ Cost Component, where applicable
```

The business object may be a shipment, purchase order, goods receipt, supplier
invoice, landed-cost/allocation document, production order, or cost allocation
batch. The implementation MUST use the actual process object and MUST NOT clear
one object's balance against an unrelated object's balance merely because the
GL account totals net to zero.

### Open posting decisions for receipts

1. Goods receipt before supplier invoice (GRNI).
2. Supplier invoice before goods receipt (goods in transit/prepayment).
3. Tax recoverability and capitalization.
4. Receipt price difference.
5. Late cost invoice after inventory is partly or fully issued.
6. Prior-period landed-cost adjustment.
7. Foreign-currency recognition and exchange differences.

## 6. Cost component accounting

### JPR-CC-001

A Cost Component used in a posting MUST reference the user-configured component
master record.

### JPR-CC-002

The component must remain visible in subledger reporting even when multiple
components are summarized into a single inventory amount.

### JPR-CC-003

The posting engine MUST not assume that a component called Freight, Customs, or
Insurance always maps to a fixed account. The mapping must be configuration
driven.

### JPR-CC-004

If an amount is capitalized into inventory, the item-level allocated amount must
reconcile to the GL-bound capitalized amount.

### JPR-CC-005

Cost Component source recognition and inventory capitalization MUST use the
approved temporary/clearing pattern in JPR-IN-002 through JPR-IN-004.

## 7. Production accounting

### 7.1 Approved material issue

Material issued with an Inventory Issue Type mapped to production/WIP follows:

```text
Dr  Configured Production/WIP destination
Cr  Configured Raw Material/Inventory account
```

The amount uses Periodic Weighted Average.

### 7.2 Approved finished-good relationship

When a finished product's production cost has been approved by the future
production-cost rules, its receipt must be capable of contributing to:

- finished item Inbound Qty;
- finished item Inbound Amount;
- finished item periodic weighted average.

### 7.3 Unapproved production posting rules

Do not invent journal rules for:

- direct labor accrual or clearing;
- depreciation accrual or clearing;
- factory overhead pool;
- machine cost;
- utilities;
- WIP stage transfers;
- normal loss;
- abnormal loss;
- scrap;
- by-products and co-products;
- production variance;
- incomplete production;
- finished-goods completion clearing.

## 8. Transfers

Inventory transfers were discussed only as a future transaction category.

**Open Decision:** Define whether a transfer:

- has no P&L impact;
- changes costing scope;
- carries source cost;
- creates in-transit inventory;
- produces one or two journals;
- creates foreign-entity/intercompany entries.

No transfer accounting rule is approved by this document.

## 9. Returns, adjustments, and reversals

No final valuation/posting decisions were made for:

- sales returns;
- purchase returns;
- stock count surplus;
- stock count shortage;
- damaged stock;
- transaction cancellation;
- correction after period close;
- revaluation.

These workflows MUST remain blocked or explicitly marked unsupported until
approved. Claude Code must not reuse moving-average, original-invoice, current
average, or another rule by assumption.

## 10. Temporary and clearing accounts

The product owner identified the need to use and reconcile temporary accounts
for inventory/production costs. The previous discussion included possible
purchase, freight, customs, insurance, labor, depreciation, overhead, and WIP
clearing accounts.

Required behavior:

- GL-bound inventory/cost entries must show debit and credit accounts;
- Cost Component source recognition debits its configured temporary/clearing
  account and credits the configured source counter-account;
- item-level capitalization or production allocation debits configured
  inventory/production/WIP and credits the same temporary/clearing account;
- every clearing line must carry a Business Object Type and Business Object ID;
- unresolved temporary-account balances must be explainable by source
  document, business object, item allocation, and Cost Component;
- clearing must be traceable, not an unexplained net GL adjustment.

Configurable examples include purchase, freight, customs, insurance, broker,
labor, depreciation, overhead, production, and WIP clearing. These examples do
not create a mandatory closed account list.

Still open:

- exact account-role list for a specific organization;
- whether multiple Cost Components share one account;
- authorization and timing for partial allocation;
- aging presentation;
- approved residual/write-off treatment;
- automatic write-off behavior.

For each temporary/clearing account and business object:

```text
Opening + Increase - Allocated/Cleared = Ending
```

An Ending balance is not an error by itself, but it MUST be visible and
explainable. It MUST NOT be silently netted against another business object.

## 11. Posting statuses

The reporting requirement needs a visible distinction between an entry that is
not yet in GL and one that is posted.

Minimum neutral statuses:

- Not GL-bound;
- GL-bound / pending posting;
- Posted;
- Posting error.

These labels may be adapted to the existing Entry platform, but every
transaction must expose an unambiguous state and journal reference when posted.

An approval workflow such as Draft → Calculated → Approved → Posted was
suggested but not approved as accounting behavior.

## 12. Posting validation

Before posting an inventory issue, validate:

1. item and quantity exist;
2. costing period and scope are identifiable;
3. Periodic Weighted Average result exists;
4. Inventory Issue Type exists and is active for new transactions;
5. debit destination resolves;
6. inventory credit account resolves;
7. amount is calculated from the Cost Ledger;
8. source document and transaction references exist;
9. journal balances;
10. the record is not already posted.

If a validation fails, no partial silent posting is allowed.

## 13. Reconciliation controls

### JPR-REC-001 — Inventory issue reconciliation

```text
Cost Ledger Outbound Amount
=
Sum(GL-bound inventory issue credit amounts)
```

### JPR-REC-002 — Account destination reconciliation

```text
Sum(Outbound Amount by Inventory Issue Type)
=
Sum(GL-bound debit amount by resolved destination)
```

### JPR-REC-003 — Journal reconciliation

For posted entries:

```text
Subledger GL-bound Amount
=
Posted GL Amount linked to those subledger records
```

Differences must be displayed, not hidden through an automatic plug.

### JPR-REC-004 — Temporary-account reconciliation

For each configured temporary/clearing account and business object:

```text
Source-recognition amount
- Item-level allocated/cleared amount
= Remaining amount
```

The remaining amount MUST be traceable to its source document, Cost Component,
and business object.

## 14. Posting acceptance scenarios

### Scenario A — COGS and admin issues

Given one item has a period average of 10,000:

- sale issue: 100 units, Issue Type destination COGS;
- admin issue: 10 units, Issue Type destination Admin Expense.

Expected GL-bound lines:

```text
Dr COGS                 1,000,000
Cr Inventory            1,000,000

Dr Admin Expense          100,000
Cr Inventory              100,000
```

Expected Outbound:

```text
Qty    = 110
Amount = 1,100,000
```

The same item-period unit cost of 10,000 is used for both issues and C2.

### Scenario B — Production issue

Given a material item has a period average of 5,720 and 20 units are issued
with a production/WIP Issue Type:

```text
Dr Production/WIP       114,400
Cr Raw Material         114,400
```

The detail report exposes item, quantity, unit cost, amount, Issue Type,
accounts, source production document, and journal reference.

### Scenario C — Manual GL mismatch

Given a user posts an unrelated manual GL entry to the inventory account:

- Inventory Ledger quantities do not change;
- Cost Ledger values do not silently change;
- Inventory-to-GL reconciliation shows a difference;
- the difference is traceable to a GL entry without an inventory subledger
  reference.

### Scenario D — Cost Component clearing by business object

Given a freight Cost Component amount of 500,000 is recognized for shipment
`SH-001`:

```text
Dr Configured Freight Clearing       500,000
Cr Configured Supplier Payable       500,000
```

When 450,000 is allocated to items of `SH-001`:

```text
Dr Configured Inventory              450,000
Cr Configured Freight Clearing       450,000
```

Expected result:

- 450,000 is included in item-level Inbound Amount;
- `SH-001` has a visible 50,000 clearing residual;
- the 50,000 cannot be hidden by a balance from another shipment;
- source invoice, Cost Component, allocation lines, accounts, and journal
  references remain drillable.
