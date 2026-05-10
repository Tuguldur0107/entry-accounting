# Cross-module 03 — IFRS / IAS Standard Mapping

> **Зорилго:** 27 IAS/IFRS стандартыг — Entry-ийн module + 8-оронтой Segment3 account code + key journal template-уудтай map хийсэн master reference. **3 стандарт scope-аас хасагдсан** (V1.06): IFRS 3 (Business Combinations), IAS 33 (EPS), IFRS 8 (Operating Segments).

---

## 1. Scope coverage summary

| # | Standard | Mongolian | Module(s) | Status |
|---|----------|-----------|-----------|--------|
| 1 | IAS 1 | НББОУС 1 | GL, Reports | ✅ |
| 2 | IAS 2 | НББОУС 2 | Inventory, Cost, Mfg | ✅ |
| 3 | IAS 7 | НББОУС 7 | Cash, Reports | ✅ |
| 4 | IAS 8 | НББОУС 8 | GL | ✅ |
| 5 | IAS 10 | НББОУС 10 | GL | ✅ (Events after period) |
| 6 | IAS 12 | НББОУС 12 | Tax, FA | ✅ Deferred tax |
| 7 | IAS 16 | НББОУС 16 | FA | ✅ |
| 8 | IAS 19 | НББОУС 19 | Payroll | ✅ Short-term benefits |
| 9 | IAS 20 | НББОУС 20 | GL | ⚠ Out of immediate scope (gov grants, rare) |
| 10 | IAS 21 | НББОУС 21 | Cash, AR, AP | ✅ FX |
| 11 | IAS 23 | НББОУС 23 | AP, FA | ✅ Borrowing costs (capitalize) |
| 12 | IAS 24 | НББОУС 24 | AGIS, Reports | ✅ Related parties |
| 13 | IAS 26 | НББОУС 26 | — | ✗ Out of scope (retirement plans) |
| 14 | IAS 27 | НББОУС 27 | Reports | ✅ Separate F/S |
| 15 | IAS 28 | НББОУС 28 | Reports | ✅ Equity method |
| 16 | IAS 29 | НББОУС 29 | — | ✗ Out of scope (hyperinflation, MN currency stable) |
| 17 | IAS 32 | НББОУС 32 | Cash, AR | ⚠ Partial (instrument classification) |
| 18 | IAS 33 | НББОУС 33 | — | ✗ **Out of scope V1.06** (EPS) |
| 19 | IAS 34 | НББОУС 34 | Reports | ⚠ Partial (interim reporting) |
| 20 | IAS 36 | НББОУС 36 | FA | ✅ Impairment |
| 21 | IAS 37 | НББОУС 37 | GL | ✅ Provisions |
| 22 | IAS 38 | НББОУС 38 | FA | ⚠ Partial (intangibles via FA category) |
| 23 | IAS 40 | НББОУС 40 | — | ✗ Out of scope V1.06 (Investment property) |
| 24 | IAS 41 | НББОУС 41 | — | ✗ Out of scope (Agriculture) |
| 25 | IFRS 1 | СТОУС 1 | GL | ⚠ One-time on adoption |
| 26 | IFRS 2 | СТОУС 2 | — | ✗ Out of scope (Share-based payments) |
| 27 | IFRS 3 | СТОУС 3 | — | ✗ **Out of scope V1.06** (Business Combinations) |
| 28 | IFRS 5 | СТОУС 5 | FA | ✅ Held-for-sale |
| 29 | IFRS 7 | СТОУС 7 | Cash, AR | ⚠ Partial (FI disclosures) |
| 30 | IFRS 8 | СТОУС 8 | — | ✗ **Out of scope V1.06** (Operating Segments) |
| 31 | IFRS 9 | СТОУС 9 | AR, Cash | ✅ ECL + classification |
| 32 | IFRS 10 | СТОУС 10 | Reports, AGIS | ✅ Consolidation |
| 33 | IFRS 11 | СТОУС 11 | Reports | ⚠ Joint arrangements (via Equity method) |
| 34 | IFRS 13 | СТОУС 13 | FA | ✅ Fair value |
| 35 | IFRS 15 | СТОУС 15 | AR, POS | ✅ Revenue |
| 36 | IFRS 16 | СТОУС 16 | FA | ✅ Leases |

**Total covered:** 27 standards (✅ + ⚠) | **Excluded:** IFRS 3, IAS 33, IFRS 8

---

## 2. Standard → Module → Account → Journal mapping

### 2.1 IAS 1 — Presentation of Financial Statements

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Accrual basis | IAS 1.27 | GL, all | All journals follow accrual |
| Period concept | IAS 1.36 | GL | `gl_periods` |
| BS structure | IAS 1.54 | Reports | `balance-sheet` endpoint |
| Current vs non-current | IAS 1.66 | Reports | Account ranges 1xxx/2xxx |
| P&L by function | IAS 1.99 | Reports | `income-statement` endpoint |

### 2.2 IAS 2 — Inventories

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Cost recognition | IAS 2.10 | Inv, AP | `14000001` Inventory |
| Conversion costs | IAS 2.12 | Cost, Mfg | `60000002/3` DL/MOH |
| Normal capacity allocation | IAS 2.13 | Mfg | Allocation rules |
| Abnormal waste | **IAS 2.16** | Mfg | `60000005` Scrap → P&L |
| FIFO/Avg permitted | IAS 2.25 | Inv | `cost_method` |
| NRV write-down | **IAS 2.9, 28-33** | Inv | `87100005` NRV write-down |
| Standard cost | IAS 2.21 | Mfg | `standard_unit_cost` |

### 2.3 IAS 7 — Cash Flow Statement

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Cash & equivalents | IAS 7.6 | Cash | `bank_accounts` |
| Direct method | IAS 7.18 | Cash, Reports | `/cash-reports/cash-flow` |
| Indirect method | IAS 7.20 | Reports | `/cash-flow-indirect` |
| Activity classification | IAS 7.10-17 | Cash | `activity_type` field |

### 2.4 IAS 8 — Accounting Policies, Estimates, Errors

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Prior period error | **IAS 8.41-49** | GL | `adjustment_type='prior_period'`, `gl_prior_period_adjustments` |
| Retrospective restatement | IAS 8.42 | GL | Retained earnings (`44000001`) adjustment |
| Estimate change | IAS 8.32 | FA | Prospective (e.g., useful life change) |

### 2.5 IAS 10 — Events After Reporting Period

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Adjusting events | IAS 10.8 | GL | Manual journal in current period |
| Non-adjusting events | IAS 10.10 | Reports | Disclosure only |

### 2.6 IAS 12 — Income Taxes

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Current tax | IAS 12.46 | Tax | `70000004` CIT exp / `31000003` CIT payable |
| Deferred tax | **IAS 12.15-45** | Tax | `26000001` DTA / `33000002` DTL |
| Temporary differences | IAS 12.5 | Tax, FA | Book NBV vs Tax NBV |
| DTA recognition | IAS 12.24-31 | Tax | Probable future profit |
| Effective rate disclosure | IAS 12.79-88 | Reports | Annual disclosure |

### 2.7 IAS 16 — Property, Plant and Equipment

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Initial recognition | **IAS 16.7-22** | FA | `21010000` Asset cost |
| Depreciation methods | IAS 16.62 | FA | SL/DB/DDB/Units (`fa_assets.depreciation_method`) |
| Useful life | IAS 16.51 | FA | `useful_life_months` |
| Revaluation model | IAS 16.31 | FA | `42000001` Revaluation reserve (OCI) |
| Disposal | IAS 16.67-72 | FA | Multi-line journal |

### 2.8 IAS 19 — Employee Benefits

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Short-term benefits | **IAS 19.5-22** | Payroll | `72100000` Salary expense |
| Pension contributions (DC plan) | IAS 19.51 | Payroll | НДШ portion |
| Accrued leave / bonus | IAS 19.11 | GL | Accrual journal |
| Termination benefits | IAS 19.165 | Payroll | Final pay run |

### 2.9 IAS 21 — Foreign Exchange

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Functional currency | IAS 21.9 | All | MNT (default) |
| Initial recognition | IAS 21.21 | All | Spot rate at txn date |
| Monetary item revaluation | **IAS 21.23, 28-29** | Cash | `last_reval_rate` snapshot |
| FX gain/loss | IAS 21.32 | Cash | `87000003` FX (loss) / `51800001` FX gain |
| Translation (foreign sub) | IAS 21.39 | Reports | TBD V1.07 |

### 2.10 IAS 23 — Borrowing Costs

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Capitalization | **IAS 23.8** | FA | Self-constructed asset interest cap |
| Active development period | IAS 23.20 | FA | Period-bound |

### 2.11 IAS 24 — Related Party Disclosures

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Related party identification | IAS 24.9 | AGIS | `from_company` + `to_company` |
| Disclosure | IAS 24.18 | Reports | Annual disclosure |

### 2.12 IAS 27 — Separate Financial Statements

Single-company presentation. Used for parent's separate F/S in addition to consolidated.

### 2.13 IAS 28 — Investments in Associates

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Equity method | **IAS 28.10-12** | Reports | `25000001` Investment + `51800007` Share of profit |
| Impairment | IAS 28.40-43 | Reports | `87000002` Impairment loss |

### 2.14 IAS 32 — Financial Instruments: Presentation

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Instrument classification | IAS 32.11 | Cash, AR | Per-instrument analysis |

### 2.15 IAS 36 — Impairment of Assets

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Recoverable amount | **IAS 36.59** | FA | `MAX(FVLCD, VIU)` |
| Loss recognition | IAS 36.60 | FA | `87000002` / `20000002` |
| Reversal limit | **IAS 36.117** | FA | Cannot exceed pre-impairment carrying |

### 2.16 IAS 37 — Provisions, Contingent Liabilities, Contingent Assets

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Provision recognition | **IAS 37.14** | GL | `Dr Expense / Cr 31900001 Provision` |
| Best estimate | IAS 37.36 | GL | Recompute periodically |
| Contingent liability | IAS 37.27 | Reports | Disclosure only |

### 2.17 IAS 38 — Intangible Assets

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Recognition criteria | IAS 38.21 | FA | `tax_category='intangible'` |
| Amortization | IAS 38.97 | FA | Standard depreciation |

### 2.18 IFRS 5 — Non-current Assets Held for Sale

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Classification | **IFRS 5.6-14** | FA | `held_for_sale=true` flag |
| Measurement | IFRS 5.15 | FA | Lower of carrying & FVLCD |
| Reclassify | FA | `29000001` HFS asset; depreciation pause |

### 2.19 IFRS 7 — Financial Instruments: Disclosures

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Risk disclosure | IFRS 7.7 | Reports | Notes section (TBD detailed) |

### 2.20 IFRS 9 — Financial Instruments

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Classification | IFRS 9.4.1 | Cash, AR | Amortized cost (default) |
| AR initial | IFRS 9.5.1 | AR | Bodit unэ tsenээr |
| Subsequent | IFRS 9.5.2 | AR | Amortized cost |
| **ECL simplified approach** | **IFRS 9.5.5.15** | AR | Provision matrix (`ar_ecl_matrix`) |
| Lifetime ECL | IFRS 9 Annex A | AR | Per-invoice |
| Write-off | IFRS 9.5.4.4 | AR | Direct write-off when no recovery |

### 2.21 IFRS 10 — Consolidated Financial Statements

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Control criteria | IFRS 10.7 | Reports | `consolidation_groups.parent_company_id` |
| Eliminate intra-group | **IFRS 10.B86** | AGIS | Auto-pull eliminations |
| NCI | IFRS 10.22 | Reports | Separate equity line |
| Unrealized profit | IFRS 10.B86c | AGIS, Inv | TBD inventory hold |

### 2.22 IFRS 11 — Joint Arrangements

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Joint operations | IFRS 11.20 | Reports | Proportionate consol (TBD) |
| Joint ventures | IFRS 11.24 | Reports | Equity method |

### 2.23 IFRS 13 — Fair Value Measurement

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Hierarchy (L1/L2/L3) | **IFRS 13.72-90** | FA | `fair_value_level` |
| Technique | IFRS 13.61 | FA | `fair_value_technique` |
| Reval frequency | IAS 16.31 | FA | Annual or per indicator |

### 2.24 IFRS 15 — Revenue from Contracts with Customers

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| 5-step model | **IFRS 15.31-38** | AR, POS | Standard sale flow |
| Variable consideration | IFRS 15.50-58 | AR | Discount, rebate constraint |
| Significant financing | IFRS 15.60-65 | AR | PV adjustment > 12 months |
| Contract liability | IFRS 15.106 | Wallet | `31600001` Wallet liability |

### 2.25 IFRS 16 — Leases

| Aspect | Reference | Module | Account / Journal |
|--------|-----------|--------|-------------------|
| Lessee single model | **IFRS 16.22-26** | FA | ROU asset + lease liability |
| Short-term exemption | IFRS 16.5 | FA | `lease_type='short_term'` |
| Discount rate | IFRS 16.26 | FA | IBR (incremental borrowing rate) |

---

## 3. Excluded standards (V1.06)

### 3.1 IFRS 3 — Business Combinations

**Reason:** Highly complex (acquirer identification, fair value of identifiable net assets, goodwill calc); rare for Mongolian SME; reserved for V1.07+.

UI placeholder: `/modules/reports/business-combinations`

### 3.2 IAS 33 — Earnings Per Share

**Reason:** Public listed companies (TSE-listed) only; Entry target SME private. UI placeholder: `/modules/reports/eps`.

### 3.3 IFRS 8 — Operating Segments

**Reason:** Public listed companies only. UI placeholder: `/modules/reports/segments` (different from `segment2_cost_center` data, which is internal management).

---

## 4. Account code → IFRS standard cross-reference

For when picking an account, identify which IFRS standard it relates to:

| Account | Standards |
|---------|-----------|
| `13110000` AR | IFRS 9, IFRS 15 |
| `12000099` AR Allowance | IFRS 9 (ECL) |
| `14000001` Inventory | IAS 2 |
| `14000003` WIP | IAS 2 (conversion costs) |
| `14000004` FG | IAS 2 |
| `14000099` Landed cost clearing | IAS 2 (capitalization) |
| `20000001` ROU asset | IFRS 16 |
| `21010000` Asset cost | IAS 16 |
| `21000099` Accum dep | IAS 16, IAS 38 |
| `25000001` Investment in associate | IAS 28 |
| `26000001` DTA | IAS 12 |
| `29000001` HFS asset | IFRS 5 |
| `31000001` AP | IFRS 9 |
| `31000003` Multi-tax payable | Mongolian tax law |
| `31420000` НДШ | IAS 19 + Mongolian tax |
| `31430000` ХХОАТ | IAS 19 + Mongolian tax |
| `33000001` Lease liability | IFRS 16 |
| `33000002` DTL | IAS 12 |
| `42000001` Revaluation reserve | IFRS 13 (OCI) |
| `44000001` Retained earnings | IAS 1 |
| `44000099` Income summary | (closing convention) |
| `51100000` Revenue | IFRS 15 |
| `51800001` Unrealized FX gain | IAS 21 |
| `51800005` IC revenue | IFRS 10 (eliminate on consol) |
| `51800007` Share of associate profit | IAS 28 |
| `60000005` Production scrap | IAS 2.16 |
| `61100000` COGS | IAS 2.34 |
| `70000001` Depreciation expense | IAS 16 |
| `70000002` ROU dep | IFRS 16 |
| `70000004` CIT/Deferred tax | IAS 12 |
| `87000001` Lease interest | IFRS 16 |
| `87000002` Impairment loss | IAS 36, IFRS 5, IFRS 9 |
| `87000003` FX | IAS 21 |
| `87100005` NRV write-down | IAS 2.9 |

---

## 5. Mongolian standard alignment (НББОУС)

**Mongolian National Accounting Standards (НББОУС)** нь **IFRS-тэй бүрэн нийцэх** policy 2014 оноос. Practical differences:

- Tax norms (ААНОАТ-ийн hugatsaa) — Mongolian Tax Law-аас (FA module-д tax_useful_life_months)
- НӨАТ rate (10%) — Mongolian VAT Law
- НДШ/ЭМД rates — Mongolian Social Insurance Law
- ХХОАТ brackets — Mongolian Income Tax Law

> Entry нь IFRS-аар primary; tax compliance Mongolian law-аар secondary (deferred tax-аар reconcile).

---

## 6. Implementation status per standard

| Status | Meaning |
|--------|---------|
| ✅ | Fully implemented (computation, GL post, UI, reports) |
| ⚠ | Partial (data captured, full disclosure not automated) |
| ✗ | Out of scope V1.06 |

---

## 7. Knowledge file references

`knowledge/01-онол-хууль-стандарт/ifrs/` дотор тус бүр стандартын дэлгэрэнгүй файл:

- `ias-1-presentation.md`
- `ias-2-inventories.md`
- `ias-7-cash-flow.md`
- `ias-8-policies-errors.md`
- `ias-12-income-taxes.md`
- `ias-16-property-plant-equipment.md`
- `ias-19-employee-benefits.md`
- `ias-21-foreign-exchange.md`
- `ias-23-borrowing-costs.md`
- `ias-24-related-parties.md`
- `ias-28-equity-method.md`
- `ias-36-impairment.md`
- `ias-37-provisions.md`
- `ifrs-5-held-for-sale.md`
- `ifrs-9-financial-instruments.md`
- `ifrs-10-consolidation.md`
- `ifrs-13-fair-value.md`
- `ifrs-15-revenue.md`
- `ifrs-16-leases.md`

> **Access for AI agents:** `get_skill('ifrs:<standard-id>')` tool retrieves content (used by `expert_accountant`).

---

## 8. IFRS standards × сегментийн disclosure tie

Зарим IFRS стандартууд нь journal-аас ангид **note disclosure**-ыг шаарддаг — эдгээр note нь `journal_entry_lines.s1..s10` сегмент-аас directly group/filter хийгдэн generate болно.

| IFRS / IAS | Disclosure хэрэгцээ | Гол сегмент | Нэлээд disclosure хэлбэр |
|------------|---------------------|-------------|--------------------------|
| **IAS 7** Cash Flow Statement | Direct CF Operating/Investing/Financing | **s8 cash_flow** | Cash line-уудыг s8-аар group → 3 ангилал |
| **IAS 24** Related Party Disclosures | RP transaction volume + balance + relationship | **s7 related_party** | RP filter → group by entity → balance + transaction count |
| **IFRS 10** Consolidated Financial Statements | IC elimination matrix | **s1 + s6** | IC counterpart pair (s1, s6 swap) reciprocal balance |
| **IAS 28** Equity Method | Associate investment + share of profit | **s1 + s3 (25xxxx)** | Associate company-уудын profit share |
| **IFRS 8** Operating Segments (excluded V1.06) | Segment revenue, expense, asset | s4 product / s5 project | TBD V2.0 |
| **IAS 36** Impairment | CGU-level impairment loss | s2 cost_center (CGU proxy) | CGU = cost center by default |
| **IFRS 15** Revenue Disaggregation | Product type × geography × timing | s4 product + s5 project | Product/service revenue split |

**Note disclosure SQL pattern:**

```sql
-- IAS 24 Related Party note (sample)
SELECT rp.name AS related_party,
       rp.relationship_type,
       SUM(CASE WHEN je.transaction_date BETWEEN :year_start AND :year_end THEN jel.dr - jel.cr ELSE 0 END) AS net_balance_change,
       COUNT(DISTINCT je.id) AS transaction_count
FROM journal_entry_lines jel
JOIN journal_entries je ON jel.journal_entry_id = je.id
JOIN segment7_related_party rp ON rp.code = jel.s7 AND rp.tenant_id = je.tenant_id
WHERE jel.s7 != '0000'
  AND je.period_id BETWEEN :start_period AND :end_period
GROUP BY rp.code, rp.name, rp.relationship_type
ORDER BY ABS(net_balance_change) DESC;
```

**IFRS 10 IC elimination journal rule:**

```sql
-- Find reciprocal IC balances for elimination
SELECT a.s1 AS company_a, b.s1 AS company_b,
       a.s3 AS account,
       SUM(a.dr - a.cr) AS a_balance,
       SUM(b.dr - b.cr) AS b_balance
FROM journal_entry_lines a
JOIN journal_entry_lines b ON a.s1 = b.s6 AND a.s6 = b.s1 AND a.s3 = b.s3
WHERE a.s9 = '09' AND b.s9 = '09'  -- AGIS module only
GROUP BY a.s1, b.s1, a.s3
HAVING ABS(SUM(a.dr - a.cr) + SUM(b.dr - b.cr)) > 0.01;  -- mismatch detection
```

---

## Холбоотой баримт

- [Cross-module: GL Posting Matrix](./01-gl-posting-matrix.md)
- [Cross-module: Period Close](./02-period-close.md)
- [Cross-module: Tax Mapping](./04-tax-mapping.md)
- [Architecture: Segment strategy](../01-architecture/07-segment-strategy.md) — §7.8 reporting layer
- [/ifrs skill](../knowledge/04-ai-agent/skills/ifrs/SKILL.md)
- [Knowledge base](../../knowledge/01-онол-хууль-стандарт/ifrs/)
