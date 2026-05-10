# Cross-module 04 — Mongolian Tax Mapping

> **Зорилго:** Монгол улсын татварын төрөл бүрийг — module + GL account code + filing schedule + journal template-уудтай map хийсэн master reference. Entry-ийн `tax_settings` key-value store-той тулгасан.

---

## 1. Tax types overview

| Type | Mongolian | Rate | Frequency | Module(s) | Filing form |
|------|-----------|------|-----------|-----------|-------------|
| **VAT** | НӨАТ | 10% | Monthly | AR, AP, POS, Tax | TT-01 |
| **CIT** | ААНОАТ | 10% / 25% (tier) | Quarterly + Annual | Tax | ААНОАТ Q1-Q4 / annual |
| **PIT** | ХХОАТ | 10/15/20% (progressive) | Monthly | Payroll, Tax | ХХОАТ-26-XX |
| **SI (Pension)** | НДШ — Тэтгэвэр | 8.5% / 8.5% | Monthly | Payroll | НДШ-26-XX-001 |
| **SI (Benefit)** | НДШ — Тэтгэмж | 0.8% / 1% | Monthly | Payroll | (Same) |
| **SI (Unemployment)** | НДШ — Ажилгүйдэл | 0.2% / 0.2% | Monthly | Payroll | (Same) |
| **HI** | ЭМД | 2% / 2% | Monthly | Payroll | (Same) |
| **Accident** | ҮОМШӨ | – / 0.8% | Monthly | Payroll | (Same) |
| **WHT (resident)** | Суутган татвар (оршин суугч) | 10% | Per AP invoice | AP, Tax | WHT certificate |
| **WHT (non-resident)** | Суутган татвар (оршин суугч бус) | 20% | Per AP invoice | AP, Tax | (Same) |
| **Excise** | НХАТ | (per item) | Quarterly | TBD V1.07 | НХАТ-Q |
| **Property tax** | Үл хөдлөх | (per asset) | Annual | (out of scope) | Manual |

---

## 2. Tax → tax_settings → GL account mapping

### 2.1 НӨАТ (VAT)

| `tax_settings` key | Default value | Purpose |
|---------------------|---------------|---------|
| `vat_rate` | `10` | VAT rate (%) |
| `vat_enabled` | `true` | Toggle |
| `default_vat_mode` | `exclusive` | none / exclusive / inclusive |
| `gl_vat_output_account` | `31000003` | Sales VAT (liability) |
| `gl_vat_input_account` | `12000002` | Purchase VAT (asset) |
| `gl_vat_bank_payment` | `11000001` | Settlement bank account |

**Journal templates:**

| Trigger | Account | Dr | Cr |
|---------|---------|---:|---:|
| AR sale | `31000003` VAT output | – | vat_amount |
| AP purchase | `12000002` VAT input | vat_amount | – |
| Monthly settlement | `31000003` (clear output) | output_vat | – |
| | `12000002` (clear input) | – | input_vat |
| | `31000003` (net payable) | – | net_payable |

**Filing:** TT-01 monthly (deadline: 10th of next month)
**Idempotency:** UNIQUE `(tenant_id, company_id, period_year, period_month)` on `vat_filings`

### 2.2 ААНОАТ (CIT)

| `tax_settings` key | Default value | Purpose |
|---------------------|---------------|---------|
| `cit_threshold_1` | `6000000000` (₮) | Tier 1 limit |
| `cit_rate_tier1` | `10` | Tier 1 rate (%) |
| `cit_rate_tier2` | `25` | Tier 2 rate (%) |
| `gl_cit_expense` | `70000004` | CIT P&L expense |
| `gl_cit_payable` | `31000003` | CIT liability |

**Computation:**
```
taxable_income = accounting_profit + total_add - total_sub
tier1_base = MIN(taxable_income, 6_000_000_000)
tier2_base = MAX(0, taxable_income - 6_000_000_000)
tax = tier1_base × 10% + tier2_base × 25%
delta = tax - prior_cit_ytd  // post only delta per quarter
```

**Adjustment categories (11 default):**

| Code | Direction | Mongolian | Description |
|------|-----------|-----------|-------------|
| `fine` | add | Торгууль, алданги | Fines (non-deductible) |
| `donation_excess` | add | Хандивын хэтрэлт | Above 1% of revenue |
| `personal_expense` | add | Хувийн зардал | Personal/non-business |
| `representation` | add | Төлөөлөгчийн зардал | Entertainment excess |
| `interest_excess` | add | Хүүгийн хэтрэлт | Thin cap rule |
| `non_business_exp` | add | Бизнес бус | Non-business expense |
| `depreciation_diff` | add | Элэгдлийн зөрүү | Book vs tax dep diff (temporary) |
| `prior_year_loss` | sub | Өмнөх алдагдал | Carryforward (4-year limit) |
| `tax_exempt_income` | sub | Чөлөөлсөн орлого | Exempt income |
| `other_add` / `other_sub` | both | Бусад | Custom |

**Journal:** `Dr 70000004 / Cr 31000003 = delta`
**Filing:** Quarterly (Q1-Q4) + annual (deadline: 20 days after Q-end; Mar 1 for annual)

### 2.3 ХХОАТ (PIT)

| Bracket | Limit | Rate |
|---------|-------|------|
| 1 | ≤ 10,000,000 ₮/сар | 10% |
| 2 | 10М-15М ₮/сар | 15% |
| 3 | > 15,000,000 ₮/сар | 20% |

| `payroll_settings` key | Value |
|------------------------|-------|
| `pit_bracket_1_limit` | `10000000` |
| `pit_bracket_1_rate` | `10` |
| `pit_bracket_2_limit` | `15000000` |
| `pit_bracket_2_rate` | `15` |
| `pit_bracket_3_rate` | `20` |
| `pit_credit_<1-6>_limit` | (configured) |
| `pit_credit_<1-6>_amount` | (configured) |

**Journal:** Posted as part of payroll run:
- `Dr 72100000 Salary expense / Cr 31430000 PIT payable`

**Filing:** Monthly ХХОАТ-26-XX (deadline: 10th of next month)

### 2.4 НДШ (Social Insurance)

| Component | Employee % | Employer % |
|-----------|-----------:|-----------:|
| Pension (тэтгэвэр) | 8.5% | 8.5% |
| Benefit (тэтгэмж) | 0.8% | 1% |
| Unemployment (ажилгүйдэл) | 0.2% | 0.2% |
| Health (ЭМД) | 2% | 2% |
| Accident (ҮОМШӨ) | – | 0.8% |
| **Total** | **11.5%** | **12.5%** |

**SI cap:** `minimum_wage × 10` = 7,920,000 ₮/сар

| `payroll_settings` key | Value |
|------------------------|-------|
| `si_employee_pension_rate` | `8.5` |
| `si_employee_benefit_rate` | `0.8` |
| `si_employee_unemployment_rate` | `0.2` |
| `si_employee_health_rate` | `2` |
| `si_employer_pension_rate` | `8.5` |
| `si_employer_benefit_rate` | `1` |
| `si_employer_unemployment_rate` | `0.2` |
| `si_employer_health_rate` | `2` |
| `si_employer_accident_rate` | `0.8` |
| `minimum_wage` | `792000` |
| `si_cap_multiplier` | `10` |
| `gl_si_expense_account` | (set) — `72100002` |
| `gl_si_payable_account` | (set) — `31420000` |

**Journal:**
- `Dr 72100002 Employer SI expense`
- `Cr 31420000 НДШ payable` (employee + employer total)

**Filing:** Monthly НДШ-26-XX-001 (deadline: 5th of next month)

### 2.5 Суутган татвар (WHT)

| Type | Rate | Use case |
|------|------|----------|
| Resident services | 10% | Service contracts to Mongolian individuals |
| Non-resident | 20% | Services to foreign entities (royalties, dividends) |

| `tax_settings` key | Default | Purpose |
|---------------------|---------|---------|
| `wht_enabled` | `true` | |
| `wht_resident_rate` | `10` | |
| `wht_non_resident_rate` | `20` | |
| `gl_wht_payable_account` | `31000003` | |
| `gl_ap_payable_account` | `31000001` | (referenced from AP) |

**Computation:**
```
wht_base = subtotal (VAT-аас өмнөх)
wht_amount = wht_base × wht_rate / 100
net_payable = amount - wht_amount  // нийлүүлэгчид төлөх
```

**Journal (additive in AP invoice):**
- `Dr 31000001 AP / Cr 31000003 WHT payable` (amount = wht_amount)

**Filing:** Per-AP invoice (immediate); annual certificate per supplier

### 2.6 НХАТ (Excise) — TBD V1.07

| Item category | Typical rate |
|---------------|-------------:|
| Spirits / alcohol | Per litre |
| Tobacco | Per 1000 cigs |
| Fuel (gasoline/diesel) | Per litre |
| Vehicles (engine size) | Per cc |

> **Status:** Schema TBD; AP/POS extra column for `excise_amount`. Filing quarterly via Tax module.

---

## 3. Journal posting summary by tax type

### 3.1 НӨАТ output (sales)

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| AR invoice posted | AR | `Dr 13110000 / Cr 51100000 + Cr 31000003 VAT output` |
| POS sale | POS | `Dr Cash / Cr Revenue + Cr 31000003 VAT output` (atomic) |

### 3.2 НӨАТ input (purchases)

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| AP invoice posted | AP | `Dr Expense + Dr 12000002 VAT input / Cr 31000001 AP` |

### 3.3 НӨАТ settlement (monthly)

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| `/api/vat-filings` | Tax | `Dr 31000003 (output clear) / Cr 12000002 (input clear) / Cr 31000003 (net pay)` |

### 3.4 НӨАТ payment to МТА

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| Cash payment | Cash | `Dr 31000003 / Cr 11000001 Bank` |

### 3.5 ААНОАТ accrual (quarterly)

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| `/api/cit-computations` | Tax | `Dr 70000004 / Cr 31000003 (delta)` |

### 3.6 ХХОАТ withholding

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| Payroll run posted | Payroll | (Part of payroll journal) `Cr 31430000 PIT payable` |

### 3.7 НДШ (Employer + Employee)

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| Payroll run posted | Payroll | `Dr 72100000 / Dr 72100002 / Cr 31420000 SI / Cr 31430000 PIT / Cr 31500001 Salary payable` |

### 3.8 WHT additive

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| AP invoice posted | AP | (Additive to standard AP journal) `Dr 31000001 / Cr 31000003 WHT payable` |

### 3.9 Deferred tax (IAS 12)

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| Year-end deferred tax review | Tax | DTL: `Dr 70000004 / Cr 33000002` ; DTA: `Dr 26000001 / Cr 70000004` |

### 3.10 Tax payment to МТА

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| Bank transfer | Cash | `Dr 31000003 (CIT/VAT/WHT/etc.) / Cr 11000001 Bank` |

### 3.11 Penalty

| Source | Module | Journal pattern |
|--------|--------|-----------------|
| Late filing penalty | GL manual | `Dr 87100007 Tax penalty / Cr 31000003 Tax payable` |

> **Note:** Penalty нь CIT-д `cit_adjustment_categories.fine` add-аар нэмэгдэнэ (non-deductible).

---

## 4. Filing schedule + deadlines

| Filing | Period | Due date | Module owner | МТА form |
|--------|--------|----------|--------------|----------|
| TT-01 НӨАТ | Monthly | 10th of next month | Tax | TT-01 |
| НДШ-26-XX-001 | Monthly | 5th of next month | Payroll/Tax | НДШ form |
| ХХОАТ-26-XX | Monthly | 10th of next month | Payroll/Tax | ХХОАТ form |
| ААНОАТ-Q1 | Q1 (Jan-Mar) | Apr 20 | Tax | ААНОАТ-Q form |
| ААНОАТ-Q2 | Q2 (Apr-Jun) | Jul 20 | Tax | (Same) |
| ААНОАТ-Q3 | Q3 (Jul-Sep) | Oct 20 | Tax | (Same) |
| ААНОАТ-Q4 + Annual | Q4 + full year | Mar 1 of next year | Tax | ААНОАТ annual |
| eBarimt daily | Daily | 00:00 cron | POS, Tax | API submit |
| WHT certificate | Per supplier | Annual (Mar 1) | AP, Tax | WHT cert |

---

## 5. Late filing penalty (Tax Administration Law)

| Violation | Penalty |
|-----------|---------|
| Late filing | 0.1% × tax amount × days late |
| Late payment | Same |
| Underreporting | Up to 2x tax owed |
| Failure to file | Fine + criminal liability (severe) |

> **Tax module:** Auto-accrues penalty if filing > deadline detected.

---

## 6. Tax compliance reports per filing

### 6.1 TT-01 (НӨАТ monthly)

Sections:
- Sales (output VAT) by category
- Purchases (input VAT) by supplier
- Net payable / refundable
- VAT-exempt sales (zero-rated, exports)
- Reverse charge transactions (rare)

### 6.2 ААНОАТ-Q

Sections:
- Income statement summary (revenue, COGS, opex)
- Adjustments (per category)
- Tax computation (tier 1/2)
- Prior period balance + delta
- Supporting schedules (FA tax dep, ECL provision, etc.)

### 6.3 ХХОАТ monthly

Sections:
- Per employee: РД, gross income, deductions, net taxable, PIT
- Total PIT (matches GL `31430000` payable)

### 6.4 НДШ monthly

Sections:
- Per employee: РД, base, all 4-5 SI components (employee + employer)
- Total SI (matches GL `31420000` payable)

### 6.5 WHT certificate

Per supplier annual:
- Supplier registration number
- Total payments
- WHT withheld
- Type (resident / non-resident)

---

## 7. eBarimt 2.0 integration

`tax_settings`:
- `ebarimt_enabled` (default true)
- `ebarimt_register_id`, `ebarimt_branch_id` (per-tenant)
- `ebarimt_endpoint` (default `https://localhost:7081`)

**Workflow:** POS sale посттойт зэрэг async:
- POST sale data to register
- Receive bill_id + qr_code + lottery_warranty (1-7)
- Save to `pos_sales.ebarimt_*`
- Print receipt with QR

**Daily reconciliation:** 00:00 cron submits cumulative day's transactions to МТА API.

**Failure handling:** `ebarimt_pending` queue with retry (max 5 attempts × 30 min).

---

## 8. Cross-tax interaction examples

### 8.1 Transaction with VAT + WHT

Service AP 1,000,000 + 100,000 VAT, 10% WHT:

```
Dr 73100001 Expense        1,000,000
Dr 13620000 VAT input        100,000
Cr 31000001 AP            1,100,000

(WHT additive)
Dr 31000001 AP              100,000  (net AP becomes 1,000,000)
Cr 31000003 WHT payable     100,000
```

Net liability:
- AP to supplier: 1,000,000 (paid via bank)
- WHT payable to МТА: 100,000
- VAT input claim: 100,000 (against output VAT in TT-01)

### 8.2 Payroll triggers PIT + НДШ + Salary

Single payroll journal hits 3 tax accounts:

```
Dr 72100000 Salary expense           Σ total_earnings
Dr 72100002 НДШ employer expense     Σ employer_SI
Cr 31420000 НДШ payable              Σ employee_SI + employer_SI
Cr 31430000 ХХОАТ payable            Σ PIT
Cr 31500001 Salary payable           Σ net_salary
```

### 8.3 CIT depreciation difference (deferred tax)

FA book life: 5 years (SL); tax life: 10 years.

Year 1 differences:
- Book dep: 100% / 5 = 20% of cost = 20M
- Tax dep: 100% / 10 = 10% of cost = 10M
- Temporary diff: 10M (book > tax → DTL accrual; future tax ↑)
- DTL: 10M × 10% (CIT tier 1) = 1M

```
Dr 70000004 Deferred tax expense   1M
Cr 33000002 DTL                     1M
```

Year 6 (book fully depreciated, tax still depreciating):
- Book dep: 0
- Tax dep: 10M
- Reversal: 10M × 10% = 1M (DTL reduces)

```
Dr 33000002 DTL                     1M
Cr 70000004 Deferred tax benefit    1M
```

---

## 9. Tax UI patterns

### 9.1 Tax dashboard

Widget per tax type:
- Current period status (filed / pending / overdue)
- Deadline countdown
- Cumulative YTD
- Compliance score

### 9.2 TT-01 wizard

1. Select period (year + month)
2. Preview: output_vat, input_vat, net_payable
3. Drill-down to invoice list (AR + AP + POS contributions)
4. Approve & post settlement journal
5. Export TT-01 PDF (МТА format)
6. Mark "Submitted" with МТА reference number

### 9.3 ААНОАТ wizard

1. Period (year + quarter / annual)
2. P&L summary auto-loaded
3. Adjustments grid (categories from `cit_adjustment_categories`)
4. Tax computation preview (tier 1/2 split)
5. YTD + delta calculation
6. Post journal + export form

---

## 10. Validation guardrails

### 10.1 Effective-dated rates

```js
// Always load rate for transaction date, not current date
const rate = await getEffectiveRate('vat_rate', txn.invoice_date)
```

> **Implementation:** Settings table needs `effective_date` column (TBD V1.07; одоогоор current value used).

### 10.2 SI cap

```js
const siCap = settings.minimum_wage * settings.si_cap_multiplier
const siBase = Math.min(totalEarnings, siCap)
const siAmount = siBase * rate / 100
```

### 10.3 PIT progressive bracket

```js
if (taxable <= 10M) tax = taxable * 10%
else if (taxable <= 15M) tax = 1M + (taxable - 10M) * 15%
else tax = 1.75M + (taxable - 15M) * 20%
```

### 10.4 CIT idempotency

```sql
UNIQUE INDEX vat_filings_unique (tenant_id, company_id, period_year, period_month)
```

### 10.5 WHT type validation

```js
if (supplier.wht_type === 'non_resident' && supplier.country === 'MN') {
  throw 'WHT type mismatch — non-resident requires foreign country'
}
```

---

## 11. Tenant-specific overrides

`tax_settings` table нь `(tenant_id, setting_key)`-аар override-логдсон row хадгалагдана:

```sql
-- Default global rate
INSERT INTO tax_settings (tenant_id, setting_key, setting_value)
VALUES (NULL, 'vat_rate', '10');

-- Tenant-specific override (rare; e.g., tax-exempt zone)
INSERT INTO tax_settings (tenant_id, setting_key, setting_value)
VALUES (<tenant_uuid>, 'vat_rate', '0');
```

> **Lookup priority:** Tenant-specific row > global default (NULL tenant).

---

## 12. Future updates (V1.07+)

- [ ] НХАТ (excise) full implementation
- [ ] Effective-dated rates with history tracking
- [ ] Property tax module
- [ ] Inheritance tax (rare; high-net-worth individuals)
- [ ] International tax / transfer pricing
- [ ] Tax loss carryforward automated tracking (4-year limit)
- [ ] DTA recoverability test (annual)
- [ ] Foreign tax credit (resident company income abroad)

---

## Холбоотой баримт

- [Module 12: Tax](../02-modules/12-tax.md)
- [Module 02: AR](../02-modules/02-ar.md) — VAT output
- [Module 03: AP](../02-modules/03-ap.md) — VAT input + WHT
- [Module 07: Payroll](../02-modules/07-payroll.md) — PIT + SI
- [Module 08: POS](../02-modules/08-pos.md) — eBarimt + VAT
- [Cross-module: GL Posting Matrix](./01-gl-posting-matrix.md)
- [/mongolian-tax skill](../knowledge/04-ai-agent/skills/mongolian-tax/SKILL.md)
- [Knowledge: tax/](../../knowledge/01-онол-хууль-стандарт/tax/)
