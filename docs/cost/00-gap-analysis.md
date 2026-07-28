# Entry Inventory Costing — Gap Analysis

**Audit date:** 2026-07-28  
**Compared source:** previously generated `entry-inventory-costing-docs` package  
**Comparison authority:** approved decisions in the referenced product-owner
conversation and the fixed decisions in the correction request  
**Status legend:** Present = correct and complete; Partial = present but
insufficient; Missing = absent; Incorrect = contradicts or weakens an approved
decision

## 1. Executive result

The original package captured the core architecture and most report/account
routing decisions. It was not safe to treat as the final Claude Code
implementation baseline because three approved requirements were weakened:

1. the Periodic Weighted Average formulas were present, but the complete
   mandatory processing sequence was not stated consistently in every
   implementation-facing file;
2. Running Qty and Running Amount in the transaction detail report were made
   optional/open instead of mandatory;
3. temporary/clearing account processing and business-object reconciliation
   were described as future/open instead of required.

The corrected package resolves those gaps without selecting an unapproved
rounding rule, negative-stock rule, backdated recalculation rule, returns rule,
GRNI rule, tax rule, foreign-currency rule, production-overhead allocation
rule, or fixed chart of accounts.

## 2. Detailed decision checklist

| # | Approved decision | Original status | Original evidence | Gap or error | Corrected location |
|---:|---|---|---|---|---|
| 1 | Version 1 uses Periodic Weighted Average only | Present | `01-functional-specification.md:35,71-77`; `CLAUDE.md:14-15` | None | Preserved in all files |
| 2 | FIFO, moving average, LIFO, and standard cost are excluded | Present | `01-functional-specification.md:52-55,76-77` | None | Preserved |
| 3 | C1, Inbound, Outbound, C2 are the four fixed cost groups | Present | `01-functional-specification.md:37-40`; `03-report-specifications.md:46-48` | None | Preserved |
| 4 | Each group has real Qty / Unit Cost / Amount subheaders | Present | `03-report-specifications.md:46-52`; `01-functional-specification.md:789-802` | None | Preserved |
| 5 | Three meaningful unit costs exist: C1, Inbound, shared Outbound/C2 | Present | `01-functional-specification.md:188-195` | None | Preserved and reinforced |
| 6 | C1 Unit Cost = C1 Amount / C1 Qty | Present | `01-functional-specification.md:174-178` | Formula existed but appeared after the main calculation instead of as Step 1 | Moved into mandatory Step 1 |
| 7 | Inbound Qty and Amount are aggregated for the period | Partial | `01-functional-specification.md:143,414-430`; `03-report-specifications.md:64-66` | Aggregation was implied, not stated as an explicit processing step | Mandatory Step 2 now states the sums |
| 8 | Inbound Unit Cost = Inbound Amount / Inbound Qty | Present | `01-functional-specification.md:168-172` | Formula existed but sequence was not explicit | Moved into mandatory Step 2 |
| 9 | Goods Available Qty = C1 Qty + Inbound Qty | Present | `01-functional-specification.md:151-153` | Named `Available`, but processing sequence was incomplete | Mandatory Step 3 names Goods Available |
| 10 | Goods Available Amount = C1 Amount + Inbound Amount | Present | `01-functional-specification.md:151-153` | Same sequencing gap | Mandatory Step 3 |
| 11 | Periodic Average = Goods Available Amount / Goods Available Qty | Present | `01-functional-specification.md:155-156`; `03-report-specifications.md:76-81` | Correct formula, but not explicitly identified as one item-period calculation that must not refresh per transaction | Mandatory Step 4 adds that constraint |
| 12 | Outbound Qty is total period issue quantity | Partial | `01-functional-specification.md:144`; `03-report-specifications.md:67` | Total-period aggregation was not a numbered calculation step | Mandatory Step 5 |
| 13 | Every item-period issue uses the same periodic unit cost | Present | `01-functional-specification.md:182-195,746-752` | None | Preserved and linked to Issue Type behavior |
| 14 | Outbound Amount = Outbound Qty × Periodic Average | Present | `01-functional-specification.md:158-159` | None | Mandatory Step 5 |
| 15 | C2 Qty = Goods Available Qty − Outbound Qty | Present | `01-functional-specification.md:161-162` | None | Mandatory Step 6 |
| 16 | C2 Unit Cost = Outbound Unit Cost = Periodic Average | Present | `01-functional-specification.md:180-186`; `03-report-specifications.md:68-72,83-85` | None | Mandatory Step 6 and explicit equality |
| 17 | C2 Amount = C2 Qty × Periodic Average | Present | `01-functional-specification.md:164-165` | None | Mandatory Step 6 |
| 18 | Quantity control equation is mandatory | Present | `01-functional-specification.md:197-203` | None | Mandatory Step 7 |
| 19 | Amount control equation is mandatory | Present | `01-functional-specification.md:205-215` | None; rounding remains correctly open | Mandatory Step 7 |
| 20 | Periodic calculation sequence is exact and implementation-facing | Missing | Formulas existed at `01-functional-specification.md:147-178`, but no complete C1 → Inbound → Goods Available → Average → Outbound → C2 → controls sequence | Claude Code could implement only the formulas it noticed and omit lineage/order controls | Added to functional spec, report spec, and `CLAUDE.md` |
| 21 | Cost Component is user-configurable master data | Present | `01-functional-specification.md:274-311` | None | Preserved |
| 22 | Cost Component list is not hardcoded | Present | `01-functional-specification.md:282-286,483-490` | None | Preserved |
| 23 | Item-level component amounts form Inbound Amount and retain source lineage | Present | `01-functional-specification.md:454-479,492-496` | None | Preserved and linked to clearing |
| 24 | Allocation bases are not to be invented | Present | `01-functional-specification.md:464-468` | None | Preserved as open |
| 25 | Inventory Issue Type is configurable master data | Present | `01-functional-specification.md:311-352` | None | Preserved |
| 26 | Issue Type determines debit destination; inventory configuration resolves credit account | Present | `01-functional-specification.md:331-350`; `02-journal-posting-rules.md:59-127` | None | Preserved |
| 27 | Issue destinations include COGS, administrative expense, production/WIP, selling/other configured outcomes | Present | `01-functional-specification.md:317-328`; `02-journal-posting-rules.md:72-127` | None | Preserved |
| 28 | Issue Type changes destination, not periodic unit cost | Present | `01-functional-specification.md:744-752`; `02-journal-posting-rules.md:390-427` | None | Reinforced in Step 5 |
| 29 | Temporary/clearing accounts are part of the required architecture | Incorrect | `01-functional-specification.md:58` called the exact lifecycle unapproved; `02-journal-posting-rules.md:299-321` made implementation conditional; `03-report-specifications.md:453-458` made the report future/conditional | Contradicted the approved requirement to receive cost into its configured temporary account and clear it into inventory/production | Added mandatory configurable clearing flow |
| 30 | Cost source recognition uses a configured component clearing role | Missing | No mandatory posting template; `02-journal-posting-rules.md:223-225` said the exact clearing rule was open | Claude Code had no required source-recognition behavior | Added `Dr Component Clearing / Cr configured source counter-account` |
| 31 | Item allocation clears the same temporary role into inventory | Missing | No mandatory posting template | Capitalization and clearing could be disconnected | Added `Dr Inventory / Cr same Component Clearing` |
| 32 | Temporary accounts reconcile by business object, not only GL total | Incorrect | `03-report-specifications.md:481-483` listed the matching object itself as open | The conversation approved reconciliation by shipment/PO/receipt/invoice/landed-cost/production/allocation object | Business Object Type + Business Object ID are now mandatory |
| 33 | Unrelated objects must not be netted together | Present but weak | `03-report-specifications.md:474-477` prohibited unrelated-document netting | Correct control existed but lacked a mandatory matching key | Preserved and made enforceable through the business-object key |
| 34 | Clearing residuals remain visible and explainable | Partial | `02-journal-posting-rules.md:308-311`; `03-report-specifications.md:464-472` | Required only “when implemented” | Now mandatory; automatic write-off remains open |
| 35 | Inventory Transaction Detail Report with Cost & Account includes every receipt and issue | Present | `03-report-specifications.md:185-204` | None | Preserved |
| 36 | Detail report shows source document, item, cost, Dr/Cr accounts, GL status, and journal | Present | `03-report-specifications.md:206-237,253-266,319-328` | None | Preserved |
| 37 | Detail report exposes GL-bound records before and after posting, including errors | Present | `03-report-specifications.md:193-204,319-328` | None | Preserved |
| 38 | Detail report supports account filters and ties item detail to GL-bound postings | Present | `03-report-specifications.md:268-289,306-335` | None | Preserved |
| 39 | Running Qty and Running Amount are required | Incorrect | `03-report-specifications.md:239-251` used `SHOULD` and marked ordering/behavior open | The fixed decision explicitly requires both | Changed to MUST and added periodic-report formulas |
| 40 | Running balances must not introduce moving-average semantics | Present | `03-report-specifications.md:246-248` | Correct warning but no permitted periodic formula | Preserved; now Running Amount uses actual inbound amounts and the one period cost for issues |
| 41 | Final Running Qty/Amount reconcile to C2 | Missing | No acceptance test | Report could end with values inconsistent with control report | Added mandatory final-row reconciliation |
| 42 | Inventory Ledger and Cost Ledger are source of truth | Present | `01-functional-specification.md:79-88,373-445`; `03-report-specifications.md:10-23` | None | Preserved |
| 43 | GL is generated output and not a cost-calculation source | Present | `01-functional-specification.md:84-88,256-270`; `CLAUDE.md:29-31` | None | Preserved |
| 44 | Manual GL changes do not rewrite inventory/cost ledgers | Present | `03-report-specifications.md:447-451`; `01-functional-specification.md:778-787` | None | Preserved |
| 45 | Inventory-to-GL reconciliation exposes differences | Present | `03-report-specifications.md:386-451` | None | Preserved |
| 46 | Do not introduce unapproved accounting logic | Present | `CLAUDE.md:35-49`; functional-spec open-decision table | Some approved clearing requirements were mistakenly placed in the open list | Open list narrowed; genuinely unresolved rules remain open |

## 3. Corrected Periodic Weighted Average method

The corrected files now use this exact item-period sequence:

```text
1. C1
   C1 Unit Cost = C1 Amount / C1 Qty

2. Inbound
   Inbound Qty    = sum of eligible receipt quantities
   Inbound Amount = sum of eligible item-level inbound amounts
   Inbound Unit Cost = Inbound Amount / Inbound Qty

3. Goods Available
   Goods Available Qty    = C1 Qty + Inbound Qty
   Goods Available Amount = C1 Amount + Inbound Amount

4. Periodic Weighted Average
   PWA Unit Cost =
       Goods Available Amount / Goods Available Qty

5. Outbound
   Outbound Qty       = sum of issue quantities
   Outbound Unit Cost = PWA Unit Cost
   Outbound Amount    = Outbound Qty × Outbound Unit Cost

6. C2
   C2 Qty       = Goods Available Qty - Outbound Qty
   C2 Unit Cost = PWA Unit Cost
   C2 Amount    = C2 Qty × C2 Unit Cost

7. Controls
   C1 Qty + Inbound Qty = Outbound Qty + C2 Qty
   C1 Amount + Inbound Amount = Outbound Amount + C2 Amount
```

Division-by-zero behavior, decimal precision, and rounding residual treatment
remain open. The corrected specification prohibits silently inventing them.

## 4. Corrected temporary/clearing invariant

The corrected files approve only the invariant already decided, while leaving
organization-specific choices configurable:

```text
Cost source recognition
Dr Configured Cost Component temporary/clearing account
Cr Configured source counter-account

Item-level allocation/capitalization
Dr Configured Inventory or Production/WIP destination
Cr The same Cost Component temporary/clearing account
```

Matching is mandatory by:

```text
Temporary/Clearing Account
+ Business Object Type
+ Business Object ID
+ Cost Component, where applicable
```

The exact account numbers, exact organization-specific role list, GRNI,
invoice-before-receipt, tax capitalization, currency, late-cost revaluation,
partial-clearing authority, aging, and residual write-off policy remain open.

## 5. Files corrected

| File | Correction |
|---|---|
| `01-functional-specification.md` | Added exact seven-step costing sequence; made clearing and business-object reconciliation mandatory; added acceptance criteria |
| `02-journal-posting-rules.md` | Added required configurable source-recognition and capitalization templates; added clearing identity and reconciliation scenario |
| `03-report-specifications.md` | Added full formulas; made Running Qty/Amount mandatory; defined periodic running logic; made temporary-account report mandatory |
| `CLAUDE.md` | Added non-negotiable full calculation sequence, running-balance behavior, clearing pattern, and tests |
| `README.md` | Updated package decision summary and removed the incorrect statement that the clearing workflow is wholly unapproved |

## 6. Intentionally still open

The corrected package does not decide:

- costing scope by legal entity/site/warehouse;
- period close/reopen workflow;
- precision and rounding;
- zero or negative quantity behavior;
- negative stock;
- backdated transactions;
- returns, cancellations, corrections, and revaluation;
- detailed GRNI and invoice-before-receipt flows;
- tax capitalization and recoverability;
- foreign currency;
- transfer accounting;
- stock adjustments;
- production overhead, scrap, by-product, and variance rules;
- allocation-basis defaults and residual allocation;
- fixed account numbers;
- automatic temporary-account write-off.

These exclusions prevent Claude Code from embedding an unapproved accounting
policy.
