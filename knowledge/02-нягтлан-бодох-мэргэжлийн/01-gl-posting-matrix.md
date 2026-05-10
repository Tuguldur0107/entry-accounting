# Cross-module 01 — GL Posting Matrix

> **Зорилго:** Entry-ийн бүх 18 модулиас GL руу post хийдэг **бүх журналын template-уудын мастер баримт**. Тус бүр модулийн posting templates тус тусын spec-д ч байгаа; энд **нэг газар нэгтгэж**, account code-уудаар lookup table бий.

> **Тэмдэглэгээ:** Бүх account code = 8-оронтой Segment3 main account. Бүрэн 10-сегмент бүтэц нь GL line-д хадгалагдана. Account code лавлагаа: [/coa skill](../knowledge/04-ai-agent/skills/coa/SKILL.md).

---

## 1. Account code reference (Segment3)

| Code | Нэр | Дансны бүлэг |
|------|-----|--------------|
| **1xxxxxxx** Эргэлтийн хөрөнгө | | |
| `11210000` | Касс (cash on hand) | Asset |
| `11220000` | USD bank account | Asset |
| `11000001` | Bank (default) | Asset |
| `12000001` | AR Trade Receivable (default ID) | Asset |
| `12000002` | НӨАТ авсан (VAT input) | Asset |
| `12000099` | AR Allowance / Contra (IFRS 9 ECL) | Contra-Asset |
| `13110000` | Худалдааны авлага | Asset |
| `13130000` | Бараа материал (general) | Asset |
| `13150000` | IC Receivable | Asset |
| `13620000` | НӨАТ авсан (VAT input — alt code) | Asset |
| `14000001` | Бараа материал (Inventory main) | Asset |
| `14000003` | WIP (Work-in-Process) | Asset |
| `14000004` | Finished Goods | Asset |
| `14000099` | Landed cost clearing | Asset (transit) |
| **2xxxxxxx** Эргэлтийн бус хөрөнгө | | |
| `20000001` | ROU asset / Revaluation asset | Asset |
| `20000002` | ROU accum dep / Accum impairment | Contra-Asset |
| `21010000` | Asset cost (general) | Asset |
| `21000099` | Accum depreciation | Contra-Asset |
| `25000001` | Investment in associate | Asset |
| `26000001` | Deferred Tax Asset (IAS 12) | Asset |
| `29000001` | IFRS 5 Held-for-sale asset | Asset |
| **3xxxxxxx** Өр төлбөр | | |
| `31000001` | AP main | Liability |
| `31000003` | VAT output / CIT payable / WHT payable | Liability |
| `31110000` | Худалдааны өглөг | Liability |
| `31150000` | IC Payable | Liability |
| `31410000` | НӨАТ өглөг (VAT output — alt) | Liability |
| `31420000` | НДШ өглөг (SI payable) | Liability |
| `31430000` | ХХОАТ өглөг (PIT payable) | Liability |
| `31500001` | Цалингийн өглөг (Salary payable) | Liability |
| `31600001` | Wallet liability (deferred revenue) | Liability |
| `31900001` | Accrued liability (general) | Liability |
| `33000001` | Lease liability | Liability |
| `33000002` | Deferred Tax Liability (IAS 12) | Liability |
| **4xxxxxxx** Эздийн өмч | | |
| `41100000` | Эзэмшигчийн хөрөнгө (Owners' equity) | Equity |
| `42000001` | Revaluation reserve (OCI) | Equity |
| `44000001` | Хуримтлагдсан ашиг (Retained earnings) | Equity |
| `44000099` | Income summary (year-end) | Equity (clearing) |
| **5xxxxxxx** Орлого | | |
| `51100000` | Борлуулалтын орлого (Sales revenue) | Revenue |
| `51800001` | Unrealized FX gain | Revenue |
| `51800002` | Бусад орлого / Other income | Revenue |
| `51800003` | Inventory gain (counting) | Revenue |
| `51800004` | Gain on disposal | Revenue |
| `51800005` | IC service revenue | Revenue |
| `51800006` | SaaS revenue (Wallet consumption) | Revenue |
| `51800007` | Share of associate profit (IAS 28) | Revenue |
| `51900001` | Sales discount (contra-revenue) | Contra-Revenue |
| `51000002` | Impairment reversal income / Fair value recovery | Revenue |
| **6xxxxxxx** Өртөг | | |
| `61100000` | Борлуулалтын өртөг (COGS) | Expense |
| `61300001` | Direct Labor (DL) | Expense |
| `60000002` | DL alt code | Expense |
| `60000003` | MOH (Manufacturing Overhead) | Expense |
| `60000004` | Production variance (DM/DL/OH) | Expense |
| `60000005` | Production scrap expense (IAS 2.16) | Expense |
| `62100000` | MOH labor (supervisors) | Expense |
| **7xxxxxxx** Удирдлагын зардал | | |
| `70000001` | Depreciation expense | Expense |
| `70000002` | ROU dep expense (lease) | Expense |
| `70000004` | CIT expense / Deferred tax expense | Expense |
| `72100000` | Цалингийн зардал (Salary expense) | Expense |
| `72100002` | НДШ зардал (Employer SI) | Expense |
| `73100001` | IC service expense | Expense |
| `73100002` | Promotional expense | Expense |
| **8xxxxxxx** Санхүүгийн зардал | | |
| `87000001` | Lease interest expense | Expense |
| `87000002` | Impairment loss / Bad debt expense / HFS write-down | Expense |
| `87000003` | FX loss / FX realized | Expense |
| `87100001` | Хүүгийн зардал (Interest expense) | Expense |
| `87100002` | Bank fee | Expense |
| `87100003` | Хүүгийн орлого (interest revenue) — alt code | Revenue/Expense |
| `87100004` | Inventory loss (counting) | Expense |
| `87100005` | NRV write-down (IAS 2.9) | Expense |
| `87100006` | Loss on disposal | Expense |
| `87100007` | Tax penalty | Expense |
| **9xxxxxxx** ОЗНД / нэгдсэн | | |
| `92100000` | ОЗНД (Consolidated other comprehensive) | OCI |

---

## 2. Module-by-module posting templates

### 2.1 GL — Manual journals

`module='gl'`, custom Dr/Cr; no shared template (мчинд шууд хэрэглэгч аккаунт оруулна).

### 2.2 GL — Period close auto

| Trigger | Account | Dr | Cr | Module |
|---------|---------|---:|---:|--------|
| **FX revaluation (period end, asset rate ↑)** | | | | |
| | `11220000` USD bank | delta | – | gl |
| | `51800001` Unrealized FX gain | – | delta | gl |
| **FX revaluation (asset rate ↓)** | | | | |
| | `87100001` Unrealized FX loss | delta | – | gl |
| | `11220000` USD bank | – | delta | gl |
| **Accrual (e.g., year-end bonus)** | | | | |
| | `72100000` Salary expense | X | – | gl |
| | `31900001` Accrued liability | – | X | gl |
| **Year-end closing (revenue → income summary)** | | | | |
| | `51100000` Revenue | sum | – | gl |
| | `44000099` Income summary | – | sum | gl |
| **Year-end closing (expense → income summary)** | | | | |
| | `44000099` Income summary | sum | – | gl |
| | `6/7/8xxxxxxx` Expenses | – | sum | gl |
| **Year-end closing (income summary → retained earnings)** | | | | |
| | `44000099` Income summary | net | – | gl |
| | `44000001` Retained earnings | – | net | gl |
| **Prior period adjustment (IAS 8)** | | | | |
| | `44000001` Retained earnings | adjustment | (or Cr) | gl |
| | balance sheet account | (or Cr) | adjustment | gl |

### 2.3 AR — Standard sale (vat exclusive)

| Account | Dr | Cr | Module |
|---------|---:|---:|--------|
| `13110000` Худалдааны авлага | total_with_vat | – | ar |
| `51100000` Орлого | – | subtotal | ar |
| `31410000` НӨАТ өглөг | – | vat_amount | ar |

### 2.4 AR — Discount applied (IFRS 15)

| Account | Dr | Cr |
|---------|---:|---:|
| `13110000` Авлага | net total | – |
| `51900001` Хөнгөлөлт (contra-revenue) | discount | – |
| `51100000` Орлого | – | gross |
| `31410000` НӨАТ | – | (gross-discount) × 10% |

### 2.5 AR — IFRS 9 ECL provision (delta posting)

| direction | Account | Dr | Cr |
|-----------|---------|---:|---:|
| **Increase (delta > 0)** | `87000002` Bad debt expense | \|delta\| | – |
| | `12000099` AR Allowance | – | \|delta\| |
| **Decrease (delta < 0)** | `12000099` AR Allowance | \|delta\| | – |
| | `87000002` Bad debt expense | – | \|delta\| |

### 2.6 AR — Write-off (manual)

| Account | Dr | Cr |
|---------|---:|---:|
| `12000099` AR Allowance | amount | – |
| `13110000` Авлага | – | amount |

### 2.7 AP — Standard expense (vat exclusive)

| Account | Dr | Cr |
|---------|---:|---:|
| Зардал (6/7/8xxxxxxx) | subtotal | – |
| `13620000` НӨАТ авсан | vat | – |
| `31000001` AP | – | total_with_vat |

### 2.8 AP — WHT additive

Standard expense дээр нэмэгдэх 2 line:

| Account | Dr | Cr |
|---------|---:|---:|
| `31000001` AP | wht_amount | – |
| `31000003` WHT payable | – | wht_amount |

### 2.9 AP — Landed cost (capitalize, IAS 2)

**Step 1: AP invoice posting** (clearing-руу):

| Account | Dr | Cr |
|---------|---:|---:|
| `14000099` Landed cost clearing | total | – |
| `31000001` AP | – | total |

**Step 2: Landed cost allocation** (Inventory absorption):

| Account | Dr | Cr |
|---------|---:|---:|
| `14000001` Inventory (per-item summed) | total | – |
| `14000099` Landed cost clearing | – | total |

### 2.10 Cash — Receipt (AR collection)

| Account | Dr | Cr |
|---------|---:|---:|
| `11210000` Касс/Банк | amount | – |
| `13110000` Авлага | – | amount |

### 2.11 Cash — Payment (AP settlement)

| Account | Dr | Cr |
|---------|---:|---:|
| `31000001` AP | net_payable | – |
| `11210000` Bank | – | net_payable |

### 2.12 Cash — Transfer between accounts

| Account | Dr | Cr |
|---------|---:|---:|
| `to_bank.gl_account` | amount | – |
| `from_bank.gl_account` | – | amount |

### 2.13 Cash — Bank fee

| Account | Dr | Cr |
|---------|---:|---:|
| `87100002` Банкны хураамж | amount | – |
| `11210000` Bank | – | amount |

### 2.14 Cash — Realized FX (AP payment time)

| Account | Dr | Cr |
|---------|---:|---:|
| `31000001` AP | book carry | – |
| `87000003` FX realized loss | gain or loss | – or amount |
| `11220000` USD Bank | – | actual MNT |

### 2.15 Inventory — Receipt

| Account | Dr | Cr |
|---------|---:|---:|
| `14000001` Бараа материал | total | – |
| `31000001` AP | – | total |

### 2.16 Inventory — Issue (COGS)

| Account | Dr | Cr |
|---------|---:|---:|
| `61100000` COGS | qty × avg_cost | – |
| `14000001` Inventory | – | qty × avg_cost |

### 2.17 Inventory — Counting variance (gain)

| Account | Dr | Cr |
|---------|---:|---:|
| `14000001` Inventory | variance | – |
| `51800003` Inventory gain | – | variance |

### 2.18 Inventory — Counting variance (loss)

| Account | Dr | Cr |
|---------|---:|---:|
| `87100004` Inventory loss | \|variance\| | – |
| `14000001` Inventory | – | \|variance\| |

### 2.19 Inventory — NRV write-down (IAS 2.9)

| Account | Dr | Cr |
|---------|---:|---:|
| `87100005` NRV write-down | (cost - NRV) × qty | – |
| `14000001` Inventory | – | ditto |

### 2.20 FA — Acquisition (cash purchase)

| Account | Dr | Cr |
|---------|---:|---:|
| `21010000` Asset cost | acq_cost | – |
| `11210000` Bank | – | acq_cost |

### 2.21 FA — Depreciation (monthly)

| Account | Dr | Cr |
|---------|---:|---:|
| `70000001` Depreciation expense | monthly | – |
| `21000099` Accum depreciation | – | monthly |

### 2.22 FA — Impairment (IAS 36)

| Account | Dr | Cr |
|---------|---:|---:|
| `87000002` Impairment loss | loss | – |
| `20000002` Accum impairment | – | loss |

### 2.23 FA — Impairment reversal (IAS 36.117)

| Account | Dr | Cr |
|---------|---:|---:|
| `20000002` Accum impairment | reversal | – |
| `51000002` Impairment reversal income | – | reversal |

### 2.24 FA — Fair value upward (IFRS 13)

| Account | Dr | Cr |
|---------|---:|---:|
| `20000001` Asset (carrying adjust) | delta | – |
| `42000001` Revaluation reserve (OCI) | – | delta |

### 2.25 FA — Disposal

| Account | Dr | Cr |
|---------|---:|---:|
| `11210000` Bank (sale price) | sale | – |
| `21000099` Accum dep | accum_dep | – |
| `20000002` Accum impair | accum_impair | – |
| `21010000` Asset cost | – | acq_cost |
| `87100006` Loss / `51800004` Gain | balance | – or balance |

### 2.26 FA — IFRS 16 lease (initial)

| Account | Dr | Cr |
|---------|---:|---:|
| `20000001` ROU asset | PV(payments) | – |
| `33000001` Lease liability | – | PV(payments) |

### 2.27 FA — IFRS 16 lease (monthly)

| Account | Dr | Cr |
|---------|---:|---:|
| `87000001` Lease interest | interest | – |
| `33000001` Lease liability | – | interest |
| `33000001` Lease liability | payment | – |
| `11000001` Bank | – | payment |
| `70000002` ROU dep expense | dep | – |
| `20000002` ROU accum dep | – | dep |

### 2.28 Payroll — Standard run

| Account | Dr | Cr |
|---------|---:|---:|
| `72100000` Salary expense | Σ total_earnings | – |
| `72100002` НДШ expense (employer) | Σ employer_social | – |
| `31420000` НДШ payable | – | Σ employee_si + employer_si |
| `31430000` ХХОАТ payable | – | Σ pit |
| `31500001` Salary payable | – | Σ net_salary |

### 2.29 POS — Cash sale (vat exclusive)

| Account | Dr | Cr |
|---------|---:|---:|
| `11210000` Cash | total_with_vat | – |
| `51100000` Revenue (per item) | – | subtotal |
| `31000003` VAT output | – | vat |
| `61100000` COGS | qty × avg_cost | – |
| `14000001` Inventory | – | qty × avg_cost |

### 2.30 AGIS — Service charge (sender book)

| Account | Dr | Cr |
|---------|---:|---:|
| `73100001` IC service expense | amount | – |
| `31150000` IC payable | – | amount |

### 2.31 AGIS — Service charge (receiver book)

| Account | Dr | Cr |
|---------|---:|---:|
| `13150000` IC receivable | amount | – |
| `51800005` IC service revenue | – | amount |

### 2.32 AGIS — Consolidation elimination

| Account | Dr | Cr |
|---------|---:|---:|
| `31150000` IC payable | balance | – |
| `13150000` IC receivable | – | balance |
| `51800005` IC revenue | balance | – |
| `73100001` IC expense | – | balance |

### 2.33 Cost — Manual reclassification

| Account | Dr | Cr |
|---------|---:|---:|
| Expense to_center segment2 | amount | – |
| Expense from_center segment2 | – | amount |

### 2.34 Cost — Service center allocation (driver basis)

Per target:

| Account | Dr | Cr |
|---------|---:|---:|
| Expense (segment2 = target) | allocated | – |
| Expense (segment2 = source) | – | allocated (proportional) |

### 2.35 Manufacturing — Component issue

| Account | Dr | Cr |
|---------|---:|---:|
| `14000003` WIP | qty × avg_cost | – |
| `14000001` Inventory | – | qty × avg_cost |

### 2.36 Manufacturing — Labor charge

| Account | Dr | Cr |
|---------|---:|---:|
| `14000003` WIP | amount | – |
| `60000002` DL | – | amount |

### 2.37 Manufacturing — Overhead charge

| Account | Dr | Cr |
|---------|---:|---:|
| `14000003` WIP | amount | – |
| `60000003` MOH | – | amount |

### 2.38 Manufacturing — FG output

| Account | Dr | Cr |
|---------|---:|---:|
| `14000004` FG | qty × unit_cost | – |
| `14000003` WIP | – | qty × unit_cost |

### 2.39 Manufacturing — Scrap (IAS 2.16)

| Account | Dr | Cr |
|---------|---:|---:|
| `60000005` Production scrap | total_cost | – |
| `14000003` WIP | – | total_cost |

### 2.40 Manufacturing — Variance close (favorable)

| Account | Dr | Cr |
|---------|---:|---:|
| `14000003` WIP (residual) | – | balance |
| `60000004` Production variance | balance | – |

### 2.41 Tax — НӨАТ monthly settlement

| Account | Dr | Cr |
|---------|---:|---:|
| `31000003` VAT output (clear) | output_vat | – |
| `12000002` VAT input (clear) | – | input_vat |
| `31000003` VAT payable (offset) | – | net_payable |

### 2.42 Tax — ААНОАТ accrual (quarterly)

| Account | Dr | Cr |
|---------|---:|---:|
| `70000004` CIT expense | delta | – |
| `31000003` CIT payable | – | delta |

### 2.43 Tax — Deferred tax DTL

| Account | Dr | Cr |
|---------|---:|---:|
| `70000004` Deferred tax expense | delta | – |
| `33000002` DTL | – | delta |

### 2.44 Tax — Deferred tax DTA

| Account | Dr | Cr |
|---------|---:|---:|
| `26000001` DTA | delta | – |
| `70000004` Deferred tax benefit | – | delta |

### 2.45 Reports — Equity method (share of profit)

| Account | Dr | Cr |
|---------|---:|---:|
| `25000001` Investment | share | – |
| `51800007` Share of profit | – | share |

### 2.46 Reports — Equity method (dividend)

| Account | Dr | Cr |
|---------|---:|---:|
| `11210000` Bank | dividend | – |
| `25000001` Investment | – | dividend |

### 2.47 Wallet — Bank top-up

| Account | Dr | Cr |
|---------|---:|---:|
| `11210000` Bank | amount | – |
| `31600001` Wallet liability | – | amount |

### 2.48 Wallet — Charge (consumption)

| Account | Dr | Cr |
|---------|---:|---:|
| `31600001` Wallet liability | amount | – |
| `51800006` SaaS revenue | – | amount |

---

## 3. Module → entity_type → journal mapping

| Module | Entity | Trigger event | Posted journal `module` |
|--------|--------|---------------|-------------------------|
| GL | Manual journal | User clicks "Post" | `gl` |
| GL | FX revaluation | Period close | `cash` (run by Cash) |
| GL | Year-end close | Annual workflow | `gl` |
| AR | Invoice | `/post` endpoint | `AR` |
| AR | ECL provision | `/ar-reports/ecl/post` | `ecl_provision` |
| AP | Invoice | `/post` endpoint | `AP` |
| AP | Landed cost allocation | `/landed-costs/:id/post` | `Inventory` |
| Cash | Transaction | `/post` endpoint | `Cash` |
| Cash | FX revaluation | `/cash-reports/fx-reval` | `cash` |
| Inventory | Transaction | `/post` endpoint | `Inventory` |
| Inventory | Counting adjust | `/inv-counting/:id/adjust` | `Inventory` |
| FA | Acquisition | `/fa-transactions/:id/post` | `FA` |
| FA | Depreciation | `/fa-depreciation/run` | `fa` |
| FA | Impairment | `/fa-reports/impairment/assess` | `fa` |
| FA | Lease (IFRS 16) | `/lease-contracts/:id/post-period` | `fa` |
| Payroll | Run | `/payroll-runs/:id/post` | `Payroll` |
| POS | Sale | `/pos/sales` (atomic) | `POS` |
| AGIS | Transaction | `/agis/:id/post` | `AGIS` (2 journals) |
| Cost | Allocation | `/cost-allocations/:id/post` | `Cost` |
| Mfg | Issue/Charge/Output | `/production-orders/:id/...` | `Inventory` (cost-related) |
| Tax | VAT settlement | `/vat-filings` | `Tax` |
| Tax | CIT accrual | `/cit-computations` | `Tax` |
| Wallet | Top-up / charge | `/wallet/...` | (TBD GL bridge V1.07) |
| Reports | Equity method | `/equity-investments/.../share-of-profit` | `Reports` |

---

## 4. Adjustment_type values

`journal_entries.adjustment_type`-д used:

| Value | Meaning | Triggered by |
|-------|---------|--------------|
| `regular` | Standard posting (default) | All modules |
| `prior_period` | IAS 8 prior period error correction | GL manual |
| `closing` | Year-end closing journal | GL year-end |
| `reversing` | Reversing entry (FX reval / accrual reverse) | Period close auto |
| `fx_reval` | FX revaluation | Cash module |
| `depreciation` | FA depreciation run | FA module |
| `accrual` | Accrual booking | Manual |
| `correction` | Reversal/correction | AP landed cost reverse, AGIS reject |

---

## 5. Module dependencies on GL post

Posting timing-аар ranked (period close-д):

1. **Always-on (real-time):** AR, AP, Cash (txn), POS, Inventory, AGIS, Manufacturing
2. **Period-close auto:** FA depreciation → Cash FX reval → Cost rules → Mfg close → AR ECL → CIT
3. **Year-end only:** Year-end closing journal, fair value reval

> **Дэлгэрэнгүй ordering:** [02-period-close.md](./02-period-close.md)

---

## 6. Validation pattern

Бүх journal post-д шаардагдана:

```js
// 1. Balance check
if (Math.abs(totalDr - totalCr) > 0.01) throw 'Unbalanced'

// 2. Period open
await checkPeriodOpen(client, journal_date, tenantId, companyId)

// 3. Account exists & active
for (line in lines) {
  validateAccountCode(line.account_code)
}

// 4. Segment defaulting + validation (V1.07+)
for (line of lines) {
  await DefaultingEngine.fillSegments(line, context)   // s1..s10 хоосон бол default татах
  await SegmentValidator.validate(line)                // first-char != '0', master existence, scope, period rules
}

// 5. Approval (if threshold)
const approval = await checkAndSubmitApproval(...)
if (approval.needsApproval) return res.status(202).json(...)

// 6. Idempotency (optional)
if (idempotency_key && existsAlready) return existing journal_id

// 7. Post + balance update
INSERT journal_entries
INSERT journal_entry_lines (s1..s10 included)
await updateGLBalances(client, journal_date, lines, ...)
```

> **Code reference:** [/api/journals](../../backEnd/routes/journals.js), [glPeriods.js helpers](../../backEnd/routes/glPeriods.js)
> **Segment validation:** [01-architecture/07-segment-strategy.md §7.6](../01-architecture/07-segment-strategy.md)

---

## 7. Сегментийн шаардлага template-аар (segment source / required / fallback)

Template бүрийн journal line бүрд аль сегмент **заавал бөглөгдөнө**, аль нь **default-аар авна**, аль нь **сонголтой** болохыг тогтоосон. Дэлгэрэнгүй: [01-architecture/07-segment-strategy.md §7.3](../01-architecture/07-segment-strategy.md).

### 7.1 Сегмент required matrix per template

`s9` (Modules) бүх template-д auto-assigned. `s1` (Company) бүгдэд login session-аас. Үлдсэн сегментийг template тус бүрээр:

| Template | s2 CC | s3 Acct | s4 Prod | s5 Proj | s6 IC | s7 RP | s8 CF | Source / Fallback |
|----------|:-----:|:-------:|:-------:|:-------:|:-----:|:-----:|:-----:|-------------------|
| AR-1 Invoice post (Cr Revenue) | ⭕ | ✅ | ⭕ | ⭕ | ⭕ | ⭕ | — | s4 from item; s5 from contract; s6/s7 from customer |
| AR-2 Invoice post (Dr A/R) | ⭕ | ✅ | — | ⭕ | ⭕ | ⭕ | — | s5/s6/s7 inherited |
| AR-3 Receipt (Cash leg) | ⭕ | ✅ | — | ⭕ | ⭕ | ⭕ | ✅ | s8 from cash_settings; **REQUIRED** |
| AR-4 ECL provision | ⭕ | ✅ | — | — | — | — | — | s2 = `'000000'` fallback |
| AP-1 Bill post (Dr Expense) | ✅ | ✅ | ⭕ | ⭕ | ⭕ | ⭕ | — | s2 from supplier/department; s4 from line item |
| AP-2 Bill post (Dr Inv capitalize) | ⭕ | ✅ | ⭕ | ⭕ | ⭕ | ⭕ | — | s4 from inv_items |
| AP-3 Bill post (Cr A/P) | ⭕ | ✅ | — | ⭕ | ⭕ | ⭕ | — | s5/s6/s7 from supplier |
| AP-4 Vendor payment (Cash leg) | ⭕ | ✅ | — | ⭕ | ⭕ | ⭕ | ✅ | s8 = `'1102'` Operating-Purchases |
| AP-5 WHT post | — | ✅ | — | — | — | ⭕ | — | s7 if non-resident |
| Cash-1 Deposit / Withdrawal | ⭕ | ✅ | — | ⭕ | ⭕ | ⭕ | ✅ | s8 **REQUIRED** |
| Cash-2 FX revaluation | ⭕ | ✅ | — | — | — | — | — | s8 = `'0000'` (excluded) |
| Cost-1 Receipt capitalize | ⭕ | ✅ | ⭕ | ⭕ | ⭕ | ⭕ | — | s4 from inv_items |
| Cost-2 Issue COGS | ✅ | ✅ | ✅ | ⭕ | — | — | — | s2 from warehouse; s4 from item |
| Cost-3 NRV write-down | ⭕ | ✅ | ⭕ | — | — | — | — | s4 from item |
| Cost-4 Counting variance | ⭕ | ✅ | ⭕ | — | — | — | — | s4 from item |
| Cost-5 Landed cost absorption | ⭕ | ✅ | ⭕ | — | — | — | — | s4 from item; pro-rata |
| FA-1 Acquisition (Dr Asset) | ✅ | ✅ | — | ⭕ | ⭕ | ⭕ | — | s2 from fa_assets.cost_center |
| FA-2 Depreciation run | ✅ | ✅ | — | ⭕ | — | — | — | s2 from fa_assets.cost_center |
| FA-3 Disposal cash leg | ✅ | ✅ | — | ⭕ | — | — | ✅ | s8 = `'2102'` Investing-Disposal |
| FA-4 Impairment | ✅ | ✅ | — | ⭕ | — | — | — | IAS 36 |
| FA-5 ROU lease (IFRS 16) | ✅ | ✅ | — | ⭕ | — | — | — | s2 from lease.cost_center |
| Payroll-1 Salary expense | ✅ | ✅ | — | ⭕ | — | — | — | s2 from employees.cost_center |
| Payroll-2 SI/PIT payable | ⭕ | ✅ | — | — | — | — | — | s2 = `'000000'` fallback |
| Payroll-3 Disbursement (Cash leg) | ⭕ | ✅ | — | — | — | — | ✅ | s8 = `'1103'` Operating-Employees |
| POS-1 Sale (Dr Cash) | ⭕ | ✅ | — | — | — | — | ✅ | s8 = `'1101'` Operating-Sales |
| POS-2 Sale (Cr Revenue) | ⭕ | ✅ | ⭕ | — | — | — | — | s4 from SKU.product |
| POS-3 Sale (Cr VAT output) | — | ✅ | — | — | — | — | — | — |
| POS-4 COGS (Cost listener async) | ⭕ | ✅ | ✅ | — | — | — | — | s4 **REQUIRED** from sold item |
| AGIS-1 IC Receivable (Dr) | ⭕ | ✅ | ⭕ | ⭕ | ✅ | — | — | s6 **REQUIRED** = counterparty |
| AGIS-2 IC Payable (Cr) | ⭕ | ✅ | ⭕ | ⭕ | ✅ | — | — | s6 **REQUIRED** |
| AGIS-3 Goods transfer | ⭕ | ✅ | ✅ | ⭕ | ✅ | — | — | s4 from item; s6 counterparty |
| Tax-1 VAT settlement | ⭕ | ✅ | — | — | — | — | — | s2 = `'000000'` |
| Tax-2 CIT accrual | ⭕ | ✅ | — | — | — | — | — | — |
| Mfg-1 Issue (RM → WIP) | ✅ | ✅ | ✅ | ⭕ | — | — | — | s2 from routing CC; s4 from RM |
| Mfg-2 Charge (DL/MOH) | ✅ | ✅ | ✅ | ⭕ | — | — | — | s4 from FG output |
| Mfg-3 Output (WIP → FG) | ✅ | ✅ | ✅ | ⭕ | — | — | — | s4 from FG item |
| Mfg-4 Variance close | ✅ | ✅ | ✅ | ⭕ | — | — | — | 4-way variance per s2 × s4 |
| Mfg-5 Scrap | ✅ | ✅ | ✅ | — | — | — | — | s4 from RM |
| Wallet-1 Top-up | ⭕ | ✅ | — | — | — | — | ✅ | s8 from cash_settings |
| Wallet-2 Charge | ⭕ | ✅ | — | — | — | — | ✅ | s8 |
| GL-Manual adjustment | ⭕ | ✅ | ⭕ | ⭕ | ⭕ | ⭕ | ⭕ | All optional except s3; user must override-reason if non-default |

✅ = required (validation хорино хэрэв хоосон), ⭕ = optional (default-аар татаж болно), — = applicable биш (default `0`).

### 7.2 Default-source per template

| Сегмент | AR/AP | Cash | Inv/Cost | FA | Payroll | POS | AGIS | Mfg |
|---------|-------|------|----------|----|----|-----|------|-----|
| s2 CC | Department / Supplier | Cash account default | Warehouse default | Asset CC | Employee CC | (n/a) | (n/a) | Routing CC |
| s4 Product | Item / Contract | (n/a) | inv_items.product | (n/a) | (n/a) | SKU.product | Item | RM/FG item |
| s5 Project | Contract / Expense | Counterparty | Issue context | Asset project | Employee project | (n/a) | (n/a) | WO project |
| s6 IC | Customer.IC flag | Counterparty | (n/a) | (n/a) | (n/a) | (n/a) | Counterparty company | (n/a) |
| s7 RP | Customer.RP / Supplier.RP | Counterparty | (n/a) | (n/a) | Employee comp type | (n/a) | (n/a) | (n/a) |
| s8 CF | Customer/Supplier txn type | Cash txn type | (n/a) | Disposal: Investing | Disbursement: Operating | Sale: Operating | (n/a) | (n/a) |

### 7.3 Fallback values

Хэрэв `DefaultingEngine.fillSegments` source data олдсонгүй бол fallback хэрэглэнэ:

| Сегмент | Fallback | Шалтгаан |
|---------|----------|----------|
| s2 Cost Center | `'000000'` ("Common" master record) | Tenant-д CC track хийдэггүй бол |
| s4 Product/Service | `'00'` ("Generic" master record) | Item categorize-аас гадуурх transaction |
| s5 Project | `'0000'` (Project module disabled бол) | Project module off |
| s6 Inter Company | `'000'` (non-IC) | Standalone tenant |
| s7 Related Party | `'0000'` (non-RP) | RP registry хоосон |
| s8 Cash Flow | `'0000'` (non-cash adjustment) | Cash-аар бус транзакц |
| s10 Reserve | `'0'` | Always |

> **Зарчим:** Required template-д fallback хэрэглэхийг **зөвшөөрөхгүй** — defaulting нь зөвхөн optional segment-д. Required-д source data олдсонгүй бол UI form-аас explicit prompt.

---

## Холбоотой баримт

- [Module 01: GL](../02-modules/01-gl.md) — Source of truth
- [Period Close](./02-period-close.md) — Ordering of posts + segment completeness check
- [IFRS Mapping](./03-ifrs-mapping.md) — Standard → account code
- [Tax Mapping](./04-tax-mapping.md) — Tax type → account code
- [Architecture: Segment strategy](../01-architecture/07-segment-strategy.md) — full segment policy
- [Skill: /coa](../knowledge/04-ai-agent/skills/coa/SKILL.md), [/ifrs](../knowledge/04-ai-agent/skills/ifrs/SKILL.md)
