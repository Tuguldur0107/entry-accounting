# Cross-module 05 — Event Flows (Модуль хоорондын урсгал)

> **Зорилго:** Entry-ийн модулиуд бизнесийн нэг үйлдлийн дотор **хоорондоо хэрхэн өгөгдөл солилцдог** — нэг хэрэглэгчийн click нь **n хүснэгтэд INSERT/UPDATE** үүсгэнэ. Энэ файл event тус бүрийг sequence-table хэлбэрээр задална.
>
> **Хэрэгтэй бол:** Шинэ хөгжүүлэгч "AR invoice post-логдох үед хаашаа юу очих вэ?" гэж ойлгохын тулд эхэндээ энэ файлыг ширтэнэ. Module file-ууд (`02-modules/`) тус тусдаа модулийн дотоод бүтэц, харин энэ файл хоорондын **flow**-ийг нэгтгэнэ.

---

## 0. Event flow notation

Бүх flow дараахь форматтай:

```
[Trigger] (хэн / хаана click)
   ↓
[Step 1] Module A → action ──→ table X
   ↓
[Step 2] Module B → reaction ──→ table Y
   ↓
[Step n] ...
   ↓
[End state] эцсийн posting / status
```

**Уралдаан / failure tolerance:**
- ✅ Бүх step нэг DB transaction (атомик) — хэрвээ алхам алддаг бол rollback бүгд
- ⏳ Async (job queue) — өөр transaction, retry дэмжсэн (eBarimt, AI proposal)
- 🔁 Idempotent — давтан дуудахад зөв (POST /post endpoint бүгд)

---

## 1. Event catalog (нийт 14 гол flow)

| # | Event | Trigger | Affected modules | Section |
|---|-------|---------|---------|--------|
| E1 | AR invoice post | "Post" товч | AR → GL → (Tax хэрэв VAT) | §2 |
| E2 | AR payment received | "Төлбөр бичих" | Cash → AR → GL | §3 |
| E3 | AP bill received & post | "Post" товч | AP → Inventory (landed cost) → GL → Tax | §4 |
| E4 | AP payment scheduled | Payment run | AP → Cash → GL → (WHT хэрэв applicable) | §5 |
| E5 | Inventory issue (sale/use) | POS sale OR manual issue | Inventory → GL → Cost (Mfg) | §6 |
| E6 | Inventory receipt | AP bill OR Mfg complete | Inventory → GL → AP/Mfg | §7 |
| E7 | POS sale (atomic) | Cashier checkout | POS → Inventory → GL → Tax → Cash → eBarimt(async) | §8 |
| E8 | Production order completion | "Завсар → Дуусгах" | Mfg → Inventory (FG receipt) → Cost → GL | §9 |
| E9 | Period close (month-end) | Sysadmin batch | All modules → Reports → GL (period flag) | §10 |
| E10 | Payroll run | "Цалин batch" | Payroll → GL → Tax (PIT/SI) → Cash (next pay) | §11 |
| E11 | FA depreciation (monthly) | Period close | FA → GL | §12 |
| E12 | FX revaluation (period close) | Period close | Cash → AR → AP → GL | §13 |
| E13 | AGIS intercompany post | Manual or auto | AGIS → GL (CompanyA) → GL (CompanyB) — dual-journal | §14 |
| E14 | AI proposal accept | Чат: "Энэ журналыг үүсгэ" | Agents → Approvals → GL | §15 |

---

## 2. E1 — AR invoice post

**Trigger:** AR module-ийн Invoice List/View хуудаснаас "Post" товч (`POST /api/ar-invoices/:id/post`).

```
[Тооцооний нягтлан clicks "Post"]
   ↓
[Step 1] AR → validate
   - status === 'draft' (?), ar_invoice_lines exist, customer != null
   - period.is_open === true (period модуль шалгана)
   ↓
[Step 2] AR → upsert ar_invoices.status='posted', posted_at=NOW()
   ↓
[Step 3] AR → INSERT journals (header)
   - tenant_id, company_id, period_id, journal_date, source='ar', source_id=invoice.id
   ↓
[Step 4] AR → INSERT journal_lines (Dr/Cr)
   - Dr 13110000 Авлага              total_amount (MNT экв)
   - Cr 51xxxxxx Орлого              subtotal
   - Cr 31410000 НӨАТ output         vat_amount (хэрвээ vat_mode≠'none')
   - Балансыг шалгана: SUM(Dr) === SUM(Cr)
   ↓
[Step 5] AR → INSERT ar_invoice_postings (link table)
   - invoice_id ↔ journal_id (reverse мөшгилт)
   ↓
[Step 6 — async] Tax module → eBarimt ⏳
   - Хэрвээ POS биш ердийн B2B invoice бол eBarimt async submit (retry 3×)
   - ebarimt_submissions хүснэгтэд логлогдоно
   ↓
[Step 7 — sync] Approval module → хэрэв total > approval_threshold
   - approval_requests INSERT, status='pending'
   - CFO мэдэгдэл (in-app notification)
   - Хэрвээ approval pending байвал journal-ийг draft хэвээр үлдээх боломжтой (configurable)
   ↓
[End state] AR balance, GL trial balance, VAT output ledger бүгд тогтоно
```

**Атомик хил:** Step 1-5 нэг DB transaction. Step 6 тусдаа (eBarimt outage үед AR post саадгүй гарна). Step 7 syncronous — approval хүлээгдэж буй бол UI-д "Approval pending" badge.

**Affected tables:**
- AR: `ar_invoices`, `ar_invoice_postings`
- GL: `journals`, `journal_lines`
- Tax: `ebarimt_submissions` (async)
- Approvals: `approval_requests` (хэрэв threshold)

---

## 3. E2 — AR payment received

**Trigger:** Cash модуль (Bank reconciliation) эсвэл AR Invoice View "Төлбөр бичих" (`POST /api/ar-payments`).

```
[Cashier эсвэл тооцооний нягтлан "Төлбөр бичих"]
   ↓
[Step 1] AR → validate
   - invoice.balance > 0 (paid биш), payment_amount ≤ balance (overpay rejection)
   - bank_account_id exists in cash module
   ↓
[Step 2] AR → INSERT ar_payments
   - invoice_id, amount, payment_date, method, bank_account_id, reference
   ↓
[Step 3] AR → UPDATE ar_invoices.paid_amount += amount
   - Хэрвээ balance === 0 → status='paid'
   - Хэрвээ 0 < balance < total → status='partial'
   ↓
[Step 4] Cash → INSERT bank_transactions
   - direction='inflow', source='ar_payment', source_id=payment.id
   ↓
[Step 5] GL → INSERT journals + lines
   - Dr 11210000 Банкны харилцах    amount
   - Cr 13110000 Авлага              amount
   ↓
[Step 6] AR → INSERT ar_payment_postings (link)
   ↓
[End state] AR aged balance буурна, Cash bank balance нэмэгдэнэ, GL trial balance балансал
```

**Атомик хил:** Бүх step нэг transaction.

**Тусгай тохиолдол:** Bank statement import ⇒ auto-match ⇒ payment record үүсгэх (Cash module §4.4-ийг үз).

---

## 4. E3 — AP bill receive & post

**Trigger:** AP module "Post" товч (`POST /api/ap-bills/:id/post`).

```
[Тооцооний нягтлан clicks "Post"]
   ↓
[Step 1] AP → validate (vendor exists, lines balanced, period open)
   ↓
[Step 2] AP → UPDATE ap_bills.status='posted'
   ↓
[Step 3] Inventory branch — хэрвээ bill line.account_code → inventory account (15xxxxxx)
   - Inventory module → INSERT inv_movements (direction='in', cost=line.amount/qty)
   - Weighted-avg cost UPSERT (стандарт IAS 2)
   - Landed cost: freight/duty bill line бол cost-д capitalize (IAS 2.11)
   ↓
[Step 4] GL → INSERT journals + lines
   - Dr 15xxxxxx Бараа материал OR 7xxxxxxx Зардал   subtotal
   - Dr 31420000 НӨАТ input                         vat_amount (vat_mode≠'none')
   - Cr 31110000 Өглөг                              total_amount
   - Cr 31430000 НДӨЯТ withholding                   wht_amount (хэрвээ WHT applicable)
   ↓
[Step 5 — async] Tax → input VAT register, WHT submission queue
   ↓
[End state] AP balance, Inventory on-hand & cost, VAT input ledger тогтоно
```

**Тусгай тохиолдол:** Landed cost (тээвэр, гааль, даатгал) — `ap_landed_cost_flag=true` бол Inventory module-д capitalize, GL-д 15xx-р posting (IAS 2.11). Зүгээр зардал бол 7xxx (Module 03 AP §4.6).

---

## 5. E4 — AP payment scheduled

**Trigger:** Cash module "Payment run" эсвэл AP "Төлбөр бичих" товч.

```
[Тооцооний нягтлан starts payment run]
   ↓
[Step 1] AP → SELECT ap_bills WHERE status='posted' AND balance > 0 AND due_date ≤ ?
   ↓
[Step 2] Cash → үүсгэх payment file (XML/CSV for bank — §06-integrations/02-banks.md)
   ↓
[Step 3] (Bank confirms — manual upload of confirmation OR ACH callback)
   ↓
[Step 4] AP → INSERT ap_payments + UPDATE ap_bills.balance
   ↓
[Step 5] Cash → INSERT bank_transactions (direction='outflow')
   ↓
[Step 6] GL → INSERT journals + lines
   - Dr 31110000 Өглөг                  amount
   - Cr 11210000 Банкны харилцах        amount
   - Cr 31430000 WHT (хэрвээ WHT)        wht_amount (additive — vendor non-resident бол)
   ↓
[End state] AP balance буурна, Cash buurна, WHT submission хийгдэнэ
```

---

## 6. E5 — Inventory issue (sale/use)

**Trigger:** POS sale (sub-event of E7), AR-ийн goods invoice, manual stock issue, OR Manufacturing раздача DM.

```
[Trigger module → "Issue stock"]
   ↓
[Step 1] Inventory → validate quantity_on_hand ≥ requested_qty (FOR UPDATE row lock)
   ↓
[Step 2] Inventory → INSERT inv_movements (direction='out', qty, cost=avg_cost)
   - Weighted-avg method: cost_per_unit-ийг UPSERT-ээр шинэчлэхгүй (issue-д зөвхөн хэрэглэнэ)
   ↓
[Step 3] Inventory → UPDATE inv_balances.quantity_on_hand -= qty
   ↓
[Step 4 — branch] GL posting
   - Хэрвээ POS sale (E7): Cr 15xx Бараа / Dr 61xxxxxx COGS  cost
   - Хэрвээ Mfg DM issue (E8): Cr 15xx / Dr 12xx WIP        cost
   - Хэрвээ Sample/Loss: Cr 15xx / Dr 6xxx Зардал           cost
   ↓
[Step 5 — async] RFID / EAS lifecycle (хэрвээ tagged item)
   - eas_deactivations queue → EAS gate-аас suppress
   ↓
[End state] On-hand qty/value буурна, COGS or WIP bookings updated
```

---

## 7. E6 — Inventory receipt

**Trigger:** AP bill post (E3), Manufacturing complete (E8), эсвэл manual receipt.

```
[Trigger module → "Receive stock"]
   ↓
[Step 1] Inventory → INSERT inv_movements (direction='in', qty, cost)
   ↓
[Step 2] Inventory → UPSERT weighted-avg cost
   - new_avg = (old_qty × old_cost + new_qty × new_cost) / (old_qty + new_qty)
   ↓
[Step 3] Inventory → UPDATE inv_balances.quantity_on_hand += qty
   ↓
[Step 4 — branch] GL posting
   - AP-аас (E3): Dr 15xx / Cr 31110000 Өглөг
   - Mfg complete (E8): Dr 15xx FG / Cr 12xx WIP
   - Manual adjustment: Dr 15xx / Cr 6xxx Adjustment
   ↓
[End state] On-hand qty/value нэмэгдэнэ
```

---

## 8. E7 — POS sale (atomic)

**Trigger:** Касс "Cashout" товч (`POST /api/pos/sales`).

> Энэ нь хамгийн **их модуль* бүхий event — атомик 1 transaction-д 7 модуль өөрчлөлт хийнэ.

```
[Cashier scans items + clicks "Cashout"]
   ↓
[Step 1] POS → validate cart, payments, customer (опционал)
   ↓
[Step 2] POS → INSERT pos_sales + pos_sale_lines
   ↓
[Step 3] Inventory → multi-line FOR UPDATE lock; INSERT inv_movements (direction='out') × n
   ↓
[Step 4] GL → INSERT journals + lines (1 journal, 4-5 lines)
   - Dr 11110000 Касс / 11210000 Банк    amount (per payment method)
   - Cr 51110000 Борлуулалтын орлого       subtotal
   - Cr 31410000 НӨАТ output               vat_amount
   - Dr 61110000 COGS                      total_cost
   - Cr 15xxxxxx Бараа                     total_cost
   ↓
[Step 5] Tax → INSERT vat_output_register
   ↓
[Step 6] Cash → INSERT bank_transactions OR cash_drawer_movements
   ↓
[Step 7 — async] eBarimt ⏳
   - ebarimt_submissions queue → external service (retry 3×, max 24h)
   - Receipt QR code customer-д display (offline бол later mail)
   ↓
[Step 8 — async] RFID/EAS deactivate
   - SGTIN-96 tag-ийг "sold" status болгоно (EAS gate alert suppress)
   ↓
[End state] Sale закрыт, inventory шинэчлэгдсэн, GL posted, eBarimt queue-д
```

**Атомик хил:** Step 1-6 нэг DB transaction. Step 7-8 async (eBarimt outage үед sale зогсохгүй; retry queue ажилладаг).

---

## 9. E8 — Production order completion

**Trigger:** Manufacturing module "Завсараас → Дуусгах" товч (`POST /api/production-orders/:id/complete`).

```
[Production manager clicks "Complete"]
   ↓
[Step 1] Mfg → validate state='in_progress'; actual_qty > 0
   ↓
[Step 2] Cost (Manufacturing tenant only) → 4-way variance compute
   - MPV (Material Price Variance), MQV (Material Qty Variance)
   - LV (Labour Variance), OHV (Overhead Variance)
   ↓
[Step 3] Inventory → INSERT inv_movements (FG receipt, qty, cost=actual)
   - Component issue movements аль хэдийн өмнө бичигдсэн (release дээр)
   ↓
[Step 4] GL → INSERT journals + lines
   - Cr 12xx WIP                        std_cost × qty
   - Dr 15xx FG                          std_cost × qty
   - Dr/Cr 7xxx Variance accounts        4-way splits (MPV/MQV/LV/OHV)
   ↓
[Step 5] Mfg → UPDATE production_orders.state='completed', actual_completion_at=NOW()
   ↓
[Step 6] Mfg → INSERT production_order_variances (snapshot for audit)
   ↓
[End state] WIP cleared, FG inventory заасан standard cost-оор бичигдсэн, variance posting GL-д
```

**Гол шийдвэр:** WIP-ийг standard cost-оор хаах ⇒ variance журнал тусдаа гарна (IAS 2.13). Actual cost-оор хаах нь IAS-д зөвшөөрөгдөнө гэвч standard cost + variance арга нь cost analysis/budget-ийн үнэ цэнэтэй мэдээлэл өгнө.

---

## 10. E9 — Period close (month-end)

**Trigger:** Sysadmin / CFO "Period close" батч (Module 14 reports).

> Дэлгэрэнгүй [02-period-close.md](./02-period-close.md)-аас үзнэ үү. Энд хураангуй cross-module flow.

```
[CFO triggers period close]
   ↓
[Step 1] All transactional modules → freeze (period.is_open=false)
   ↓
[Step 2] Inventory → counting variance journal (хэрвээ stock count байгаа)
   ↓
[Step 3] FA → depreciation journal (E11)
   ↓
[Step 4] Cash/AR/AP → FX revaluation (E12)
   ↓
[Step 5] AR → ECL provision adjustment (delta posting)
   ↓
[Step 6] Tax → deferred tax recompute (IAS 12); ААНОАТ YTD delta
   ↓
[Step 7] AGIS → intercompany reconciliation matrix (E13)
   ↓
[Step 8] Reports → snapshot TB / BS / P&L; lock numbers
   ↓
[End state] Period closed; reports immutable; next period.is_open=true
```

---

## 11. E10 — Payroll run

**Trigger:** Payroll module "Цалин batch" (`POST /api/payroll/run`).

```
[Цалингийн мэргэжилтэн starts batch]
   ↓
[Step 1] Payroll → SELECT employees WHERE active=true; load timesheet
   ↓
[Step 2] Payroll → calc gross-to-net (per employee)
   - Gross = base + overtime + bonus
   - НДШ employee 11.5%, employer 12.5% (cap = 10× minimum wage)
   - ЭМД 1%/1%
   - ХХОАТ progressive (10/15/20%) - 240k credit
   - Net = Gross - all deductions
   ↓
[Step 3] Payroll → INSERT payslips + payslip_lines (per employee)
   ↓
[Step 4] GL → INSERT journals + lines (single journal, multi-line)
   - Dr 7xxxxxxx Цалингийн зардал         total_gross
   - Dr 7xxxxxxx Ажил олгогчийн НДШ        total_employer_si
   - Cr 31510000 Цалингийн өглөг           total_net (employee)
   - Cr 31610000 НДШ өглөг (засаг руу)     total_si_payable
   - Cr 31620000 ЭМД өглөг                 total_hi_payable
   - Cr 31410000 ХХОАТ withholding         total_pit_payable
   ↓
[Step 5] Cash → SCHEDULE bank transfer for each employee (next pay date)
   - bank_transactions queue, status='scheduled'
   ↓
[Step 6 — async] Tax → НДШ + ХХОАТ filing schedule (monthly: 10th of next month)
   ↓
[End state] Payroll closed, GL bookings posted, payments scheduled, tax обязательства зарегистрирована
```

---

## 12. E11 — FA depreciation (monthly)

**Trigger:** Period close (E9 step 3) OR manual "Run depreciation".

```
[Period close → FA module]
   ↓
[Step 1] FA → SELECT fixed_assets WHERE in_service=true AND depreciated_through < period_end
   ↓
[Step 2] FA → calc per-asset depreciation
   - Method: SL / DB / DDB / units-of-production (per asset config)
   - Tax norm parallel calc (for deferred tax)
   ↓
[Step 3] FA → INSERT fa_depreciation_lines (per asset, period)
   ↓
[Step 4] GL → INSERT journals + lines (1 journal, lines per asset class)
   - Dr 7xxxxxxx Элэгдлийн зардал           per_asset_dep
   - Cr 22xxxxxx Хуримтлагдсан элэгдэл      per_asset_dep
   ↓
[Step 5] FA → UPDATE fixed_assets.depreciated_through=period_end, accumulated_dep += dep
   ↓
[End state] Дансны үнэ буурсан, элэгдлийн зардал бичигдсэн
```

---

## 13. E12 — FX revaluation (period close)

**Trigger:** Period close (E9 step 4).

```
[Period close → FX revaluation]
   ↓
[Step 1] Cash module → SELECT fx_rates AS OF period_end
   ↓
[Step 2] Per-module unrealized FX:
   - Cash → fx_rates × bank_balance (USD/EUR/CNY) → MNT delta
   - AR → invoices_open in FX × rate → MNT delta
   - AP → bills_open in FX × rate → MNT delta
   ↓
[Step 3] GL → INSERT journals + lines (per-module split journals)
   - Dr/Cr 11210000 Банк / 13110000 AR / 31110000 AP    delta (per account)
   - Cr/Dr 87xxxxxx Unrealized FX gain/loss (PnL)        delta
   ↓
[Step 4] Snapshot current FX position (ofs to next period delta calc)
   ↓
[End state] All FX-bearing accounts валcal balanced at period-end rate; PnL adjusted (IAS 21)
```

**Realized FX:** Payment occurs аль өмнө (E2/E4) ⇒ delta of (invoice_rate vs payment_rate) → realized gain/loss separately бичигдсэн.

---

## 14. E13 — AGIS intercompany post

**Trigger:** AGIS module "Үүсгэх" эсвэл auto from invoice with intercompany flag.

```
[Тооцооний нягтлан posts intercompany]
   ↓
[Step 1] AGIS → validate counterparty company exists; same tenant
   ↓
[Step 2] GL (Company A — payable side) → INSERT journals + lines
   - Dr 7xxxxxxx Зардал                  amount
   - Cr 31xxxxxx Хоорондын тооцоо өглөг  amount
   - segment6 = Company B's company_id
   ↓
[Step 3] GL (Company B — receivable side) → INSERT journals + lines (mirror)
   - Dr 13xxxxxx Хоорондын тооцоо авлага  amount
   - Cr 51xxxxxx Орлого                  amount
   - segment6 = Company A's company_id
   ↓
[Step 4] AGIS → INSERT agis_postings (link both journals)
   ↓
[Step 5 — period close] reconciliation matrix: A.payable === B.receivable
   ↓
[End state] Dual-journal posted, parity-checked, IFRS 10 elimination ready
```

---

## 15. E14 — AI proposal accept

**Trigger:** Чат-аас expert_accountant agent → "Энэ журналыг үүсгэе" → "Зөвшөөрөх" товч.

```
[User asks agent: "Энэ урагшийн төлбөрийг хэрхэн post хийх вэ?"]
   ↓
[Step 1] Agent → tool_use (get_skill, lookup tax_settings, suggest journal)
   ↓
[Step 2] Agent → INSERT proposals (status='pending', payload=journal_draft)
   ↓
[Step 3] UI → display propose card with Dr/Cr breakdown + Accept/Reject товч
   ↓
[Step 4] User clicks "Accept" → POST /api/proposals/:id/accept
   ↓
[Step 5] Approval check — хэрвээ proposal.amount > threshold → enter approval flow
   ↓
[Step 6] GL → INSERT journals + lines (with source='proposal')
   ↓
[Step 7] Wallet → debit user/tenant for token usage (IFRS 15.106 contract liability release)
   ↓
[End state] Journal posted, proposal.status='accepted', wallet billed
```

---

## 16. Кросс-flow гол хүснэгтүүд (write fan-out)

**Аль ч event нь GL-д хүрээд `journals` + `journal_lines` бичих ёстой.** Доорх хүснэгт нь modules-аас GL руу гарах "fan-out"-ийг харуулна:

| Source module | Trigger event | Журналын тоо | journal_lines (avg) | Affected non-GL tables |
|---------------|--------------|--------------|---------------------|----------------------|
| AR | E1 (post) | 1 | 3-4 | ar_invoices, ar_invoice_postings |
| AR | E2 (payment) | 1 | 2 | ar_payments, bank_transactions |
| AP | E3 (post) | 1 | 3-5 | ap_bills, inv_movements (if inv), inv_balances |
| AP | E4 (payment) | 1 | 2-3 | ap_payments, bank_transactions |
| Inventory | E5 (issue) | 1 | 2 | inv_movements, inv_balances |
| Inventory | E6 (receipt) | 1 | 2 | inv_movements, inv_balances |
| POS | E7 (sale) | 1 | 4-5 | pos_sales, pos_sale_lines, inv_movements×n, vat_output_register, ebarimt_submissions |
| Mfg | E8 (complete) | 1 | 4-7 | production_orders, production_order_variances, inv_movements |
| FA | E11 (dep) | 1 | n×2 (per asset class) | fa_depreciation_lines |
| FX | E12 | n (per module) | 2 | fx_rates snapshot |
| Payroll | E10 | 1 | 6-8 | payslips, payslip_lines |
| AGIS | E13 | 2 (dual) | 4 (combined) | agis_postings |

---

## 17. Idempotency & retry

**Бүгд /post endpoint нь idempotent:** хоёр дахин post-логдох оролдлого ба `posted_at IS NOT NULL` нь 409 Conflict буцаана.

**Async (eBarimt, RFID, AI agent):** retry queue (pg-boss / cron), exponential backoff. Failure log-уудыг `error_log` хүснэгтэд хадгална.

**Period close (E9):** rollback-возможен зөвхөн period.is_open=true байсан бол. Закрытый period-ийн journals immutable — adjustment гэвэл `prior_period_adjustment` event (current period-д бичигдэнэ).

---

## Холбоотой баримт

- [01-gl-posting-matrix.md](./01-gl-posting-matrix.md) — Account code level posting templates
- [02-period-close.md](./02-period-close.md) — Period close workflow дэлгэрэнгүй
- [03-ifrs-mapping.md](./03-ifrs-mapping.md) — IFRS standard × event mapping
- [04-tax-mapping.md](./04-tax-mapping.md) — Tax type × event mapping
- `02-modules/01-gl.md` — GL модулийн төв логик
- `01-architecture/02-data-flow.md` — HTTP request lifecycle
