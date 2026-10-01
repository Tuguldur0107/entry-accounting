# Entry — Ontology давхаргын аудит

> Огноо: 2026-09-29 · Суурь: `main` @ `9514c49` · Зөвхөн уншиж хийсэн шинжилгээ — код өөрчлөөгүй.
> Мөрийн дугаарууд энэ commit-оор. `T:` = `lib/ai/tools.ts`, `a/` = `lib/actions/`.

## Executive summary

1. Entry-д ~45 бизнесийн объект, 20+ төлвийн толь бий. Гэвч **нэг ч төлөв DB-д хамгаалагдаагүй** (бүгд `text`, `pgEnum`/`CHECK` байхгүй). Төлвийн шилжилтийн цорын ганц цэвэр загвар нь `lib/qpay/intent.ts`.
2. Шилжилтүүдийн **post/reverse нь сайн** хамгаалагдсан: транзакц доторх `UPDATE … WHERE status=<from>` claim болон `assertPeriodOpenInTx`. **Update/delete зам хамгаалалтгүй**: status predicate байхгүй тул зэрэгцээ `post`-ийг дарж бичих боломжтой.
3. **Батлагдсан АР/АП болон кассын баримтыг GL журналтай нь бүхэлд нь УСТГАХ зам** нээлттэй. MCP-ийн `delete_*` tool-оор ч ажилладаг. Энэ нь «батлагдсан журнал зөвхөн буцаалтаар» гэсэн гол дүрмийг зөрчиж байна.
4. ✅ **Засагдсан 2026-10-01.** Журналын баланс болон батлагдсан мөрийг хамгаалах DB trigger-ууд **deploy-оор тавигддаггүй байсан** (гараар). P0 хэмжилтээр SmartGPS DB-д нэг ч хамгаалалт байгаагүй, SaaS-д trigger байсан ч Дт/Кт CHECK-ийг `drizzle-kit push` deploy бүрд устгадаг байсан. Одоо `scripts/apply-ledger-invariants.mjs` push-ийн дараа deploy бүрд тавина (§7.4). Нийт 46 журнал бичих замаас 43 нь `assertBalanced`-ийг дууддаггүй — DB trigger тэднийг хамгаална.
5. Нэг дүрмийг олон газар давтан бичсэн байна. Жишээ нь эх баримтын түгжээг 5 газар, «өнөөдөр»-ийн огноог 10+ газар (заримд нь UTC-ээр) тус тусад нь хэрэгжүүлсэн. 12 журнал дугааргүй үлддэг. `beforeJournalPost` fork hook зөвхөн GL-ийн гар журналд ажилладаг.
6. MCP-ийн 155 tool-оос AI-д шууд эрсдэлтэй 8 алдаа олдсон. Жишээ нь `run_fx_revaluation` бүтэлгүйтсэн ч «амжилттай» гэж хариулдаг, журналын tool-ууд зөвхөн сүүлийн 500 журналаас хайдаг. Мөн мөнгө хөдөлгөдөг 7 tool `externalRef`-гүй тул дахин оролдоход давхар бичилт үүснэ.
7. **Санал:** `lib/ontology/` registry болон нэг `transition()` engine бүтээж, ажиглах горимоос хатуу мөрдөх горим руу модуль тус бүрээр шилжинэ. DB `CHECK`-ийг `NOT VALID` → өгөгдөл цэвэрлэх → `VALIDATE` дарааллаар нэмнэ. SmartGPS-ийн өгөгдлийг хөндөхгүй.
8. Эхний алхам болгон §7.2-ын 12 SQL-ийг SmartGPS дээр read-only байдлаар ажиллуулж, зөрчлийн хэмжээг тогтооно. Дараа нь §8-ын quick win-уудаар эхэлнэ (1–2 долоо хоног). Бүрэн ontology 6–9 долоо хоног.

---

## 0. Арга зүй ба таамаглал

- **Эх сурвалж:**
  - `lib/db/schema.ts` (4964 мөр).
  - `lib/actions/*` (55 файл).
  - `lib/ai/tools.ts` (12 827 мөр, 155 tool).
  - `lib/custom/*`, `custom/*`, `scripts/*`, `.github/workflows/*`.
- Гол олдворуудыг кодоор давхар шалгасан: §5-ын C1–C4 ба H1–H3, мөн §3-ын «FX хаягдах», «POS дугааргүй».
- **Таамаглал Т1.** Production (SmartGPS) дээр ledger trigger-ууд гараар тавигдсан эсэх **тодорхойгүй**. §7.1-ийн эхний query-ээр шалгана.
- **Таамаглал Т2.** SmartGPS нь core-оос гадна custom tool/hook ашигладаг эсэхийг энэ repo-оос харах боломжгүй. Fork-ийн `custom/`-ийг тусад нь шалгах шаардлагатай.
- **Таамаглал Т3.** `docs/New model/01-architecture.md` stack-ийг «FastAPI + React 19», tool-ын тоог «111» гэж бичсэн нь **хуучирсан** мэдээлэл. Бодит байдал: Next.js 16 + Drizzle, 155 tool.
- **Нэр томьёо:** reversal = **буцаалт**. Кодод буцаалтын туслах функцүүд нь `stornoOf` / `stornoFromMirror` нэртэй. Тайланд «буцаалт (эх талдаа, сөрөг дүнтэй)» гэж нэрлэв.

---

## 1. Entity inventory

**Ерөнхий баримтууд:**
- Бүх бизнесийн хүснэгт `organization_id → organizations` (**cascade**) болон `user_id → users` (cascade, «үүсгэсэн хэрэглэгч») багануудтай.
- Огноо нь `text 'YYYY-MM-DD'`, период нь `text 'YYYY-MM'`.
- Unique дүрмүүд нь constraint биш, **unique INDEX** хэлбэртэй (drizzle-kit #5955).
- `*_account_number` баганууд `chart_of_accounts` руу FK-гүй (текст).

### 1.1 GL, период

| Объект | Хүснэгт (schema.ts) | Төлөв | Гол талбар | FK (onDelete) | DB хамгаалалт |
|---|---|---|---|---|---|
| **JournalVoucher** | `journal_vouchers` L676 | `draft\|posted\|reversed` (L696, зөвхөн тайлбарт; default `draft`) | `date`, `documentNo` (`<МОДУЛЬ>-YY-NNNNNN`, NULL болж болно), `currency`, `exchangeRate`, `externalRef` | `reversalOfVoucherId` → өөрөө (**cascade**: эхийг устгавал буцаалт нь хамт устна) | uq(org, externalRef) L722, uq(org, documentNo) L727 |
| **JournalLine** | `journal_lines` L741 | — (толгойнх) | `accountNumber`, `debit`, `credit`, `debitFc`, `creditFc`, `businessObjectType/Id` (полиморф) | `voucherId` (cascade), `cashAccountId` (set null) | Гараар ажиллуулах SQL: `journal_lines_dr_xor_cr`, balance trigger, protect trigger (**deploy-оор тавигддаггүй**) |
| **AccountingPeriod** | `accounting_periods` L494 | `open\|closed` (L508) | `code`, `closedAt` | — | uq(org, code) L513. Snapshot хүснэгтүүд: L526, L572, L610 |
| **Account** | `chart_of_accounts` L461 | `isEnabled` | `number`, `modules` | — | uq(org, number) L479 |
| **DocumentCounter** | `document_counters` L660 | — | `scope`, `value` | — | uq(org, scope) |

### 1.2 Мөнгөн хөрөнгө

| Объект | Хүснэгт | Төлөв | Гол талбар | FK | DB |
|---|---|---|---|---|---|
| **CashDocument** | `cash_documents` L843 (мөргүй, нэг дүн) | `draft\|posted\|reversed` (L888) | `documentType` `receipt\|payment\|transfer`, `amount`, `baseAmount`, `sourceType` `manual\|pos` | from/to касс (restrict), counterparty (set null), voucher/reversalVoucher/sourceVoucher (set null), `arApDocumentId` (restrict) | uq(org, documentNo), uq(org, externalRef) |
| **BankStatement (+Line)** | `bank_statements` L929, `bank_statement_lines` L967 | `posted` (default) | `fileHash`, орлого/зарлага | statement (cascade), cashDocument/voucher (set null) | uq(org, fileHash): файл давтан импортлоход хамгаална |
| **CashFxRevaluation** | `cash_fx_revaluations` L1046 | `posted\|reversed` (тайлбаргүй) | `valuationDate`, `revision`, `closingRate`, `adjustmentAmount` | voucher (restrict, NOT NULL) | uq(org, cashAccount, date, revision) |

АР/АП-ийн ханшийн тэгшитгэлийн хүснэгт **байхгүй**.

### 1.3 Авлага, өглөг

| Объект | Хүснэгт | Төлөв | Гол талбар | FK | DB |
|---|---|---|---|---|---|
| **ArApDocument** (ar_invoice / ap_bill / ar_credit_note / ap_debit_note) | `ar_ap_documents` L1240 | `draft\|posted\|partially_paid\|paid\|reversed` (L1276) | `documentType` (TS `ARAP_DOCUMENT_TYPES`), `totalAmount/paidAmount` (+ base), `controlAccountNumber`, `sourceType`, `ebarimtStatus` | counterparty (restrict), voucher/reversal (set null), PO (restrict), `sourceDocumentId` → өөрөө (set null) | uq(org, documentNo), uq(org, externalRef) |
| **ArApDocumentLine** | `ar_ap_document_lines` L1347 | — | `accountNumber`, `amount`, `quantity` | document (cascade), item/wh (set null), POLine/costComponent (restrict) | **Schema дахь цорын ганц CHECK:** item XOR component (L1390) |
| **Settlement** | `ar_ap_settlements` L1403 | — | `amount`, `baseAmount`, `settlementDate` | document (restrict), cashDocument (**set null**, өнчин мөр үлдэх эрсдэл), voucher (restrict) | unique байхгүй |
| **WriteOff (+Recovery)** | `arap_write_offs` L1578 | `active\|reversed` | `amount`, `allowanceAmount`, `reason` | document (restrict), voucher (restrict) | — |
| **RecurringInvoice** | `ar_recurring_invoices` L1447 | `active\|paused\|ended` | `lines` (jsonb), `nextRunDate`, `autoPost` | counterparty (cascade) | Давхардлаас `externalRef recurring:<id>:<огноо>`-оор хамгаална |
| **Reminder**, **InvoiceSend** | L1521, L3896 | `sending\|sent\|failed` | `stage`, `token` | document (cascade) | uq(document, dueDate, stage) |
| **Counterparty** | `counterparties` L1155 | `isActive` | `counterpartyType`, `tin`, `creditLimit` | — | uq(org, name), uq(org, code) |

### 1.4 Бараа материал, өртөг, хангамж

| Объект | Хүснэгт | Төлөв | Гол талбар | FK | DB |
|---|---|---|---|---|---|
| **InventoryMovement** (мөргүй, нэг бараа) | `inventory_movements` L2211 | `draft\|confirmed\|cancelled` (L2241) | `movementType`, `quantity` (тэмдэгтэй), `sourceType` `manual\|arap_line\|gl_voucher\|cash_document\|po_receipt` | item/wh/issueType (restrict) | uq(org, documentNo) |
| **CostEntry** | `cost_entries` L3021 | `draft\|posted\|reversed` (L3086) | `entryType` (10 төрөл), `valuationSource`, `periodCode`, `businessObjectType/Id` | movement/item/wh (restrict), voucher (set null) | Partial unique: нэг хөдөлгөөнд нэг идэвхтэй бичилт (L3101), нэг true-up ноорог (L3107) |
| **CostPeriodResult** | `cost_period_results` L2959 | `calculated\|blocked-*` (5 шалтгаан, default байхгүй) | `averageUnitCost`, `blockReason` | item/wh (cascade) | uq(org, period, item, wh) |
| **CostAllocation** (landed cost) | `cost_allocations` L2887 + lines L2934 | **Төлөвгүй** (устгах = буцаалт) | `allocationBase`, `totalAmount` | component/sourceLine/PO (restrict) | uq(org, documentNo) |
| **PurchaseOrder** | `purchase_orders` L3128 (+ lines L3194) | `draft\|open\|closed\|cancelled` (TS `lib/procurement/types.ts:13`) | `totalAmount`, `closedAt`, `shortCloseReason` | counterparty/wh (restrict), closeVoucher (set null) | uq(org, documentNo), uq(org, externalRef) |
| **GoodsReceipt** | `goods_receipts` L3225 (+ lines L3274) | `draft\|confirmed\|reversed` | `exchangeRate`, `rateSource` | PO/wh (restrict), voucher (set null) | uq(org, documentNo) |
| **InventoryItem**, **Warehouse** | L2032, L2179 | `isActive` | `code`, `barcode`, `vatMode` | — | uq(org, code) |

### 1.5 Үндсэн хөрөнгө, цалин

| Объект | Хүснэгт | Төлөв | Гол талбар | FK | DB |
|---|---|---|---|---|---|
| **FixedAsset** | `fixed_assets` L3517 | `draft\|active\|disposed` (L3594) | `cost`, `usefulLifeMonths`, `openingAccumulatedDepreciation`, `disposal*` | sourceVoucher/disposalVoucher (set null) | uq(org, code) |
| **DepreciationEntry** (толгой хүснэгтгүй) | `fa_depreciation_entries` L3618 | `draft\|posted\|reversed` | `periodMonth`, `amount`, `taxAmount` (мэмо) | asset (restrict), voucher (set null) | Partial unique: нэг хөрөнгө, нэг сард нэг идэвхтэй бичилт (L3654) |
| **PayrollRun** | `payroll_runs` L2595 (+ lines L2635) | `draft\|voucher_created` | `periodMonth` | voucher (set null), advance/final АП баримт (set null) | uq(org, periodMonth) |
| **Employee** | `employees` L2426 | `isActive` | `registerNo`, `baseSalary`, `employerSiPercent` | — | uq(org, registerNo) |

### 1.6 POS, QPay, eBarimt

| Объект | Хүснэгт | Төлөв | Гол талбар | FK | DB |
|---|---|---|---|---|---|
| **PosShift** | `pos_shifts` L4180 | `open\|closed` | `openingFloat`, `countedCash`, `varianceAmount` | cash/wh (restrict) | uq(org, documentNo). «Нэг касс — нэг нээлттэй ээлж» дүрмийг зөвхөн advisory lock хамгаална |
| **PosSale** (буцаалт мөн энэ хүснэгтэд, `isReturn`) | `pos_sales` L4219 (+ lines, discounts, payments) | `posted\|partially_returned\|returned\|voided` (`voided`-ийг хэзээ ч бичдэггүй) | `total`, `vatAmount`, `ebarimtStatus`, `ebarimtCorrection`, `originalSaleId` (FK-гүй) | shift/wh/counterparty/АР (restrict) | uq(org, documentNo) |
| **QpayIntent** | `pos_qpay_intents` L4499 | `open\|paid\|finalized\|cancelled\|expired\|failed\|refunded` (TS `lib/qpay/constants.ts:12`) | `purpose` `pos\|arap`, `amount`, `paidAmount` | sale/АР/касс (set null) | uq(org, qpayInvoiceId) |
| **EbarimtSubmission** | `pos_ebarimt_submissions` L4457 | `pending\|claimed\|sent\|failed\|cancelled` | `kind` `send\|cancel`, `attempts` | sale / АР баримт (cascade). «Аль нэг нь заавал» дүрмийг зөвхөн кодод шалгадаг | Partial unique: нэг идэвхтэй илгээлт (L4482, L4485) |

### 1.7 Тусдаа хүснэгтгүй объектууд (журнал + `externalRef` угтвараар)

- **НӨАТ-ын тооцоо:** `vat-settlement:YYYY-MM[:n]`.
- **ECL нөөц:** `ecl-provision:<asOf>`.
- **Жилийн хаалт:** `year-end-YYYY-N`.
- **PO хаалт:** `po-close:`.
- **Хүлээн авалтын капиталжуулалт:** `gr-capitalize:`.
- **Цалин:** `payroll:`.
- **POS-ийн журналууд:** `pos-sale:`, `pos-return:`, `pos-pay:`, `pos-cogs:`, `pos-refund:`, `pos-gift:`, `pos-shift-variance:`.
- **QPay:** `qpay-arap:`, `qpay-refund:`.
- **Нээлтийн үлдэгдэл:** `cash-opening:`, `opening-stock:`.

Эдгээр объектын «төлөв» нь журналын төлөв юм. **Ontology-д эдгээрийг заавал нэрлэж, тус бүрд ялгах талбар (discriminator) тодорхойлох шаардлагатай.**

### 1.8 Полиморф, FK-гүй холбоос

- **type/id хосоор холбодог багана:**
  - `journal_lines.business_object_type/id`: `purchase_order`, `pos_sale`, `pos_qpay_intent`, `ecl_deferred_tax`.
  - `cost_entries.business_object_*`.
  - `document_attachments.entity_*`, `audit_events.entity_*`, `notifications.entity_*`.
- **`sourceType` + `sourceId` хос:** АР/АП, касс, бараа материалын хөдөлгөөн.
- **FK-гүй ID багана:** `pos_sales.original_sale_id`, `cost_allocation_lines.cost_entry_id`, `cost_entries.true_up_of_entry_id`.

Ontology-ийн `relations` хэсэг эдгээрийг **ил, типтэй** болгох ёстой. Одоо эдгээр холбоосыг зөвхөн кодоос уншиж мэдэх боломжтой.

---

## 2. State machine audit

Тэмдэглэгээ:
- **Claim** = транзакц доторх `UPDATE … WHERE status=<from> RETURNING`.
- **InTx** = `assertPeriodOpenInTx` (advisory lock 5).
- **Pre-read** = транзакцын гадна уншиж шалгах (race-д эмзэг).

### 2.1 Хураангуй матриц

| Объект | Толь хаана | DB | Үүсгэх | Батлах | Буцаах | Засах | Устгах |
|---|---|---|---|---|---|---|---|
| JournalVoucher | тайлбар | (гар SQL trigger, мөр) | ✅ period+InTx | ✅ claim+InTx (gl.ts:944-955) | ✅ claim (gl.ts:1210) | ⚠️ pre-read, **эцсийн UPDATE predicate-гүй** (gl.ts:1361-1377) | ✅ зөвхөн ноорог, `[USE_REVERSAL]` (gl.ts:1444) |
| ArApDocument | тайлбар + `document-kind.ts` | — | ✅ | ✅ claim (arap.ts:1679) | ✅ optimistic (arap.ts:1942); урьдчилсан шалгалтууд tx-ийн гадна | ⚠️ predicate-гүй (arap.ts:2403) | ❌ **батлагдсаныг GL-тэй нь** (arap.ts:2090-2174) |
| CashDocument | тайлбар | — | ⚠️ ноорогт период шалгахгүй | ✅ claim+InTx (cash.ts:1198); ⚠️ GL-ээс үүссэн баримтыг tx-гүй батладаг (1088) | ✅ claim+InTx | ⚠️ predicate-гүй, период шалгахгүй (cash.ts:2412) | ❌ **батлагдсаныг GL-тэй нь** (cash.ts:1552-1646) |
| InventoryMovement | тайлбар | — | ✅ | ✅ lock 1 + InTx (inventory.ts:1236) | ✅ цуцлах (1452) | ✅ predicate (1140) | ⚠️ pre-read, predicate-гүй (1317/1369) |
| PurchaseOrder | TS union | — | ✅ | ✅ claim (1201) | дахин нээх ✅ | ✅ `lockPurchaseOrder` | ✅ claim; ⚠️ цуцлах нь lock-гүй (1291) |
| GoodsReceipt | TS union | — | ✅ | ✅ lock 1, 2 + PO lock | ✅ claim; landed cost-ийг tx-ийн гадна шалгадаг | ✅ | ✅ |
| FixedAsset | тайлбар | — | ✅ | ✅ claim (fa.ts:393) | данснаас хасах / буцаах ✅ InTx | — | ⚠️ predicate-гүй (539) |
| DepreciationEntry | тайлбар | partial uq | ✅ lock 3 | ⚠️ сарын нэгтгэл lock-гүй (1575) | ❌ **сарын нэгтгэсэн журналыг хуваах алдаа** (§5 C3) | — | ⚠️ predicate-гүй (895) |
| CostEntry | тайлбар | partial uq | ✅ | ✅ claim+InTx | ⚠️ хуваалцсан журнал (§5 C3) | — | ⚠️ predicate-гүй (costing.ts:650/690) |
| PosSale | тайлбар | — | ⚠️ ээлж нээлттэй эсэхийг tx-д дахин шалгахгүй (pos.ts:1243) | = үүсгэх | ⚠️ буцаалтын үлдэгдлийг lock-ийн гадна уншдаг (2032-2056) | — | зам байхгүй |
| PosShift | TS | — | ✅ POS lock | — | хаах: ⚠️ POS lock-гүй (2773) | — | — |
| QpayIntent | **✅ `TRANSITIONS`** (`lib/qpay/intent.ts:16`) | partial uq | ✅ | ✅ `acceptsPayment` + predicate | ✅ refund predicate | ⚠️ `setIntentStatus` predicate-гүй (store.ts:287) | — |
| EbarimtSubmission | TS (`claimed` дутуу `ebarimt/types.ts:191`) | partial uq | ✅ | claim ✅ | — | ⚠️ `markSent/markFailed` predicate-гүй (queue.ts:564, 623) | — |
| PayrollRun | тайлбар | uq | ✅ | төлөвийг **хэзээ ч уншдаггүй**, `voucherId`-ээр шалгадаг | ❌ GL-ээс буцаах боломжтой, буцаасны дараа гацна (§5 H6) | — | — |
| AccountingPeriod | TS | uq | — | хаах ✅ exclusive lock (periods.ts:230) | дахин нээх ⚠️ exclusive lock-гүй (476) | — | — |
| RecurringInvoice | TS | — | ✅ | — | — | ⚠️ ажиллуулагч хуучин төлвийг буцааж бичдэг (recurring-run.ts:231) | — |

### 2.2 Ажиглалт

- **Сайн загвар.** `lib/qpay/intent.ts` (`TRANSITIONS` + `canTransition`) болон `lib/procurement` (`lockPurchaseOrder`). Ontology engine эдгээрийг ерөнхийлнө.
- **Нийтлэг алдааны хэв маяг.** `post` ба `reverse` claim ашигладаг, харин `update` ба `delete` урьдчилан уншаад, дараа нь нөхцөлгүй бичдэг. MCP клиентүүд (Claude/ChatGPT) tool-уудыг **зэрэг** дуудах боломжтой тул энэ онолын race бодит эрсдэл болно.
- **Төлөв ба холбоос давхардсан.** `payroll_runs.status` болон `voucherId`, мөн `ar_ap_documents.status` болон `paidAmount` хоёр хоёулаа хадгалагддаг. Аль нь эх сурвалж болохыг ontology-д зааж, нөгөөг нь заавал `derived` гэж тэмдэглэх хэрэгтэй.
- **Толь зөрүүтэй.**
  - `pos_sales.voided`-ийг хэзээ ч бичдэггүй.
  - `ar_ap_documents.ebarimtStatus` тайлбарт 3 утга байхад TS тогтмолд 6 утга байна.
  - `pos_store_credits.status` утгууд тодорхойгүй.
  - `qpay` `refunded` утгыг docs-д орхисон.

---

## 3. Business rule тархалт

| # | Дүрэм | Үндсэн helper | Хэрэглэгддэг газар | Дутуу | Давхардал |
|---|---|---|---|---|---|
| R1 | Дт = Кт, хоосон биш, мөр нэг талтай | `assertBalanced` gl.ts:680, `validateVoucherLines` gl.ts:641 (хоёулаа private) | `createVoucher`-ээр дамжих бүх зам (GL, цалин, НӨАТ, татвар, AI) | **Журнал бичдэг 46 газраас 43 нь дууддаггүй** (pos 10, fa 7, cash 6, arap 5, ecl 4, procurement 4, costing 2, import-statement 2, opening-stock, qpay/refund, journal-import). Дараа нь хамгаалах ганц зүйл нь deploy-гүй trigger. | Хүлцлийн хэмжээ 5 газар: integrity.ts:37 (0.011), reports/balances.ts:31 (0.01), currency.ts:142, T:3829, trigger. journal-import.ts:59 шалгалтаа сул хуулбараар дахин бичсэн. |
| R2 | Батлагдсан журналыг засахгүй, устгахгүй | `[USE_REVERSAL]` gl.ts:1444; trigger `ea_journal_lines_protect` (зөвхөн мөрд) | GL-ийн устгалт | **cash.ts:1639, arap.ts:2155** батлагдсан журналыг устгадаг. Журналын толгой хэсэгт DB хамгаалалт байхгүй. procurement.ts:1707 батлагдсан журналын `externalRef`-ийг null болгодог. | — |
| R3 | Хаагдсан үед бичихгүй | `assertPeriodOpen` / `assertPeriodOpenInTx` (`lib/periods/guard.ts:57/78`) | ~60 газар (§ agent жагсаалт) | Зөвхөн tx-ийн гадна шалгадаг: cash устгалт (1523), arap устгалт (2058), cost-allocation (395), payroll (855). **Банкны хуулга импорт** журнал батлахдаа зөвхөн `assertPeriodsOpen`-ийг дууддаг, InTx шалгалтгүй (import-statement.ts:168). `reopenPeriod` exclusive lock-гүй. | — |
| R4 | Журналын дугаар `nextVoucherNo` | `lib/gl/voucher-no.ts:132` | 11 файлд 46 газар | **12 insert дугааргүй:** pos.ts 1387, 1611, 1730, 1810, 2184, 2332, 2407, 2495, 2726, 2858; fa.ts 630, 1535 | POS/PO/GR-ийн баримтын дугаарыг `max+1` аргаар олгодог (pos.ts:166, procurement.ts:175/195) |
| R5 | Буцаалт эх талдаа, сөрөг дүнтэй | `lib/gl/storno.ts:18/33` | 13 газар | **gl.ts:1248** `unpostVoucher` дүнгээ шууд хасах тэмдэгтэй болгодог бөгөөд **`debitFc/creditFc`, валют, ханшийг хаядаг**. `duplicateVoucher` (1537) мөн адил. | Шууд хасах тэмдэг тавих нь `stornoOf`-ийн давхар хэрэгжүүлэлт |
| R6 | Хяналтын данс руу гар журнал бичих хамгаалалт | `checkControlAccountGuard` gl.ts:699 | Зөвхөн GL модуль (create 758, post 901, update 1326) | FA `capitalizeFrom` Кт 31000001 руу шууд бичдэг (fa.ts:218). Касс нэхэмжлэхгүй үед хяналтын дансыг эсрэг данс болгож болно. Бараа материалын хяналтын данс хамгаалалтын жагсаалтад ороогүй. | — |
| R7 | Нэг баримтад нэг валют, ханш зохиохгүй | `resolveVoucherCurrency` gl.ts:589 (private), `assertRate`, `getOfficialRateForDate` | GL, кассын нээлтийн үлдэгдэл | Модулиудын FX журнал MNT/1 толгойтой, `*Fc` баганагүй бичигддэг | Ханш зөв эсэхийг cash.ts:903, 2362, arap.ts:1366-д дахин шалгадаг |
| R8 | `externalRef` идемпотент | uq index ×4 (journal, cash, arap, PO) | AI tool-ууд, PO, цалин, НӨАТ, давтамжтай нэхэмжлэх, QPay | Server action-ууд зөвхөн unique index-д найддаг тул давхар дуудахад **duplicate-key алдаа** гардаг, одоо байгаа бичлэгийг буцаадаггүй. journal-import-д ref огт байхгүй. | AI давхарга дээр урьдчилан шалгадаг ч race үлдэнэ |
| R9 | AI батлах хязгаар | `assertPostLimit` T:4865 (private), `currentAiPostLimit` | 30 хатуу, 11 зөөлөн | `import_bank_statement`, `run_fx_revaluation`/`reverse_fx_revaluation`, `run_fa_depreciation` (буцаалтын журнал батладаг), `delete_fixed_asset`, `delete_inventory_movement`. PO-ийн хязгаар AI-ийн өгсөн ханшаар тооцогддог. | — |
| R10 | Модулийн эрх | `requireModuleAction` lib/auth.ts:274 | ихэнх action | `requireRole` л шалгадаг: journal-import, **bank import (журнал батладаг)**, cost-allocation. НӨАТ, татвар, цалин `gl` эрх шаарддаг. report-mappings-ийг ямар ч гишүүн засаж чадна. **Action эрх шалгаж байгааг баталгаажуулах тест байхгүй.** | — |
| R11 | Эх баримтын түгжээ (POS / PO) | — | — | GL-ийн `assertNotSubledgerOwned` POS-ийн store-credit буцаан олголтын журналыг (pos.ts:2407) хамгаалдаггүй | **5 тусдаа хэрэгжүүлэлт:** cash.ts:81, arap.ts:113, inventory.ts:62, costing.ts:600, arap-credit-note.ts:88. Мөн `"pos"` гэсэн шууд мөр (literal) 2 газар. |
| R12 | Баримтын огноо: ирээдүйн сар хориотой, УБ цаг | `lib/periods/document-date.ts`, `assertNotFuturePeriod` guard.ts:52 | 11 газар | `updateVoucher(status: "posted")`, FA, costing, procurement, FX, offset, bank import, POS | «Өнөөдөр»-ийг **10+ газар** тус тусад нь бодсон, заримд нь UTC-ээр (procurement.ts:120, T:5177/7242/10738, 3 UI) |

**Статик тестийн өмнөх жишээнүүд.** Ontology-ийн мөрдөлтийг ижил хэв маягаар хийж болно:
- `action-result.test.ts`: `KNOWN_UNGUARDED` жагсаалт зөвхөн багасаж болно.
- `module-route-guards.test.ts`.
- `gl-storno.test.ts`: regex хориг.
- `org-purge.test.ts`: DB catalog-оор шалгадаг.
- `removed-schema-objects.test.ts`.
- `fork-sync-contract.test.ts`.

---

## 4. MCP tool mapping

- **Бүртгэл:** `AI_TOOLS` T:438-3593, dispatcher T:12476-12827.
- **Fork tool:** `default` салаагаар дамжина (T:12819).
- **Surface:** MCP болон REST v1 нэг tool давхаргыг хэрэглэдэг (`lib/mcp/server.ts`, `lib/api/v1.ts`).

### 4.1 Объект × үйлдэл (155 tool бүгд)

| Объект | Унших | Үүсгэх | Батлах / хаах | Буцаах | Засах | Устгах | Бусад |
|---|---|---|---|---|---|---|---|
| JournalVoucher | `list_journal_vouchers`, `get_journal_voucher` | `create_journal_voucher`, `create_journal_vouchers_batch`, `create_year_end_closing` | `post_journal_voucher`, `post_journal_vouchers_batch` | `reverse_journal_voucher` | `update_journal_voucher` | `delete_journal_voucher` | — |
| ArApDocument | `list_arap_documents`, `get_counterparty_balance`, `get_counterparty_statement` | `create_arap_invoice`, `create_arap_invoices_batch`, `create_credit_note`, `create_ap_invoice_from_po` | `post_arap_document`, `post_arap_documents_batch` | *(байхгүй: кредит нэхэмжлэл ашиглана)* | `update_arap_document` | `delete_arap_document` ⚠️ | `pay_arap_document`, `settle_arap_offset`, `write_off_arap_document`, `recover_arap_write_off`, `send_invoice_email`, `create_invoice_link` |
| ECL / Reminder / Recurring | `get_ecl_provision`, `get_payment_reminders`, `list_recurring_invoices` | `create_recurring_invoice` | — | — | — | — | `run_ecl_provision`, `send_payment_reminder` |
| CashDocument | `list_cash_documents`, `list_cash_accounts` | `create_cash_transaction`, `create_cash_transactions_batch`, `create_cash_account`, `fix_cash_opening_balance` | `post_cash_document`, `post_cash_documents_batch` | `reverse_cash_document` | `update_cash_document` | `delete_cash_document` ⚠️ | `import_bank_statement` ⚠️ |
| CashFxRevaluation | `get_exchange_rate` | — | `run_fx_revaluation` ⚠️ | `reverse_fx_revaluation` ⚠️ | — | — | `sync_exchange_rates` |
| InventoryMovement / Item / Warehouse | `list_inventory`, `list_inventory_movements`, `get_stock_balances`, `get_inventory_valuation` | `create_inventory_movement`, `create_opening_stock`, `create_inventory_item(s_batch)`, `create_warehouse`, `record_inventory_count` | `confirm_inventory_movement` | *(цуцлах tool байхгүй)* | `update_inventory_movement`, `update_inventory_item` | `delete_inventory_movement` ⚠️, `delete_inventory_item` | — |
| CostEntry / Allocation | `list_cost_entries`, `get_costing_settings`, `get_landed_cost_summary` | `create_cost_allocation` | `post_cost_entries` | `reverse_cost_entry`, `reverse_cost_allocation` | `update_costing_accounts` ⚠️, `save_issue_type`, `save_cost_component` | `delete_cost_entry` | `run_monthly_costing` |
| PurchaseOrder / GoodsReceipt | `list_purchase_orders`, `get_purchase_order` | `create_purchase_order`, `create_goods_receipt` | `approve_purchase_order`, `confirm_goods_receipt`, `close_purchase_order` | `reverse_goods_receipt` *(PO-г дахин нээх tool байхгүй)* | `update_purchase_order` ⚠️ | `delete_goods_receipt` | `cancel_purchase_order` |
| FixedAsset / Depreciation | `list_fixed_assets` | `create_fixed_asset`, `create_fixed_assets_batch` | `activate_fixed_asset`, `post_fa_depreciation` | `reverse_fa_depreciation` ⚠️ | — | `delete_fixed_asset` ⚠️ | `run_fa_depreciation` ⚠️, `dispose_fixed_asset` |
| Period | `list_periods`, `get_month_end_checklist` | — | `close_period` | `reopen_period` | — | — | — |
| Payroll / Employee | `get_payroll_summary`, `list_employees` | `create_employee(s_batch)`, `create_payroll_voucher` | — | — | `update_employee` | — | `run_payroll` |
| VAT | `get_vat_return` | `create_vat_settlement` | — | — | — | — | — |
| POS / QPay / eBarimt | `get_pos_status`, `list_pos_sales`, `get_pos_sale`, `get_pos_sales_report`, `get_ebarimt_status`, `get_qpay_status` | `create_pos_sale` ⚠️, `open_pos_shift`, `save_pos_payment_method` | `close_pos_shift` | `return_pos_sale` | `update_pos_settings` ⚠️ | `delete_pos_payment_method` | `resend_ebarimt` ⚠️ |
| Counterparty | `list_counterparties` | `create_counterparty`, `create_counterparties_batch` | — | — | `update_counterparty` ⚠️ | `delete_counterparty` | `lookup_tin` |
| GL master | `list_gl_accounts`, `list_segment_values` | `create_gl_account`, `create_gl_accounts_batch`, `sync_standard_accounts` | — | — | — | — | — |
| Тайлан | `get_trial_balance`, `get_income_statement`, `get_balance_sheet`, `get_cash_flow`, `get_ebalance_statements`, `get_account_ledger`, `reconcile_modules` | — | — | — | — | — | — |
| Org / тохиргоо | `list_companies`, `get_active_company`, `get_company_settings`, `get_billing_overview`, `list_audit_events` | `create_company` | — | — | `update_company_settings` | `delete_company` | — |
| Мэдлэг / guide / мэдэгдэл | `list_knowledge_topics`, `read_knowledge_section`, `get_workflow_guide`, `get_onboarding_guide`, `list_notifications` | — | — | — | `mark_notifications_read` | — | — |

⚠️ = §4.2-т тэмдэглэсэн асуудалтай tool.

### 4.2 Асуудалтай tool-ууд

**Төлөв/хамгаалалт дутуу эсвэл буруу:**

| Tool | Асуудал | Байршил |
|---|---|---|
| `run_fx_revaluation`, `reverse_fx_revaluation` | ✅ **Засагдсан 2026-10-01** (`unwrapAction`, бүгд бүтэлгүйтвэл алдаа). ~~`ActionResult`-ийг шалгахгүй: бүтэлгүйтсэн тэгшитгэлийг «тэгшитгэгдэв» гэж мэдээлдэг~~. Батлах хязгааргүй хэвээр. | T:9141, T:9203 (нотлогдсон) |
| `post_/get_/update_/delete_/reverse_journal_voucher`, `post_journal_vouchers_batch` | Зөвхөн **сүүлийн 500 журнал** дотроос хайдаг, хуучин журнал «олдсонгүй» гэж гардаг (ENT-033-ийн давтамж) | T:4880-4892 (нотлогдсон), T:6144 |
| `delete_arap_document`, `delete_cash_document`, `delete_inventory_movement` | Post горимд **батлагдсан/баталгаажсан баримтыг** GL-тэй нь устгадаг | T:7218, T:5001, T:7657 |
| `reverse_fa_depreciation` | ✅ **Засагдсан 2026-10-01** (`reverseDepreciationMonth` — журналаар буцаана; дахин бодолт буцаагдсан журналыг давхар сторно хийдэг байсныг мөн засав). ~~Сарын нэгтгэсэн журналд эхний бичилт бүх журналыг буцаадаг, үлдсэн бичилтүүд `posted` хэвээр үлддэг~~ | T:6135 + fa.ts:980-988 (нотлогдсон) |
| `update_counterparty` (+ `create_counterparty`-ийн төрөл нэгтгэх хэсэг) | Server action-гүй, **`db.update`-ийг шууд** дууддаг: эрх шалгахгүй, аудит бичихгүй | T:5757 (нотлогдсон), T:5513 |
| `import_bank_statement` | 500 хүртэлх мөрийг хязгааргүй батлан GL-д бичдэг. Эрх шалгалт нь `requireRole`, InTx period шалгалтгүй. | T:10043; import-statement.ts:60, 168 |
| `run_fa_depreciation` | Горим болон хязгаар шалгахгүй мөртлөө буцаалтын журнал батладаг | T:7777, fa.ts:581-666 |
| `update_purchase_order` | Батлагдсан (open) PO-г дахин батлуулалгүй, хязгааргүй засна | a/procurement.ts:947 |
| `create_recurring_invoice{autoPost}` | Ирээдүйд автоматаар батлахыг горим, хязгааргүйгээр тохируулдаг | a/ar-recurring.ts:128 |
| `resend_ebarimt{kind:"cancel"}` | Татварын баримтыг ямар ч горимд хүчингүй болгоно | T:12335 |
| `update_costing_accounts{openPoCloseMode:"warn"}`, `update_pos_settings{allowNegativeStock}` | Хамгаалалтыг сулруулна. Харин `controlAccountGuard`-ийг сулруулах нь `[HUMAN_REQUIRED]` шаарддаг (T:9513). Дүрэм нийцгүй. | T:10012, T:11714 |
| `close_period` | Hook татгалзсан шалтгаан AI-д хүрэхгүй | T:7859 |

**`externalRef`-гүй тул дахин оролдоход давхар бичилт үүсэх tool-ууд:**
- `pay_arap_document`
- `create_pos_sale`
- `create_goods_receipt`
- `create_inventory_movement`
- `create_fixed_asset(s_batch)`
- `create_cost_allocation`
- `create_company`

**Давхардсан tool (ижил объект × үйлдэл):**
- Нэхэмжлэх төлөх гурван зам: `pay_arap_document`, `create_cash_transaction{applyTo}`, `import_bank_statement{settleInvoice}`.
- PO-оос АП нэхэмжлэх: `create_ap_invoice_from_po` ба `create_arap_invoice{purchaseOrder}`.
- Нээлтийн бараа: `create_opening_stock` ба `create_inventory_movement(receipt)`.
- Хөрөнгө идэвхжүүлэх: `activate_fixed_asset` ба post горим дахь `create_fixed_asset`.
- Байгууллагын мэдээлэл: `get_active_company`, `list_companies`, `get_company_settings`.
- `run_payroll` ⊃ `get_payroll_summary`.

**Нэршил зөрүүтэй:**
- **Батлах үйлдэлд 5 өөр үйл үг:** `post_`, `confirm_`, `approve_`, `activate_`, мөн `create_pos_sale` үүсгэхдээ шууд батладаг.
- **`run_*` утга нь зөрдөг:** `run_payroll`, `run_ecl_provision` ноорог үүсгэдэг бол `run_fx_revaluation` батлан бичдэг.
- **Нэр холилдсон:** `arap` / `ar_ap` / `credit_note`; `create_cash_transaction` ↔ `*_cash_document`; `fa_` ↔ `fixed_asset`.
- **`save_*` upsert** нь бусад газрын `create_`/`update_` хосоос ялгаатай.
- **Параметрийн нэр:**
  - YYYY-MM-ийг `period`, `month`, `code` гэж гурван янзаар нэрлэдэг.
  - ID-г `voucherId`, `documentId`, `document`, `sale`, `shift`, `assetCode` гэх мэт олон янзаар нэрлэдэг.

**Тайлбар ба бодит зан төлөв зөрдөг:**
- **Хязгаарын дүн:** 17 tool-ын тайлбарт «10 сая ₮» гэж хатуу бичсэн ч хязгаар байгууллагаар тохируулагддаг.
- **Нээлт ба хаалт:** MCP instructions (`lib/mcp/server.ts:112`) болон `ONBOARDING_LIMITS` (`lib/onboarding/guide.ts:212`) «нээлт/хаалт үргэлж хүн баталгаажуулна» гэдэг. Бодит байдал:
  - `create_opening_stock` post горимд GL батлан бичдэг.
  - `close_period` post горимд хаадаг.
- **Batch tool:** `create_gl_accounts_batch` байгаа дансыг «алгасна» гэдэг ч бодит байдалд алдаа гэж тоолдог.
- **Байхгүй tool:** tool олдоогүй үед хариу нь `Алдаа:` угтваргүй тул MCP `isError:false` гэж буцаадаг (T:12822).

---

## 5. Эрсдэлтэй цэгүүд — AI буруу дараалал дуудахад

Severity: **C** = өгөгдөл/дэвтэр эвдэрнэ, **H** = мөнгөн дүн буруу эсвэл хамгаалалтыг тойрно, **M** = зөрүү/аудит, **L** = тав тух.

| # | Sev | Сценари (AI юу хийвэл) | Үр дагавар | Байршил |
|---|---|---|---|---|
| C1 | **C → шийдвэрлэгдсэн 2026-10-01** | ✅ Product owner: нээлттэй үед батлагдсан баримтыг устгаж БОЛНО (аудитын мөр үлдэнэ) — eBarimt-д бүртгэгдсэн, QPay төлбөрийн баримтыг устгах цоорхой хаагдсан, үеийн шалгалт транзакц дотор (`docs/dev/arap.md` §5k). Анхны тодорхойлолт: AI «алдаатай нэхэмжлэхийг засъя» гээд `delete_arap_document` дуудаж, дахин `create`. Кассын баримтад мөн адил. | Батлагдсан баримт болон журнал нь **ул мөргүй устна**. Хаалттай биш өмнөх сард ч ажилладаг бөгөөд үеийн тайлан өөрчлөгдөнө. Зөвхөн аудитын бичлэг үлдэнэ. | arap.ts:2090-2174, cash.ts:1552-1646, T:7218, T:5001 |
| C2 | **C → засагдсан 2026-10-01** | ✅ DB trigger + `journal_lines_dr_xor_cr` deploy бүрд тавигдана (`scripts/apply-ledger-invariants.mjs`, §7.4); CI-ийн DB тестүүд хамгаалалттай ажиллана. Анх: модуль эсвэл fork-ийн custom код тэнцээгүй журнал бичиж болох байсан. | `scripts/lib/ledger-invariants.mjs`, `tests/ledger-invariants.test.ts` |
| C3 | **C → засагдсан 2026-10-01** | ✅ `reverse_fa_depreciation` — журнал бүхэлдээ нэг tx-д буцаж, бичилтүүд хамт `reversed` (`reverseDepreciationVouchersInTx`). `reverse_cost_entry` — зөвхөн өөрийн мөрийг сторно хийж, журнал СҮҮЛИЙН идэвхтэй бичилт буцахад л `reversed`; хуучин «reversed» журналын үлдсэн бичилт буцна, GL-ээс бүтэн буцаасан журналд татгалзана; `reverseCostAllocation` алдааг залгихгүй. Тест `tests/fa-fx-tool-regressions.test.ts`, `tests/cost-entry-reversal.test.ts` | Анх: GL журнал буцаагдсан ч дэд дэвтэр `posted`, эсвэл нэг мөрийг буцаахад бүх журнал `reversed` → дараагийн бичилт гацна. | fa.ts, costing.ts `reverseCostEntryCore`, cost-allocation.ts |
| C4 | **C** | AI `update_journal_voucher` ба `post_journal_voucher`-ийг зэрэг дуудна (MCP клиент tool-уудыг параллель дуудах боломжтой) | Батлагдсан журналыг ноорог/шинэ мөрөөр дарж бичнэ | gl.ts:1361-1377, arap.ts:2403, cash.ts:2412 |
| H1 | H | `run_fx_revaluation` → алдаа гарна → AI «амжилттай» гэж хэрэглэгчид хэлнэ → сар хаана | Ханшийн тэгшитгэлгүй хаалт хийгдэж, тайлан буруу гарна | T:9141 |
| H2 | H | Сүлжээний timeout болоход AI `pay_arap_document` / `create_pos_sale`-ийг дахин дуудна | **Давхар төлбөр/борлуулалт** | §4.2 externalRef-гүй tool-ууд |
| H3 | H | AI хуучин журналыг дугаараар нь олж чадахгүй тул «олдсонгүй» гэдгийг «байхгүй» гэж ойлгоод шинээр үүсгэнэ | Давхар бичилт | T:4880 (500-ийн хязгаар) |
| H4 | H | Хэрэглэгч «хуулгаа оруул» гэхэд AI `import_bank_statement` дуудна | Олон зуун журнал хязгааргүй, InTx lock-гүй батлагдана. Сар хаалттай зэрэгцвэл хаалттай үед бичигдэж болно. | import-statement.ts:60, 168 |
| H5 | H | AI цалингийн журналыг GL-ээс `reverse_journal_voucher`-ээр буцаана | `payroll_runs.voucherId` үлдэх тул дахин бодох, засах, шинэ журнал үүсгэх боломжгүй болж **гацна** | gl.ts:1039 (цалин хамгаалалтгүй), payroll.ts:898, 1179 |
| H6 | H | AI хязгаар руу хүрмэгц тойрох арга хайна: батлагдсан PO-г засах, `autoPost` давтамжтай нэхэмжлэх үүсгэх, `allowNegativeStock` асаах гэх мэт | Human-in-the-loop дүрмийг тойрно | §4.2 |
| H7 | H | AI `update_counterparty`-гээр ТТД, дансыг өөрчилнө | Эрх шалгахгүй, аудитын мөргүй | T:5757 |
| H8 | H | Кассчин болон AI зэрэг буцаалт хийнэ. Ээлж хаах үед борлуулалт орж ирнэ. | Бараагаа хэтрүүлж буцаана. Хаагдсан ээлжинд борлуулалт бүртгэгдэнэ. | pos.ts:2032-2056, 2573, 2700-2787 |
| M1 | M | — | 12 журнал дугааргүй: POS-ийн бүх журнал, FA-ийн хоёр журнал | §3 R4 |
| M2 | M | FX журналыг GL-ээс буцаах эсвэл хуулах | Валютын дүн болон ханш алдагдана | gl.ts:1248, 1537 |
| M3 | M | 00:00–08:00 УБ цагийн хооронд AI огноогүйгээр дуудна | UTC-ээр өмнөх өдөр, өмнөх сард бичигдэнэ | T:5177, 7242, 10738; procurement.ts:120 |
| M4 | M | Fork-ийн `beforeJournalPost` хяналт тавьсан | АР/АП, касс, POS, FA, costing, procurement-ийн журналууд hook-ийг **тойрно** | a/gl.ts:806, 984 зөвхөн |
| M5 | M | eBarimt илгээлт удаашрахад (claimed) кассчин гараар ДДТД бичнэ | Давхар баримт эсвэл төлөв дарагдана | queue.ts:564, 623; pos.ts:3054; worker.ts:273 |
| M6 | M | Хяналтын данс руу FA `capitalizeFrom` эсвэл кассын эсрэг данс бичнэ | Дэд дэвтэр ↔ GL зөрнө | fa.ts:218, cash.ts:114-150 |
| M7 | M | AI MCP instructions-д итгээд «нээлт үргэлж ноорог» гэж хэрэглэгчид хэлнэ | Буруу мэдээлэл өгнө | server.ts:112, guide.ts:212 |
| M8 | M | AI PO цуцлах ба хүлээн авалт батлахыг зэрэг дуудна | Цуцлагдсан PO-д батлагдсан хүлээн авалт үлдэнэ | procurement.ts:1291-1335 |
| L1 | L | — | Нэршил зөрүүтэй, «10 сая» хатуу бичигдсэн, `isError` буруу, `reopenPeriod` lock-гүй, давтамжтай нэхэмжлэх хуучин төлөв буцааж бичдэг | §4.2, §2.1 |

---

## 6. Ontology загварын санал

### 6.1 Зарчим

1. **Нэг эх сурвалж.** `lib/ontology/`-д объект, төлөв, шилжилт, холбоо, дүрмийг тодорхойлно. Дараах бүгд тэндээс уншина:
   - server action;
   - MCP tool-ын тайлбар;
   - `describe_ontology`;
   - `get_workflow_guide`;
   - `lib/status.ts`-ийн UI шошго.
2. **Цэвэр (DB-гүй) registry + DB-тэй engine.** Одоо байгаа client/server хилийн дүрмийг даган `lib/ontology/*.ts` нь `@/lib/db` import хийхгүй. Engine нь `lib/ontology/engine.ts`-д байрлана.
3. **Шинэ дүрэм зохиохгүй.** Эхний шатанд ontology нь **одоо байгаа** зан төлвийг баримтжуулж, мөрдүүлнэ. Дүрмийг өөрчлөх (жишээ нь батлагдсан баримтыг устгахыг хориглох) бол тусдаа product шийдвэр.
4. **Ажиглах → мөрдөх.** Эхлээд зөрчлийг блоклохгүйгээр бүртгэнэ (`audit_events action='ontology_violation'`). Модуль бүр тогтворжсоны дараа мөрдөх горимд шилжинэ.

### 6.2 `lib/ontology/types.ts`

```ts
// ЦЭВЭР — DB импортгүй (client-safe).
// Модулийн түлхүүр = lib/constants/app-modules.ts-ийн `key` (gl, cash, ar, ap, inv,
// cost, proc, pos, fa, tax, payroll …) — requireModuleAction-д дамждаг утга.
type ModuleKey = "gl" | "cash" | "ar" | "ap" | "inv" | "cost" | "proc" | "pos" | "fa" | "tax" | "payroll";

export type Layer = "core" | "extension";

/** Төлөвийн дэвтэрт үзүүлэх нөлөө — AI-д «энэ төлөвт журнал байна уу» гэдгийг хэлнэ. */
export type LedgerEffect = "none" | "posted" | "reversed";

export interface StateDef {
  label: string;              // «Батлагдсан» — lib/status.ts эндээс уншина
  ledger: LedgerEffect;
  terminal?: boolean;         // эндээс гарах шилжилт байхгүй
  editable?: boolean;         // update зөвшөөрөгдөх эсэх (ихэвчлэн зөвхөн draft)
}

/** Нэг газар бүртгэгдсэн guard-ын түлхүүр — хэрэгжүүлэлт engine-д. */
export type GuardKey =
  | "period_open"             // assertPeriodOpen + assertPeriodOpenInTx
  | "not_future_period"       // assertNotFuturePeriod
  | "journal_balanced"        // assertBalanced + validateVoucherLines
  | "control_account"         // checkControlAccountGuard
  | "not_source_locked"       // POS_SOURCED / po_receipt / subledger-owned
  | "ai_post_limit"           // assertPostLimit (зөвхөн AI surface)
  | "ai_post_mode"            // assertPostMode (зөвхөн AI surface)
  | "no_open_settlements"     // АР/АП буцаахаас өмнө
  | `custom:${string}`;       // fork-ийн guard (зөвхөн ХАТУУРУУЛНА)

export type EffectKey =
  | "journal"                 // GL журнал үүсгэнэ/буцаана
  | "voucher_no"              // nextVoucherNo заавал
  | "audit"                   // logAuditEvent
  | "hook:beforeJournalPost"; // fork hook

export interface TransitionDef<S extends string> {
  action: string;             // "post" | "reverse" | "update" | "delete" | "close" …
  from: readonly S[];
  to: S | null;               // null = мөр устгагдана (зөвхөн draft-аас)
  permission: { module: ModuleKey; level: "write" | "post" };
  guards: readonly GuardKey[];
  effects?: readonly EffectKey[];
  /** AI-д харагдах tool. Нэг шилжилт → нэг canonical tool. */
  tool?: { name: string; aliases?: readonly string[] };
  note?: string;              // AI-д зориулсан нэг өгүүлбэр
}

export interface RelationDef {
  name: string;               // "voucher", "reversal", "counterparty"
  target: string;             // объектын key
  column: string;             // drizzle баганын нэр
  kind: "fk" | "soft" | "polymorphic";
  onDelete?: "cascade" | "restrict" | "set null" | "no action"; // generated
  cardinality: "one" | "many";
}

export interface ObjectDef<S extends string = string> {
  key: string;                // "journal_voucher"
  label: string;              // «Журнал»
  layer: Layer;
  module: ModuleKey;
  table: string;              // SQL нэр — schema-тай drift тестээр тулгана
  statusColumn: string | null;
  states: Record<S, StateDef>;
  initial: readonly S[];
  transitions: readonly TransitionDef<S>[];
  relations: readonly RelationDef[];
  idempotency?: { column: "external_ref"; prefixes?: readonly string[] };
  /** Тусдаа хүснэгтгүй объект (НӨАТ-ын тооцоо г.м.) — журналын externalRef угтвараар. */
  discriminator?: { table: "journal_vouchers"; externalRefPrefix: string };
  invariants?: readonly string[]; // §7.2-ын шалгалтын ID (V01…)
}
```

### 6.3 Жишээ: 3 объект

```ts
// lib/ontology/objects/journal-voucher.ts
export const journalVoucher = defineObject({
  key: "journal_voucher",
  label: "Журнал",
  layer: "core",
  module: "gl",
  table: "journal_vouchers",
  statusColumn: "status",
  states: {
    draft:    { label: "Ноорог",     ledger: "none",     editable: true },
    posted:   { label: "Батлагдсан", ledger: "posted" },
    reversed: { label: "Буцаагдсан", ledger: "reversed", terminal: true },
  },
  initial: ["draft", "posted"],
  transitions: [
    { action: "post", from: ["draft"], to: "posted",
      permission: { module: "gl", level: "post" },
      guards: ["period_open", "not_future_period", "journal_balanced", "control_account",
               "ai_post_mode", "ai_post_limit"],
      effects: ["voucher_no", "hook:beforeJournalPost", "audit"],
      tool: { name: "post_journal_voucher" } },
    { action: "reverse", from: ["posted"], to: "reversed",
      permission: { module: "gl", level: "post" },
      guards: ["period_open", "not_source_locked", "ai_post_mode", "ai_post_limit"],
      effects: ["journal", "voucher_no", "audit"],
      tool: { name: "reverse_journal_voucher" },
      note: "Буцаалт эх огноогоор, эх талдаа сөрөг дүнтэй (stornoOf). Валют, ханш хадгалагдана." },
    { action: "update", from: ["draft"], to: "draft",
      permission: { module: "gl", level: "write" },
      guards: ["period_open", "journal_balanced"],
      tool: { name: "update_journal_voucher" } },
    { action: "delete", from: ["draft"], to: null,
      permission: { module: "gl", level: "write" },
      guards: [],
      tool: { name: "delete_journal_voucher" },
      note: "Батлагдсаныг устгахгүй — [USE_REVERSAL]." },
  ],
  relations: [
    { name: "lines", target: "journal_line", column: "voucher_id", kind: "fk", cardinality: "many" },
    { name: "reversalOf", target: "journal_voucher", column: "reversal_of_voucher_id", kind: "fk", cardinality: "one" },
  ],
  idempotency: { column: "external_ref" },
  invariants: ["V01", "V02", "V03", "V07", "V11"],
});

// lib/ontology/objects/arap-document.ts
export const arapDocument = defineObject({
  key: "arap_document",
  label: "Нэхэмжлэх / кредит нэхэмжлэл",
  layer: "core",
  module: "ar",               // төрлөөр ar|ap — arapLedger() (document-kind.ts) хэвээр
  table: "ar_ap_documents",
  statusColumn: "status",
  states: {
    draft:          { label: "Ноорог",           ledger: "none", editable: true },
    posted:         { label: "Батлагдсан",       ledger: "posted" },
    partially_paid: { label: "Хэсэгчлэн төлсөн", ledger: "posted" },
    paid:           { label: "Төлөгдсөн",        ledger: "posted" },
    reversed:       { label: "Буцаагдсан",       ledger: "reversed", terminal: true },
  },
  initial: ["draft", "posted"],
  transitions: [
    { action: "post", from: ["draft"], to: "posted", permission: { module: "ar", level: "post" },
      guards: ["period_open", "not_future_period", "ai_post_mode", "ai_post_limit"],
      effects: ["journal", "voucher_no", "hook:beforeJournalPost", "audit"],
      tool: { name: "post_arap_document" } },
    // Төлбөрийн шилжилт — DERIVED: paidAmount-аас тооцогдоно, гараар дуудагдахгүй.
    { action: "settle", from: ["posted", "partially_paid"], to: "partially_paid",
      permission: { module: "cash", level: "post" }, guards: ["period_open"],
      note: "Төлөв paidAmount-аас бодогдоно (derived). Tool: pay_arap_document." },
    { action: "reverse", from: ["posted"], to: "reversed", permission: { module: "ar", level: "post" },
      guards: ["period_open", "not_source_locked", "no_open_settlements"],
      effects: ["journal", "voucher_no", "audit"] },
    // Одоогийн зан төлөв (C1) — ontology үүнийг ИЛ болгоно; хориглох эсэх нь product шийдвэр.
    { action: "delete", from: ["draft"], to: null, permission: { module: "ar", level: "write" },
      guards: ["not_source_locked"], tool: { name: "delete_arap_document" } },
  ],
  relations: [
    { name: "counterparty", target: "counterparty", column: "counterparty_id", kind: "fk", cardinality: "one" },
    { name: "voucher", target: "journal_voucher", column: "voucher_id", kind: "fk", cardinality: "one" },
    { name: "source", target: "arap_document", column: "source_document_id", kind: "fk", cardinality: "one" },
    { name: "purchaseOrder", target: "purchase_order", column: "purchase_order_id", kind: "fk", cardinality: "one" },
    { name: "posSale", target: "pos_sale", column: "source_id", kind: "soft", cardinality: "one" },
  ],
  idempotency: { column: "external_ref", prefixes: ["recurring:", "pos-sale:"] },
  invariants: ["V05", "V08", "V09"],
});

// lib/ontology/objects/purchase-order.ts — одоо ч сайн хамгаалагдсан (lockPurchaseOrder)
export const purchaseOrder = defineObject({
  key: "purchase_order", label: "Худалдан авалтын захиалга", layer: "core", module: "proc",
  table: "purchase_orders", statusColumn: "status",
  states: {
    draft:     { label: "Ноорог", ledger: "none", editable: true },
    open:      { label: "Нээлттэй", ledger: "none", editable: true }, // одоо засагддаг (H6)
    closed:    { label: "Хаагдсан", ledger: "posted" },
    cancelled: { label: "Цуцлагдсан", ledger: "none", terminal: true },
  },
  initial: ["draft", "open"],
  transitions: [
    { action: "approve", from: ["draft"], to: "open", permission: { module: "proc", level: "post" },
      guards: ["period_open", "ai_post_mode", "ai_post_limit"], tool: { name: "approve_purchase_order" } },
    { action: "close", from: ["open"], to: "closed", permission: { module: "proc", level: "post" },
      guards: ["period_open", "ai_post_mode", "ai_post_limit"], effects: ["journal", "voucher_no", "audit"],
      tool: { name: "close_purchase_order" }, note: "poCloseBlockers — зөрүүг автоматаар нөхөхгүй." },
    { action: "reopen", from: ["closed"], to: "open", permission: { module: "proc", level: "post" },
      guards: ["period_open"], effects: ["journal", "audit"] },
    { action: "cancel", from: ["draft", "open"], to: "cancelled", permission: { module: "proc", level: "post" },
      guards: [], tool: { name: "cancel_purchase_order" } },
  ],
  relations: [ /* counterparty, warehouse, lines, closeVoucher, receipts (many), apBills (many) */ ],
  idempotency: { column: "external_ref" },
});
```

**Одоо байгаа кодыг дахин ашиглах:**
- `lib/qpay/intent.ts`-ийн `TRANSITIONS` нь ontology-ийн `qpay_intent` объект болж шилжинэ. Одоогийн `canTransition` ontology-оос уншдаг wrapper болно.
- `lib/arap/document-kind.ts` хэвээр үлдэж, ontology-ийн `arap_document`-д «төрлийн дэд ontology» болж холбогдоно.

### 6.4 Drizzle-ээс автоматаар vs гараар

| Автоматаар (build/test үед `getTableConfig`-оор) | Гараар (`objects/*.ts`) |
|---|---|
| Хүснэгт, баганын нэр, төрөл, NOT NULL, default | Бизнесийн утга, монгол шошго |
| FK ба `onDelete` → `relations[].onDelete` | Soft ба polymorphic холбоос (`sourceType`, `businessObjectType`) |
| Unique index → `idempotency`-ийн баталгаа | Төлөв, шилжилт, guard, effect |
| Status багана байгаа эсэх | Journal-backed объектын `externalRef` угтвар |
| — | AI note, canonical tool нэр, alias |

**Drift тест (`tests/ontology-schema.test.ts`):**
- Status баганатай бүх хүснэгт ontology-д бүртгэгдсэн, эсвэл `EXEMPT` жагсаалтад байна.
- `statusColumn` бүр schema-д байна.
- Ontology-ийн `relations[kind="fk"]` бүр schema-ийн FK-тэй таарна.
- TS толь (жишээ нь `QPAY_INTENT_STATUSES`, `PurchaseOrderStatus`) ontology-ийн `states`-тэй ижил байна.
- `lib/status.ts` бүх төлвийг хамарна.

**Код үүсгэх (`npm run ontology:generate`) үр дүн:**
- `lib/ontology/generated/schema-graph.ts` (FK граф).
- `docs/dev/ontology.md` (хүснэгт, mermaid state diagram).
- DDL-ийн `CHECK (status IN …)` жагсаалт (§7).

### 6.5 Шилжилтийг нэг газар мөрдүүлэх механизм

```ts
// lib/ontology/engine.ts (server-only)
export async function transition<O extends ObjectDef>(
  tx: Tx, object: O, action: string,
  target: { orgId: string; id: string },
  ctx: { userId: string; surface: "ui" | "mcp" | "rest" | "system"; mode?: AiWriteMode; amount?: number; date?: string },
): Promise<{ from: string; to: string | null }>;
```

**Дараалал:**
1. `def = object.transitions.find(a)` олдохгүй бол `[UNKNOWN_ACTION]`.
2. Эрх: `requireModuleAction(def.permission)`. Одоо тархсан эрхийн шалгалтыг энд төвлөрүүлнэ.
3. Guard-уудыг ontology-д бичсэн **дарааллаар** ажиллуулна. `ai_*` guard-ууд зөвхөн `surface ∈ {mcp, rest}` үед ажиллана. `period_open` нь tx дотор InTx lock-оор шалгана.
4. **Conditional write:**
   ```sql
   UPDATE <table> SET status = :to
   WHERE id = :id AND organization_id = :org AND status = ANY(:from)
   RETURNING status
   ```
   0 мөр буцвал `[STATE_CONFLICT] <одоогийн төлөв>`. Устгалт нь `DELETE … WHERE status = ANY(:from)` хэлбэртэй ижил.
5. Effect-ууд: журнал (`assertBalanced` заавал), `nextVoucherNo` (заавал), `beforeJournalPost` hook (**бүх модульд**), аудит.
6. Ажиглах горимд (`ONTOLOGY_ENFORCE` env-д модуль ороогүй): 1–3-р алхамд илэрсэн зөрчлийг блоклохгүй, `audit_events(action='ontology_violation')` болгон бичээд хуучин кодоороо үргэлжилнэ.

**Статик тест (`tests/ontology-transitions.test.ts`):**
- `lib/` дотор `.set({ status:` эсвэл `status: "posted"` insert нь зөвхөн `lib/ontology/engine.ts` болон `KNOWN_DIRECT_STATUS_WRITES` жагсаалтад зөвшөөрөгдөнө. Эхний жагсаалт ~80 мөр бөгөөд **зөвхөн багасна**. Энэ нь `action-result.test.ts`-ийн хэв маяг.
- `insert(journalVouchers)` нь зөвхөн `lib/gl/post-journal.ts` (шинэ, нэгдсэн posting функц) болон `KNOWN` жагсаалтад зөвшөөрөгдөнө. R1 ба R4-ийг хаах зам.
- MCP tool бүрийн `name` нь ontology-ийн `tool.name`, `aliases`-ийн аль нэгэнд эсвэл `READ_ONLY_TOOLS`-д байна.

**DB түвшин (§7 P4):** `CHECK (status IN …)`-ийг ontology-оос үүсгэнэ. Шилжилтийн trigger хэрэггүй: app түвшний conditional write хангалттай. Зөвхөн дэвтрийн invariant-ууд (`scripts/lib/ledger-invariants.mjs`) DB-д үлдэнэ.

### 6.6 `describe_ontology` MCP tool

**Оролт:**
```json
{
  "object": "arap_document",
  "include": ["states", "transitions", "relations", "invariants"],
  "forState": "posted"
}
```
- `object` бичээгүй бол бүх объектын товч жагсаалт буцаана.
- `forState` нь «одоо энэ төлөвт юу хийж болох вэ?» гэдэгт хариулна.

**Гаралт** (AI-д уншихад хялбар, монгол шошготой, ~1–2 KB):

```text
arap_document — «Нэхэмжлэх / кредит нэхэмжлэл» · модуль ar|ap · хүснэгт ar_ap_documents
Төлөв: draft(Ноорог, засагдана) → posted(Батлагдсан, дэвтэрт) → partially_paid → paid · reversed(Буцаагдсан, эцсийн)
posted төлөвөөс хийж болох үйлдэл:
  • pay      → pay_arap_document        [period_open] төлөв paidAmount-аас бодогдоно
  • reverse  → create_credit_note (хэсэгчлэн) · бүтэн буцаалт: нээлттэй төлбөргүй үед
  • delete   → ХОРИОТОЙ (зөвхөн draft)    ← §6.3-ын шийдвэрээс хамаарна
Холбоо: counterparty(1) · voucher→journal_voucher(1) · source→arap_document(1) · settlements(n) · posSale(soft)
Invariant: V05 журнал батлагдсан байх · V08 paidAmount = Σ тооцоо · V09 төлөв ↔ дүн нийцтэй
Idempotency: externalRef (давтан дуудахад одоогийнхыг буцаана)
```

`--format json`-оор мөн ижил мэдээллийг бүтэцтэй (typed) хэлбэрээр авна. REST v1-д `GET /api/v1/ontology` нэмнэ.

**Нэмэлт ашиг:**
- `get_workflow_guide`-ийн алхмуудыг ontology-ийн шилжилтээс үүсгэж болно. Ингэвэл tool, guide хоорондын зөрүү (§4.2, M7) арилна.
- Tool бүрийн description-ий төгсгөлд «Зөвшөөрөгдөх төлөв: draft» гэсэн мөрийг автоматаар нэмнэ.

### 6.7 Fork: core (түгжигдсэн) ба extension

| Давхарга | Хаана | Юу хийж болно | Юу хийж болохгүй |
|---|---|---|---|
| **core** | `lib/ontology/objects/*` (`Object.freeze`) | — (зөвхөн upstream release-ээр өөрчлөгдөнө) | Fork засахгүй (`custom/` гадна) |
| **extension** | `custom/ontology.ts` → `extendOntology({...})` | (1) **Шинэ объект** (`layer:"extension"`, өөрийн schema, жишээ нь `custom_smartgps.*`). (2) Core шилжилтэд **нэмэлт guard** (`custom:<name>`), AND логикоор зөвхөн хатууруулна. (3) Шинэ шилжилтэд `tool` холбох. (4) Шошгыг локалчлах. | Core объектод **шинэ төлөв/шилжилт нэмэх**, guard хасах, `from`-ийг өргөтгөх, `ai_*` guard-ийг унтраах |

**Мөрдөлт:**
- `lib/custom/validate.ts`-д `validateOntologyExtension`-ийг нэмнэ. Одоо байгаа `mergeCustomizations`-ийн «эхний `ok:false`-д зогсоно» зарчмыг ашиглана.
- `tests/fork-sync-contract.test.ts`-ийг өргөтгөнө.

**Extension объектын DB:**
- Одоо fork-ийн хүснэгт `public` схемд байвал `drizzle-kit push --force` устгах эсвэл нэр солих prompt гаргах эрсдэлтэй (`drizzle.config.ts` `tablesFilter`-гүй). Энэ нь **тестлэгдээгүй таамаглал**.
- Санал: `custom_<slug>` схем + `drizzle.config.ts`-д `schemaFilter: ["public"]`. Fork-ийн хүснэгтийг `custom/predeploy.mjs` үүсгэнэ.

**Hook:**
- `beforeJournalPost`-ийг engine-ийн `journal` effect-д шилжүүлснээр бүх модулийн журналд ажиллана (M4 хаагдана).
- Анхааруулга: одоо **GL-ээс бусад модулийн журналд hook ажиллаагүй байсан** тул hook-той fork-уудад зан төлөв өөрчлөгдөнө. Release notes-д заавал бичнэ.

---

## 7. Migration төлөвлөгөө (SmartGPS-ийг алдалгүй)

### 7.1 Зарчим

- **Устгах, truncate хийх DDL хийхгүй.** Зөвхөн нэмэх, `NOT VALID`, idempotent.
- `scripts/lib/removed-schema-objects.mjs` дүрэм хэвээр. Хасагдсан хүснэгтийг `archive` схем рүү зөөнө.
- **Өгөгдлийг засахдаа баримтаар засна** (буцаалт, залруулах журнал). `UPDATE`-ийг зөвхөн мета өгөгдөлд хэрэглэнэ (дугаар олгох, төлвийг derived утгатай нь тааруулах). Засвар бүр аудитын бичлэгтэй.
- **Шат бүр SmartGPS-д тусдаа release tag-аар** хүрнэ. Өмнөх шат нь ногоон болсны дараа л дараагийнх руу шилжинэ.
- ⚠️ `apply-pending-ddl.mjs` **үргэлж exit 0**-ээр дуусдаг (1310, 1315). DDL бүтэлгүйтэхэд deploy чимээгүй үргэлжилнэ. Шинэ DDL бүрийн дараа `/api/health`-д «хүлээгдэж буй DDL / invariant төлөв» гэсэн мэдээллийг ил харуулна.

**Хэмжилт эхлэхээс өмнө: production-д trigger байгаа эсэх (Т1)**

```sql
select tgname from pg_trigger where not tgisinternal and tgname like 'ea_journal%';
select conname from pg_constraint where conname = 'journal_lines_dr_xor_cr';
```

### 7.2 Одоо байгаа өгөгдлийн зөрчил илрүүлэх SQL

Бүгд **read-only** бөгөөд локал DB дээр алдаагүй ажилласныг шалгасан. Мөр бүр `chk, organization_id, id, …` хэлбэртэй. SmartGPS-ийн байгууллагаар шүүхийн тулд `and organization_id = :org` нэмнэ.

```sql
-- V01 Тэнцээгүй батлагдсан/буцаагдсан журнал
select 'V01' as chk, v.organization_id, v.id, v.document_no,
       round(sum(l.debit) - sum(l.credit), 2)::text as detail
from journal_vouchers v join journal_lines l on l.voucher_id = v.id
where v.status in ('posted','reversed')
group by v.id having abs(sum(l.debit) - sum(l.credit)) > 0.01 or sum(l.debit) = 0;

-- V02 Нэг мөрөнд Дт, Кт зэрэг
select 'V02', v.organization_id, v.id, v.document_no, l.account_number
from journal_lines l join journal_vouchers v on v.id = l.voucher_id
where l.debit <> 0 and l.credit <> 0;

-- V03 Дугааргүй батлагдсан журнал (R4 — POS, FA)
select 'V03', organization_id, id, external_ref, date
from journal_vouchers where status in ('posted','reversed') and document_no is null;

-- V04 Толь бичигт байхгүй төлөв (CHECK нэмэхээс ӨМНӨ заавал 0 байх)
select 'V04', organization_id, id, 'journal_vouchers', status from journal_vouchers where status not in ('draft','posted','reversed')
union all select 'V04', organization_id, id, 'ar_ap_documents', status from ar_ap_documents where status not in ('draft','posted','partially_paid','paid','reversed')
union all select 'V04', organization_id, id, 'cash_documents', status from cash_documents where status not in ('draft','posted','reversed')
union all select 'V04', organization_id, id, 'inventory_movements', status from inventory_movements where status not in ('draft','confirmed','cancelled')
union all select 'V04', organization_id, id, 'purchase_orders', status from purchase_orders where status not in ('draft','open','closed','cancelled')
union all select 'V04', organization_id, id, 'goods_receipts', status from goods_receipts where status not in ('draft','confirmed','reversed')
union all select 'V04', organization_id, id, 'fixed_assets', status from fixed_assets where status not in ('draft','active','disposed')
union all select 'V04', organization_id, id, 'fa_depreciation_entries', status from fa_depreciation_entries where status not in ('draft','posted','reversed')
union all select 'V04', organization_id, id, 'cost_entries', status from cost_entries where status not in ('draft','posted','reversed')
union all select 'V04', organization_id, id, 'pos_sales', status from pos_sales where status not in ('posted','partially_returned','returned','voided')
union all select 'V04', organization_id, id, 'payroll_runs', status from payroll_runs where status not in ('draft','voucher_created');

-- V05 Дэд дэвтэр батлагдсан, журнал нь байхгүй / батлагдаагүй
select 'V05', d.organization_id, d.id, d.document_no, coalesce(v.status, 'NO_VOUCHER')
from ar_ap_documents d left join journal_vouchers v on v.id = d.voucher_id
where d.status in ('posted','partially_paid','paid') and (v.id is null or v.status <> 'posted')
union all
select 'V05', c.organization_id, c.id, c.document_no, coalesce(v.status, 'NO_VOUCHER')
from cash_documents c left join journal_vouchers v on v.id = c.voucher_id
where c.status = 'posted' and (v.id is null or v.status <> 'posted');

-- V06 Дэд дэвтэр батлагдсан хэвээр, журнал нь буцаагдсан (C3, H5)
select 'V06', e.organization_id, e.id, 'fa_depreciation_entries', e.period_month
from fa_depreciation_entries e join journal_vouchers v on v.id = e.voucher_id
where e.status = 'posted' and v.status = 'reversed'
union all
select 'V06', e.organization_id, e.id, 'cost_entries', e.period_code
from cost_entries e join journal_vouchers v on v.id = e.voucher_id
where e.status = 'posted' and v.status = 'reversed'
union all
select 'V06', r.organization_id, r.id, 'payroll_runs', r.period_month
from payroll_runs r join journal_vouchers v on v.id = r.voucher_id
where v.status = 'reversed';

-- V07 Хаагдсан үед, хаалтын ДАРАА үүссэн батлагдсан журнал (H4 race)
select 'V07', v.organization_id, v.id, v.document_no, p.code || ' closed ' || p.closed_at::text
from journal_vouchers v
join accounting_periods p on p.organization_id = v.organization_id
  and p.code = substr(v.date, 1, 7) and p.status = 'closed'
where v.status in ('posted','reversed') and v.created_at > p.closed_at;

-- V08 paidAmount ≠ тооцооны нийлбэр (баримтын валютаар — таамаглал: settlements.amount эх валютаар)
select 'V08', d.organization_id, d.id, d.document_no,
       d.paid_amount::text || ' vs ' || coalesce(s.total, 0)::text
from ar_ap_documents d
left join (select document_id, sum(amount) total from ar_ap_settlements group by document_id) s
  on s.document_id = d.id
where d.status <> 'draft' and abs(d.paid_amount - coalesce(s.total, 0)) > 0.01;

-- V09 Төлөв ↔ дүн нийцгүй
select 'V09', organization_id, id, document_no, status || ' ' || paid_amount::text || '/' || total_amount::text
from ar_ap_documents
where (status = 'paid' and paid_amount < total_amount - 0.01)
   or (status = 'posted' and paid_amount > 0.01)
   or (status = 'partially_paid' and (paid_amount <= 0.01 or paid_amount >= total_amount - 0.01));

-- V10 Дансны жагсаалтад байхгүй данс руу бичсэн мөр.
-- ⚠️ journal_lines.account_number нь 10 хэсэгтэй СЕГМЕНТИЙН код (үндсэн данс =
-- 3-р хэсэг, lib/reports/balances.ts extractMainAccount); 8 оронтой
-- chart_of_accounts.number-тэй ШУУД харьцуулбал бараг бүх мөр хуурамч зөрчил
-- болно (2026-10-01 P0: засахаас өмнө ~18,800, засварын дараа 0).
select 'V10', m.organization_id, m.voucher_id, m.document_no, m.main
from (select v.organization_id, v.id as voucher_id, v.document_no,
             case when array_length(string_to_array(l.account_number, '.'), 1) = 10
                  then split_part(l.account_number, '.', 3) else l.account_number end as main
      from journal_lines l join journal_vouchers v on v.id = l.voucher_id
      where v.status in ('posted','reversed')) m
where not exists (select 1 from chart_of_accounts a
                  where a.organization_id = m.organization_id and a.number = m.main);

-- V11 Буцаагдсан журнал, буцаалтын хос нь алга
select 'V11', v.organization_id, v.id, v.document_no, v.date
from journal_vouchers v
where v.status = 'reversed'
  and not exists (select 1 from journal_vouchers r where r.reversal_of_voucher_id = v.id);

-- V12 Өнчин тооцоо (касс ч, журнал ч холбоогүй)
select 'V12', organization_id, id, document_id::text, amount::text
from ar_ap_settlements where cash_document_id is null and voucher_id is null;
```

Нэмэлт хэмжилт (зөрчил биш, хэмжээг ойлгоход):
- `select status, count(*) from <table> group by 1`
- `delete_*` tool-ийн түүх: `select count(*) from audit_events where action='delete' and entity_type in ('arap','cash')`

### 7.2a P0 хэмжилт — production (2026-10-01)

Railway-ийн түр Function-оор, `begin read only` транзакцад ажиллуулсан (өгөгдөл
хөндөөгүй, function нь дараа нь устгагдсан). F1 = элэгдлийн бичилт `posted`
боловч журнал нь `reversed`; F2 = нэг журналд олон буцаалт (нээлтийн багцын
бичилт бүрийн буцаалтыг тооцохгүй).

| Шалгалт | SaaS (43 байгууллага, 5,799 журнал) | SmartGPS (3 байгууллага, 2,288 журнал) |
|---|---|---|
| V01–V03, V05–V09, V12, F1, F2 | 0 | 0 |
| V04 толь бичигт байхгүй төлөв | 0 | 1 — `payroll_runs.status = 'calculated'` (fork-ийн «цалин v2»-оос үлдсэн) |
| V10 (засварласан асуулга) | 0 | 0 |
| V11 холбоосгүй буцаалт | 4 — нэг байгууллагын туршилтын «test0» журнал, түүний буцаалтын гинж (2026-05…07), GL цэвэр 0, зөвхөн `reversal_of_voucher_id` холбоос дутуу | 0 |
| Журналын trigger (T1) | 3/3 (гараар тавьсан) | **0/3** |
| `journal_lines_dr_xor_cr` | **алга** (push устгадаг) | **алга** |

Дүгнэлт: дэвтэрт мөнгөн зөрүү алга; DB хамгаалалт deploy-оор тавигддаггүй байсан
нь цорын ганц бүтцийн цоорхой → §7.4.

### 7.4 Журналын DB хамгаалалт deploy-оор (2026-10-01)

`db:predeploy`: `apply-pending-ddl` → custom → `drizzle-kit push` →
**`apply-ledger-invariants`** → backfill … Эх `scripts/lib/ledger-invariants.mjs`.
V01/V02-оор урьдчилан шалгаж зөрчилтэй бол тухайн хамгаалалтыг алгасна (чанга лог,
`/api/health` → `ledger.ok = false`); trigger-ийг дутуу үед л үүсгэнэ; CHECK-ийг
`NOT VALID` → `VALIDATE`; `lock_timeout` 15с — түгжээнд гацвал дараагийн deploy
дахин оролдоно. SmartGPS-д fork-ийн upstream sync-ээр хүрнэ.

### 7.3 Үе шатууд

| Шат | Юу | DB өөрчлөлт | SmartGPS-д эрсдэл | Гарц |
|---|---|---|---|---|
| **P0 Хэмжилт** | Railway-ийн read-only холболтоор §7.1 trigger шалгалт, V01–V12 ажиллуулна. Нөөцлөлт (DAILY/WEEKLY) идэвхтэй эсэхийг баталгаажуулна. | Байхгүй | Байхгүй | Зөрчлийн тоо (baseline) |
| **P1 Quick wins** | §8.2-ын засварууд | Байхгүй (код) | Бага: зөвхөн хатууруулна. `delete_*` MCP-ийн зан төлөв өөрчлөгдөнө. | release tag |
| **P2 Registry (ажиглах)** | `lib/ontology/*`, `describe_ontology`, drift тест, `lib/status.ts`-ийг ontology-оос уншдаг болгох, engine ажиглах горимд | Байхгүй. Зөрчил `audit_events`-д бичигдэнэ. | Байхгүй: блоклохгүй | 2 долоо хоногийн зөрчлийн лог |
| **P3 Мөрдөх (модулиар)** | GL → АР/АП → Касс → Бараа → FA → Costing → Procurement → POS. Модуль бүрийг `ONTOLOGY_ENFORCE=gl,ar,…` flag-аар асаана. | Байхгүй | Дунд: regression. **Модуль бүр SmartGPS-ийн өгөгдлийн хуулбар (staging) дээр тестлэгдэнэ.** | Модуль бүр тусдаа release |
| **P4 Өгөгдөл цэвэрлэх** | V01–V12 бүрийг ангиллаар засна. V03-ийг `scripts/backfill-voucher-numbers.mjs`-ээр. V06, V09-ийг баримтаар эсвэл derived утгаар. V01, V02-ийг залруулах журналаар (**нягтлан бодогч шийднэ**). | Мета UPDATE (аудиттай) | Дунд: хүний шийдвэр шаардлагатай | V01–V12 = 0 |
| **P5 DB constraint** | (a) `CHECK (status IN …) NOT VALID` ontology-оос, `apply-pending-ddl.mjs`-ээр idempotent → `VALIDATE CONSTRAINT` (V04=0 үед). (b) ✅ хийгдсэн — `scripts/apply-ledger-invariants.mjs` (push-ийн ДАРАА; push нь CHECK-ийг устгадаг), V01=V02=0 биш бол **алгасч, чанга лог**. (c) ✅ `/api/health` → `ledger`. | Нэмэх л | Бага: `NOT VALID` нь одоо байгаа мөрийг шалгахгүй | DB түвшний хамгаалалт |
| **P6 Tool нэршил** | Canonical нэр + хуучин нэрийг `aliases`-аар **2 release** хадгална. Description-ийг ontology-оос. | Байхгүй | Бага: fork-ийн prompt хуучин нэр хэрэглэж болно | Нэгдсэн гадаргуу |

**Fork-д хүргэх:**
- Шат бүр `vX.Y.0` tag-аар гарна.
- `upstream-sync.yml` нь default-аар **`main`**-ийг татдаг (tag биш, мөр 33–41, 71). SmartGPS-ийн sync-ийг **tag руу заах** нь P3–P5-ийн хяналтыг хөнгөвчилнө.
- Release бүрийн CHANGELOG-д доорх хоёрыг заавал бичнэ:
  - «зан төлөв өөрчлөгдсөн tool»;
  - «hook одоо бүх модульд ажиллана».

---

## 8. Хүчин чармайлтын тооцоо

Нэг туршлагатай хөгжүүлэгч + Claude гэж тооцов. Тест, review орсон, календарийн хугацаа биш.

### 8.1 Үе шатаар

| Шат | Хугацаа | Тайлбар |
|---|---|---|
| P0 Хэмжилт | 0.5 өдөр | SQL бэлэн (§7.2) |
| P1 Quick wins | 5–8 өдөр | §8.2 |
| P2 Registry + `describe_ontology` + drift тест + ажиглах engine | 7–10 өдөр | ~45 объект; эхлээд 12 гол объект |
| P3 Мөрдөх, 8 модуль | 15–25 өдөр | ~80 төлөв бичих газар + 46 журналын insert-ийг нэг posting функцэд |
| P4 Өгөгдөл цэвэрлэх | 2–5 өдөр | P0-ийн үр дүнгээс хамаарна, нягтлан бодогчийн цаг орно |
| P5 DB constraint | 3–4 өдөр | CHECK үүсгэгч, health, trigger |
| P6 Tool нэршил | 4–6 өдөр | Alias, description үүсгэгч, guide |
| **Нийт** | **~6–9 долоо хоног** | P1 ба P2 зэрэгцэж болно |

### 8.2 Quick wins (ontology-оос өмнө, 1–2 долоо хоног)

1. `run_fx_revaluation` / `reverse_fx_revaluation`-д `unwrapAction` нэмэх (T:9141, 9203). **~1 цаг.**
2. Update/delete замуудад `status` predicate нэмэх:
   - update: gl.ts:1361, arap.ts:2403, cash.ts:2412;
   - delete: arap.ts:2186, cash.ts:1535, inventory.ts:1369, fa.ts:539/895, costing.ts:650/690.
   
   **~1 өдөр.**
3. Журналын tool-уудын 500-ийн хязгаарыг `refCondition` (T:4809) хэв маягаар солих. **~0.5 өдөр.**
4. `pay_arap_document`, `create_pos_sale`, `create_goods_receipt`, `create_inventory_movement`, `create_fixed_asset`-д `externalRef` нэмэх. Action-ууд давхар дуудагдахад одоо байгааг буцаадаг болгох. **~1.5 өдөр.**
5. `reverse_fa_depreciation`: сарын нэгтгэсэн журналыг бүхэлд нь нэг удаа буцааж, бүх бичилтийг нэг tx-д `reversed` болгох. `reverseCostEntry`-ийн хуваалцсан журналд мөн адил. **~1 өдөр.**
6. `update_counterparty`-г server action + эрх шалгалт + аудиттай болгох. **~0.5 өдөр.**
7. MCP-ээс батлагдсан баримт устгахыг хаах. `delete_arap_document` / `delete_cash_document` батлагдсан баримт дээр `[USE_REVERSAL]` буцаадаг болгох (UI-ийн зан төлөвийг product шийдвэр гартал хэвээр үлдээнэ). Мөн `import_bank_statement`, `run_fa_depreciation`-д хязгаар, горимын шалгалт нэмэх. **~1 өдөр.**
8. Цалингийн журналыг `assertNotSubledgerOwned`-д нэмэх (H5). **~0.5 өдөр.**
9. MCP instructions, `ONBOARDING_LIMITS`, «10 сая ₮» тайлбарыг бодит зан төлөвтэй нийцүүлэх. **~0.5 өдөр.**

---

## Top 5 одоо хийх зүйл

1. **SmartGPS дээр P0 хэмжилтийг хийх.** Ledger trigger байгаа эсэх болон V01–V12-ийг read-only ажиллуулна. Зөрчлийн тоо бусад бүх шийдвэрийн суурь болно.
2. **Батлагдсан баримтыг GL-тэй нь устгах замыг AI-аас хаах** (C1). `delete_arap_document` / `delete_cash_document` батлагдсан баримт дээр `[USE_REVERSAL]` буцаадаг болгоно. UI-д хориглох эсэхийг product owner шийднэ.
3. **Update/delete замд status predicate нэмж, FA болон өртгийн хуваалцсан журналын буцаалтыг засах** (C3, C4). Жижиг засвар боловч дэвтэр ↔ дэд дэвтрийн зөрүүг таслана.
4. **AI-д шууд нөлөөлдөг 4 алдааг засах:**
   - FX тэгшитгэлийн хуурамч «амжилт»;
   - журналын 500-ийн хязгаар;
   - мөнгө хөдөлгөдөг tool-уудын `externalRef`;
   - `update_counterparty`-ийн шууд DB бичилт.
5. **`lib/ontology/` P2-ийг эхлүүлэх.** GL, АР/АП, касс, PO, QPay гэсэн 5 объектын registry, `describe_ontology`, drift тест, `KNOWN_DIRECT_STATUS_WRITES` (зөвхөн багасдаг жагсаалт) нэмнэ. Ингэснээр шинэ код ontology-г тойрохоо болино.
