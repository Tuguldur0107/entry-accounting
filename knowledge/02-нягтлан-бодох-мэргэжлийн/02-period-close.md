# Cross-module 02 — Period Close (End-to-End)

> **Зорилго:** Сар бүрийн period close (хаалт), Q-end, year-end-ийн **end-to-end workflow** — бүх 18 модулийг тусгасан ordering, checklist, posting sequence, lock period, snapshot generation, approval. Period close нь Entry-ийн ерөнхий нягтлан + CFO-д хамгийн чухал процесс.

---

## 1. Period close-ийн ангилал

| Type | Cadence | Workflow scope | Approval |
|------|---------|----------------|----------|
| **Monthly close** | Сар бүрийн 5-10-нд | Стандарт (1-9) | Ерөнхий нягтлан |
| **Quarterly close** | 3, 6, 9, 12 сард | Monthly + CIT accrual + IC reconciliation | Ерөнхий нягтлан + CFO |
| **Year-end close** | Дараа жилийн 1-р сард | Quarterly + Annual close + Deferred tax + Fair value reval | Ерөнхий нягтлан + CFO + Audit |

---

## 2. Pre-close checklist (бүх period type-д)

| # | Check | Owner | Status check |
|---|-------|-------|--------------|
| 1 | Бүх draft journal нь posted эсвэл deleted | Тооцооний нягтлан | `SELECT COUNT(*) FROM journal_entries WHERE status='draft'` |
| 2 | Бүх AR invoice posted | AR нягтлан | `SELECT COUNT(*) FROM ar_invoices WHERE posting_status='draft'` |
| 3 | Бүх AP invoice posted | AP нягтлан | `SELECT COUNT(*) FROM ap_invoices WHERE posting_status='draft'` |
| 4 | Bank reconciliation 100% matched | Тооцооний нягтлан | `bank_reconciliations.status='complete'` |
| 5 | Inventory counting (нэг улирал тутамд хамгийн багадаа 1) | Бараа материалын нягтлан | `inv_counting.status='confirmed'` for current period |
| 6 | Outstanding approval requests = 0 | All | `SELECT COUNT(*) FROM approval_requests WHERE status='pending'` |
| 7 | All cash transactions posted | Cash нягтлан | `cash_transactions.posting_status='draft'` count = 0 |
| 8 | Production orders status='completed' (Mfg only) | Үйлдвэрлэлийн менежер | `production_orders.status='in_progress'` count = 0 |
| 9 | **Segment completeness** — required сегмент хоосон line байхгүй | Тооцооний нягтлан | `SELECT COUNT(*) FROM journal_entry_lines jel JOIN journal_entries je ON jel.journal_entry_id=je.id WHERE je.period=:p AND (jel.s1 IS NULL OR jel.s3 IS NULL OR jel.s9 IS NULL OR (jel.s3 LIKE '10%' OR jel.s3 LIKE '11%') AND COALESCE(jel.s8,'0000')='0000')` (cash-line CF-required check багтана) |
| 10 | Сегмент мастер бүгд `is_active = true` (period-д ашигласан коднууд) | Тооцооний нягтлан | Lookup join — pending posting-д inactive segment байх ёсгүй |

> **Pre-close gate:** Бүх 10 check pass болохгүй бол close-ийн UI button disabled.

---

## 3. Monthly close end-to-end workflow

```
┌─────────────────────────────────────────────────────────────┐
│ MONTHLY CLOSE (e.g., 2026-04-30 хаах)                       │
└─────────────────────────────────────────────────────────────┘

Step 0: Pre-checks (Section 2)
        ↓
Step 1: Depreciation run (FA module)
        ↓ POST /api/fa-depreciation/run {period: 'APR-26'}
        ↓ Generates aggregated journal: Dr 70000001 / Cr 21000099
        ↓ UPDATE fa_depreciation_schedule status='posted'
        ↓ Lease (IFRS 16) period posting parallel:
        ↓   POST /api/lease-contracts/:id/post-period
        ↓
Step 2: FX revaluation (Cash module)
        ↓ For each foreign currency (USD, CNY, etc.):
        ↓   POST /api/cash-reports/fx-reval {as_of, currency, rate}
        ↓   Reval all USD bank_accounts + ar_invoices + ap_invoices
        ↓   Generate journal Dr/Cr 87000003 / asset/liab
        ↓   UPDATE last_reval_rate
        ↓
Step 3: Accruals (manual, Тооцооний нягтлан)
        ↓ Accrued expenses (utilities, salaries period-end portion)
        ↓ Accrued revenue (services rendered, not invoiced)
        ↓ Manual journals: Dr expense / Cr 31900001 accrued liability
        ↓ adjustment_type='accrual'
        ↓
Step 4: Cost allocation rules run (Cost module, Manufacturing tenant)
        ↓ POST /api/cost-allocation-rules/run {period: '2026-04'}
        ↓ Service center → operating center cascade
        ↓ Sequenced rules execute (lower → higher)
        ↓ Per rule: source pool / driver weight → target allocations
        ↓
Step 5: Manufacturing close (Manufacturing tenant)
        ↓ For each completed production order:
        ↓   POST /api/production-orders/:id/close
        ↓   Compute 4-way variance (MPV/MQV/LV/OHV)
        ↓   Flush WIP residual to 60000004 variance
        ↓
Step 6: Inventory NRV review (Бараа материалын нягтлан)
        ↓ Identify items: selling_price < avg_cost (slow-moving)
        ↓ Manual journal: Dr 87100005 / Cr 14000001
        ↓ adjustment_type='regular', module='gl'
        ↓
Step 7: AR ECL provision (AR module, Тооцооний нягтлан)
        ↓ POST /api/ar-reports/ecl/post {as_of_date}
        ↓ Compute aging × bucket rates → totalECL
        ↓ delta = totalECL - prior_ECL
        ↓ If |delta| >= 0.005:
        ↓   Journal: Dr 87000002 / Cr 12000099 (or reverse)
        ↓
Step 8: Reclassification (manual, ad-hoc)
        ↓ Misclassified expenses → correct cost center
        ↓ Cost module manual allocations
        ↓
Step 9: Period close checklist all_completed
        ↓ UPDATE gl_period_close_checklist:
        ↓   depreciation_posted = TRUE
        ↓   fx_reval_posted = TRUE
        ↓   accruals_posted = TRUE
        ↓   reclassification_posted = TRUE
        ↓ all_completed (GENERATED) = TRUE
        ↓
Step 10: Approval (Ерөнхий нягтлан + CFO)
        ↓ Period close approval request
        ↓ Both must approve
        ↓
Step 11: Generate snapshots (immutable)
        ↓ INSERT gl_period_snapshots:
        ↓   trial_balance, ar_aging, ap_aging,
        ↓   inventory_valuation, bs_summary, pnl_summary
        ↓
Step 12: Lock period
        ↓ UPDATE gl_periods SET status='closed', closed_at=NOW(), closed_by=user_id
        ↓ Subsequent posts to closed period → 403 (checkPeriodOpen guard)
        ↓
Step 13: Notify
        ↓ Email to stakeholders: "April 2026 closed"
        ↓
Step 14: Reverse next period
        ↓ Day 1 of next period: auto-reverse FX reval entries
        ↓ adjustment_type='reversing'
        ↓ Net P&L impact = realized FX only
        ↓
DONE.
```

---

## 4. Quarterly close (additional steps over Monthly)

```
┌─────────────────────────────────────────────────────────────┐
│ QUARTERLY CLOSE (e.g., Q2 2026: Apr-May-Jun)                 │
│ Trigger date: 2026-07-01 to 2026-07-20 (CIT filing deadline)│
└─────────────────────────────────────────────────────────────┘

[Run all Monthly close steps for June]
        ↓
Step Q1: НӨАТ Q-summary (Tax module, Татварын мэргэжилтэн)
        ↓ Verify monthly TT-01 filings filed for Apr/May/Jun
        ↓ Quarterly aggregate report
        ↓
Step Q2: AGIS reconciliation (Тооцооний нягтлан)
        ↓ GET /api/agis/reconciliation/run?period_year=2026&period_num=6
        ↓ For each (company A, company B) pair:
        ↓   A_balance vs B_balance check
        ↓ Mismatches → drill-down → adjustment journals
        ↓
Step Q3: ААНОАТ (CIT) computation (Tax module)
        ↓ accounting_profit = YTD net income (Q1 + Q2)
        ↓ Adjustments JSON: depreciation_diff, fines, prior_year_loss, etc.
        ↓ taxable_income = profit + add - sub
        ↓ tier1_base, tier2_base → tax_amount
        ↓ delta = tax_amount - prior_cit_ytd
        ↓ POST /api/cit-computations
        ↓ Journal: Dr 70000004 / Cr 31000003 (delta)
        ↓
Step Q4: НДШ-26-Q-001 / ХХОАТ summary (Tax/Payroll)
        ↓ Quarterly summary export for МТА submission
        ↓
Step Q5: Approval (CFO + Ерөнхий нягтлан + Tax specialist)
        ↓
Step Q6: Submit filings to МТА portal
        ↓ TT-01 (monthly NЭАТ),
        ↓ ААНОАТ-Q2 form,
        ↓ ХХОАТ-Q form
        ↓
DONE.
```

---

## 5. Year-end close (additional steps over Quarterly)

```
┌─────────────────────────────────────────────────────────────┐
│ YEAR-END CLOSE (e.g., 2026-12-31)                           │
│ Trigger: 2027-01-01 to 2027-03-31 (annual filing deadline)  │
└─────────────────────────────────────────────────────────────┘

[Run all Quarterly close steps for Dec / Q4]
        ↓
Step Y1: Annual physical inventory (Бараа материалын нягтлан)
        ↓ Full warehouse count (all items, all warehouses)
        ↓ Variance journal-уудыг post
        ↓ NRV write-down review (annual)
        ↓
Step Y2: FA fair value revaluation (FA module, IFRS 13 — optional policy)
        ↓ For asset categories with revaluation policy:
        ↓   POST /api/fa-reports/fair-value/revalue
        ↓   Per asset: market_quote / DCF / comparable_sales
        ↓   Delta split between OCI (revaluation reserve) and P&L
        ↓
Step Y3: FA impairment annual review (IAS 36)
        ↓ Indicators check on all assets
        ↓ Any impaired → POST /api/fa-reports/impairment/assess
        ↓
Step Y4: IFRS 5 held-for-sale review
        ↓ Identify candidates (asset borluulahaar shiidvэрsen)
        ↓ Reclassify, write-down to FVLCD
        ↓
Step Y5: IAS 28 equity method review
        ↓ Investee profit/loss share recognized
        ↓ Impairment indicator on investments
        ↓
Step Y6: IAS 12 Deferred tax (Tax module)
        ↓ POST /api/deferred-tax/scan {as_of: '2026-12-31'}
        ↓ Identify temporary differences:
        ↓   FA book NBV vs tax NBV
        ↓   ECL provision (book deduct, tax don't yet)
        ↓   ROU asset vs tax (IFRS 16)
        ↓   Provisions, accruals, etc.
        ↓ Compute net DTA / DTL
        ↓ Adjust to current vs prior period balance
        ↓ Journal: Dr/Cr 26000001 DTA / 33000002 DTL / 70000004
        ↓
Step Y7: Annual ААНОАТ (CIT) reconciliation
        ↓ period_kind='annual'
        ↓ Final tax computation (vs Q4 estimate)
        ↓ Balancing payment / refund
        ↓
Step Y8: Year-end closing entries (GL module)
        ↓ Close revenue accounts:
        ↓   Dr 5xxxxxxx Revenue → Cr 44000099 Income summary
        ↓ Close expense accounts:
        ↓   Dr 44000099 Income summary → Cr 6/7/8xxxxxxx Expenses
        ↓ Close income summary:
        ↓   Dr 44000099 net → Cr 44000001 Retained earnings (if profit)
        ↓ adjustment_type='closing'
        ↓
Step Y9: Generate annual snapshots
        ↓ Trial balance, BS, P&L, CF as of Dec 31
        ↓ Notes / disclosures
        ↓
Step Y10: External audit prep
        ↓ Export audit_logs CSV (full year)
        ↓ Trial balance + supporting schedules
        ↓ Auditor read-only access provisioned
        ↓
Step Y11: Approval (CFO + Audit Committee)
        ↓
Step Y12: Submit annual filings
        ↓ ААНОАТ annual form
        ↓ ХХОАТ annual form (employee 12-mo income)
        ↓ Statutory financial statements (МТА + Стат хороо)
        ↓
Step Y13: Lock all 12 periods + open new fiscal year
        ↓ UPDATE gl_periods SET status='closed' for all 2026 periods
        ↓ Auto-create 2027 periods (if not seeded)
        ↓
DONE.
```

---

## 6. Per-module checklist (monthly close)

| Module | Pre-close check | Posting actions | Post-close validation |
|--------|-----------------|-----------------|----------------------|
| **GL** | Все draft journals posted | Manual accruals/reclass | Trial balance balances |
| **AR** | Все invoices posted | ECL provision | Aging snapshot |
| **AP** | Все invoices posted | – | AP balance reconciled |
| **Cash** | Bank reconciliation 100% | FX revaluation | Bank balances match book |
| **Inventory** | Counting confirmed | NRV write-down (if any) | Inv valuation snapshot |
| **FA** | Все acquisitions posted | Depreciation run, lease period | Asset register snapshot |
| **Payroll** | Run posted + disbursed | – | Salary payable balance reconciled |
| **POS** | Z-report cash deposited | – | Sales summary snapshot |
| **AGIS** | – | Reconciliation matrix (quarterly only) | Зөрчил резон 0 |
| **Cost** | – | Allocation rules run | Center balance check |
| **Mfg** | Все production orders completed | Close + variance flush | WIP balance ≤ tolerance |
| **Tax** | – | НӨАТ settlement (TT-01) | Tax payable balance recorded |
| **Reports** | – | Snapshot generation | Снэпшот 6 type created |

---

## 7. Concurrency & rollback

### 7.1 Period close идэвхтэй ажиллаж байх hugatsaa

- Period status='closing' (intermediate state, TBD V1.07)
- Бусад users-ийн Post attempt-ыг warn but allow (зарим business need)
- Close-ийн дараа гэхдээ retroactive posts блок

### 7.2 Period reopen (rare scenarios)

```
[Superadmin only — audit + reason required]
POST /api/gl/periods/:id/reopen {reason}
        ↓
UPDATE gl_periods SET status='open', closed_at=NULL
INSERT audit_logs (reason, by_whom, prior_close_date)
        ↓
[Snapshots remain frozen — they were captured at close time]
[New posts to reopened period allowed]
[Re-close required, generates new snapshot if already closed]
```

> **Risk:** Reopen affects downstream filings (TT-01, CIT) if already submitted; manual amendment needed.

### 7.3 Rollback ordering

If close fails midway, manual recovery:

1. Identify failed step (gl_period_close_checklist columns)
2. Reverse posted journals from later steps via `adjustment_type='reversing'`
3. Re-run from failed step

---

## 8. UI / UX patterns

### 8.1 Period close dashboard

Single page on `/modules/gl/periods/:id`:

- 12-step checklist with status (✓/⚠/✗)
- Per-step "Run" button (disabled until prior steps done)
- Approval queue for current step
- Real-time count of pending items per pre-check

### 8.2 Status flow visualization

```
[Open] → [Pre-checks complete] → [Posting in progress] → [Approval pending] → [Closed]
                                                                              ↓
                                                                    (re-open: rare, audit)
```

### 8.3 Notification channels

- Email to stakeholders at each major step completion
- Slack / chat (TBD V1.07)
- Dashboard banner: "April 2026 close in progress — DO NOT post April-dated journals"

---

## 9. Common pitfalls

| Issue | Cause | Recovery |
|-------|-------|----------|
| Trial balance doesn't balance | Missed reversing entry | Identify in journal_entries; manual reverse |
| FX reval posted twice | Cron / manual conflict | Reverse one (same date adjustment_type='reversing') |
| Depreciation run for closed period | Date mismatch | Reverse, re-run for correct period |
| ECL delta sign wrong | Aging matrix change mid-period | Check `ar_ecl_provisions.prior_ecl`; manual correction |
| CIT prior_cit_ytd off | Q1/Q2 tax computation forgot to post | Adjust quarterly; recompute |
| Mfg WIP residual not zero | Missing labor charge | Add charge OR adjust to variance during close |
| AGIS mismatch | Counterparty company didn't post | Investigate via reconciliation matrix |
| Year-end snapshot missing | Close ran but snapshot generation failed | Manual SQL `INSERT gl_period_snapshots` from current data |

---

## 10. Tax filing deadlines (Mongolian)

| Filing | Period | Deadline | Module |
|--------|--------|----------|--------|
| **TT-01** (НӨАТ monthly) | Each month | 10th of next month | Tax |
| **НДШ filing** (Social Insurance) | Each month | 5th of next month | Payroll/Tax |
| **ХХОАТ filing** (PIT monthly) | Each month | 10th of next month | Payroll/Tax |
| **ААНОАТ-Q1/Q2/Q3/Q4** (CIT) | Quarterly | 20th of month after Q-end | Tax |
| **ААНОАТ annual** | Year-end | March 1 of following year | Tax |
| **eBarimt daily report** | Each day | 00:00 cron auto-submit | Tax/POS |
| **Stat report** | Quarterly | TBD | Reports |

> Late filing penalty: 0.1% per day × tax amount (Mongolian Tax Administration Law).

---

## 11. Period close checklist (`gl_period_close_checklist` schema)

```sql
CREATE TABLE gl_period_close_checklist (
  period_id INTEGER REFERENCES gl_periods(id),
  depreciation_required BOOLEAN DEFAULT TRUE,
  depreciation_posted BOOLEAN DEFAULT FALSE,
  depreciation_journal_id UUID,
  fx_reval_required BOOLEAN DEFAULT TRUE,
  fx_reval_posted BOOLEAN DEFAULT FALSE,
  fx_reval_journal_id UUID,
  accruals_required BOOLEAN DEFAULT FALSE,
  accruals_posted BOOLEAN DEFAULT FALSE,
  accruals_note TEXT,
  reclassification_required BOOLEAN DEFAULT FALSE,
  reclassification_posted BOOLEAN DEFAULT FALSE,
  reclassification_note TEXT,
  -- Computed: all required steps posted
  all_completed BOOLEAN GENERATED ALWAYS AS (
    (NOT depreciation_required OR depreciation_posted) AND
    (NOT fx_reval_required OR fx_reval_posted) AND
    (NOT accruals_required OR accruals_posted) AND
    (NOT reclassification_required OR reclassification_posted)
  ) STORED,
  closed_at TIMESTAMPTZ,
  closed_by UUID
);
```

---

## 12. Approval workflow for period close

| Period type | Required approvals |
|-------------|--------------------|
| Monthly | Ерөнхий нягтлан (1 person) |
| Quarterly | Ерөнхий нягтлан + CFO (2 person sequential) |
| Year-end | Ерөнхий нягтлан + CFO + Audit Committee (3 person) |

Reuses `Approvals` module:
- entity_type='period_close'
- threshold=0 (always require)
- required_role='chief_accountant' (or chained)

---

## 13. Segment completeness check (V1.07)

Pre-close validation block нь `journal_entry_lines.s1..s10` багана бүгд бөглөгдсөн эсэхийг шалгана. Required matrix: [01-gl-posting-matrix.md §7.1](./01-gl-posting-matrix.md). Дэлгэрэнгүй: [01-architecture/07-segment-strategy.md §7.6.8](../01-architecture/07-segment-strategy.md).

```sql
-- Segment completeness audit query (period close pre-check)
WITH missing AS (
  SELECT je.id AS journal_id,
         jel.id AS line_id,
         CASE WHEN jel.s1 IS NULL THEN 's1' END AS m1,
         CASE WHEN jel.s3 IS NULL THEN 's3' END AS m3,
         CASE WHEN jel.s9 IS NULL THEN 's9' END AS m9,
         CASE WHEN (jel.s3 LIKE '10%' OR jel.s3 LIKE '11%')
              AND COALESCE(jel.s8,'0000')='0000' THEN 's8 (cash line CF code missing)' END AS m8
  FROM journal_entry_lines jel
  JOIN journal_entries je ON jel.journal_entry_id=je.id
  WHERE je.tenant_id=:tenant_id AND je.period_id=:period_id
)
SELECT * FROM missing
WHERE m1 IS NOT NULL OR m3 IS NOT NULL OR m9 IS NOT NULL OR m8 IS NOT NULL;
```

**Resolution paths:**
- Missing segment бүхий line бий бол close хориглодог (UI хариу: "X line-д сегмент дутуу байна — драфт болгон засах").
- Чийн закрытие хүсэх бол manual posting reverse + repost.

**Audit log:** Pre-close validation үр дүнг audit-д хадгална (entity_type=`period_close`, action=`pre_close_validation`, payload=missing rows).

---

## 14. Холбоотой баримт

- [Module 01: GL](../02-modules/01-gl.md) — Period management + close
- [Module 06: FA](../02-modules/06-fa.md) — Depreciation
- [Module 04: Cash](../02-modules/04-cash.md) — FX revaluation
- [Module 11: Manufacturing](../02-modules/11-manufacturing.md) — Production close
- [Module 12: Tax](../02-modules/12-tax.md) — VAT/CIT/Deferred tax
- [Module 17: Approvals](../02-modules/17-approvals.md) — Approval workflow
- [Module 18: Audit](../02-modules/18-audit.md) — Close audit trail
- [GL Posting Matrix](./01-gl-posting-matrix.md) — Per-step posting templates
- [Architecture: Segment strategy](../01-architecture/07-segment-strategy.md) — segment validation + completeness
