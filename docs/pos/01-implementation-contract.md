# POS модуль — хэрэгжүүлэлтийн КОНТРАКТ (v1, 2026-09-19)

Дизайн: [00-proposal.md](00-proposal.md) (БАТЛАГДСАН D1–D9, C1–C3). Энэ файл
хэрэгжсэн кодын функцийн нэр, параметр, буцах утгыг бүртгэнэ — зөрөхийг
хориглоно. Батлагдсан шийдвэр: `docs/cost/README.md` change-control **0.8**.

## 0. Схем (`lib/db/schema.ts`)

- `inventoryItems`: `salesPrice`, `minSalesPrice`, `barcode` (org-д partial unique
  index `inventory_items_org_barcode_ux`), `vatMode` (`standard|exempt|zero`),
  `revenueAccountNumber`, `categoryCode`.
- Шинэ: `inventoryCategories`, `itemPriceHistory`, `posSettings`,
  `posPaymentMethods`, `posDiscountRules`, `posShifts`, `posSales`,
  `posSaleLines`, `posSaleDiscounts`, `posPayments`, `posGiftCards`,
  `posStoreCredits` (+ relations, `$inferSelect` төрлүүд).
- `vatSettings.isVatPayer` (default = `company_settings.vatPayerNo` бөглөгдсөн эсэх).
- `arApDocuments.sourceType/sourceId`, `cashDocuments.sourceType/sourceId`
  (`"pos"`); `inventoryMovements.sourceType` утга `"pos_sale"`.
- `costEntries.trueUpOfEntryId`; `entryType` утга `"cogs_true_up"` (ТЭМДЭГТЭЙ
  amount); `valuationSource` утга `"provisional_avg"`. Unique index
  `cost_entries_movement_active_uq` нь `landed_cost` ба `cogs_true_up`-ыг
  хамаарахгүй; `cost_entries_true_up_draft_uq` — нэг хөдөлгөөнд нэг ноорог залруулга.
- `counterparties.customerGroup`, `counterparties.creditLimit`.

## 1. Тогтмолууд (`lib/pos/constants.ts`)

```ts
POS_MODULE_KEY = "pos"            // эрх: read (тайлан) | write (борлуулалт, буцаалт, ээлж) | post (тохиргоо, дүрэм, зөвшөөрөл, үнэ засах)
POS_SOURCE_TYPE = "pos"           // ar_ap_documents / cash_documents .sourceType
POS_MOVEMENT_SOURCE_TYPE = "pos_sale"   // inventory_movements.sourceType
POS_BUSINESS_OBJECT = "pos_sale"  // journal_lines / cost_entries businessObjectType
PROVISIONAL_VALUATION_SOURCE = "provisional_avg"
COGS_TRUE_UP_ENTRY_TYPE = "cogs_true_up"
POS_MODULE_TAG = "PS"             // S9 (segment-defaults-д нэмэгдсэн)
PAYMENT_KINDS (10), DISCOUNT_RULE_TYPES (9), DISCOUNT_SCOPES, DISCOUNT_VALUE_TYPES, VAT_MODES + шошгууд
```

Дансны дугаар кодод байхгүй — `pos_settings` рольууд (§3.1 санал):
`revenueAccountNumber`, `discountAccountNumber`, `giftCardLiabilityAccountNumber`,
`storeCreditLiabilityAccountNumber`, `customerAdvanceAccountNumber`,
`cashOverAccountNumber`, `cashShortAccountNumber`, `roundingAccountNumber`;
авлагын хяналтын данс харилцагчийн `defaultReceivableAccountNumber`; НӨАТ
`vat_settings`; бараа/COGS `costing_item_settings`; төлбөрийн хэлбэр бүрийн
`cashAccountId`.

## 2. Цэвэр логик (тесттэй)

| Файл | Функц | Тест |
|---|---|---|
| `lib/pos/discounts.ts` | `applyDiscounts(cart: CartLine[], rules: DiscountRule[], ctx: CartContext): DiscountResult`, `ruleWindowMatches`, `ruleAppliesToLine`, `allocateReceiptDiscount` | `tests/pos-discounts.test.ts` |
| `lib/pos/sale-math.ts` | `lineVat`, `computeSaleTotals(lines, {isVatPayer, vatRatePercent}): SaleTotals`, `roundToCashUnit`, `discountNetOf`, `ulaanbaatarNow` | `tests/pos-sale-math.test.ts` |
| `lib/pos/payments.ts` | `planPayments(inputs, methods, total, ctx): PaymentPlan`, `planRefund(inputs, methods, refundTotal, fxRates)` | `tests/pos-sale-math.test.ts` |
| `lib/costing/provisional-cost.ts` | `computeProvisionalAverage`, `trueUpDelta`, `signedCostAmount`, `movementCostSign`, DB: `loadProvisionalUnitCosts(handle, orgId, scopes, beforePeriod)` | `tests/provisional-cost.test.ts` |
| `lib/pos/reports.ts` | `loadSalesReport(orgId, filter)`, `aggregateBy`, `aggregatePayments`, `summarize`, `COGS_BASIS_LABELS` | `tests/pos-reports.test.ts` |

Дараалал (§3.5): fixed_price → мөрийн дүрэм (stacking) → buy_x_get_y →
customer_group → coupon → basket_threshold → гар мөр → гар баримт.
`approvalReasons` хоосон биш бол action `pos:post` эрх шаардана
(`[APPROVAL_REQUIRED]`).

## 3. Ачаалагч (`lib/pos/load-data.ts`, "use server" БИШ)

```ts
ensurePosSettings(orgId, creatorUserId?)             // ratified-seed: рольын данс, "Бэлэн худалдан авагч", COGS зарлагын төрөл, CASH/CREDIT хэлбэр
toPosSettingsView(row)
loadPaymentMethodViews(orgId, handle?) / loadDiscountRuleViews(orgId, handle?)
loadShiftViews(orgId, { openOnly?, limit? })         // + ээлжийн нэгтгэл (salesCount, salesTotal, cashReceipts, cashRefunds, returnsTotal)
loadSaleViews(orgId, filter: SaleFilter) / loadSaleDetail(orgId, saleId)
loadCheckoutData(orgId, userId): CheckoutData        // кассын дэлгэцийн бүх өгөгдөл + үлдэгдэл
loadOpenReceivable(handle, orgId, counterpartyId)
```

## 4. Server Actions (`lib/actions/pos.ts`, бүгд `ActionResult`)

| Функц | Эрх | Тайлбар |
|---|---|---|
| `getPosSettings()` / `updatePosSettings(Partial<PosSettingsView>)` | read / post | данс 8 оронтой + идэвхтэй |
| `getPaymentMethods()` / `savePaymentMethod({...})` | read / post | `PAYMENT_KINDS_WITH_CASH_ACCOUNT` → данс заавал; cash = MNT, cash_fx = валют |
| `getDiscountRules()` / `saveDiscountRule(...)` / `deleteDiscountRule(id)` | read / post | ашиглагдсан дүрэм устгахад идэвхгүй болно |
| `getPosCheckoutData()` | read | |
| `quotePosSale(SaleQuoteInput)` | read | борлуулалттай ЯГ ижил хөдөлгөгч |
| `createPosSale(CreatePosSaleInput)` → `{ id, documentNo, receipt: PosReceipt }` | write (+post зөвшөөрөлд) | НЭГ транзакц: §5 |
| `returnPosSale(ReturnPosSaleInput)` → `{ id, documentNo, refundTotal }` | write (+post өнгөрсөн ээлж) | §6 |
| `getShifts({openOnly?})` / `openShift({cashAccountId, warehouseId, openingFloat, fxRates?, note?})` / `closeShift(id, {countedCash, note?})` | read / write / write | зөрүү → кассын баримт |
| `issueGiftCard({code, amount, paymentMethodId, ...})` / `getGiftCardsAndCredits()` | write / read | Dr касс / Cr бэлгийн картын өглөг |
| `getPosSales(filter)` / `getPosSaleDetail(id)` / `getPosReceipt(id)` / `updateSaleEbarimt(id, {...})` | read / read / read / write | |

## 5. `createPosSale` — транзакцын алхмууд (өөрчлөхийг хориглоно)

```
assertPeriodOpen → shared period lock (assertPeriodOpenInTx) → advisory lock 1 (бараа) + 7 (POS дугаар)
① үлдэгдлийн replay (loadQtyLedgerFast + findNegativeStock): allowNegativeStock=false → [NEGATIVE_STOCK]; true → receipt.negativeStock мэдэгдэл
② pos_sales (POS-YYMM-NNNN) + pos_sale_lines + pos_sale_discounts (+ дүрмийн usedCount++)
③ АР нэхэмжлэх AR-<POS-№> (posted, sourceType pos): мөр бүр Cr орлого (цэвэр; барааны revenueAccountNumber override), НӨАТ мөр (isVatPayer), бөөрөнхийллийн мөр (тэмдэгтэй) — журнал: Dr авлага (төлөх дүн) / Cr …; contra горимд GL-д Cr орлого бүтэн + Dr хөнгөлөлт (АР мөр цэвэр хэвээр)
④ мөр бүр inventory_movements(issue, confirmed, issueTypeId=pos_settings.issueTypeId, sourceType pos_sale, sourceId=мөр)
⑤ урьдчилсан COGS: loadProvisionalUnitCosts → cost_entries(issue_cogs, provisional_avg, posted, businessObject pos_sale) + журнал Dr зарлагын төрлийн данс / Cr барааны данс; дундаж null → бичилт ҮГҮЙ (мөр "өртөг хүлээж байна")
⑥ төлбөр бүр: касс/банк/түр данстай хэлбэр → cash_documents(receipt, posted, arApDocumentId, sourceType pos) + журнал Dr данс / Cr авлага + ar_ap_settlements; advance/gift_card/store_credit → журнал Dr өглөгийн данс / Cr авлага + settlement(voucherId) + үлдэгдэл хасах; credit → АР нээлттэй
⑦ АР paidAmount/status; audit "create_posted" pos_sale
```

`PosReceipt` нь хэвлэх өгөдөл (толгой/хөл, мөр, төлбөр, хариулт, eBarimt, negativeStock).

## 6. `returnPosSale`

RET-YYMM-NNNN; өнөөдрийн УБ огноо; нээлттэй ээлж заавал; эх ээлжээс өөр →
`pos:post`. Мөр бүрд Σ буцаах ≤ борлуулсан − өмнө буцаасан; хэсэгчилсэн
буцаалт pro-rata, бүтэн буцаалт яг үлдэгдэл. Бичилт: АР кредит журнал (Dr
орлого / Dr НӨАТ / Cr авлага; contra горимд хөнгөлөлт урвуу), `return_in`
confirmed, урьдчилсан COGS урвуу (эх мөрийн urьдчилсан нэгж өртгөөр, Dr бараа /
Cr COGS, `provisional_avg`), буцаан олголт: касс/банк хэлбэр → `cash_documents`
(payment) + журнал; `credit` → эх нэхэмжлэхийн нээлттэй үлдэгдлийг бууруулна;
`storeCredit` → Dr авлага / Cr кредитийн өглөг + `pos_store_credits`. Эх
борлуулалт `partially_returned | returned`.

## 7. Сар хаалт, өртөг

- `computePeriodCosting` (`lib/costing/period-close.ts`): posted `provisional_avg`
  бичилт → `trueUpDelta(sign × qty × avg, [signed posted…])` → ноорог
  `cogs_true_up` upsert/устгал (`PeriodCostingSummary.trueUps`).
- `postCostEntry`: `cogs_true_up` сөрөг бол Dr/Cr сольж абсолют дүнгээр.
- `closePeriod` хориг: `open-pos-shifts`, `unvalued-movements` (кодууд
  `PeriodActionResult`, шошго periods-view / close-wizard).
- `[POS_SOURCED]`: АР (reverse/delete/update), касс (reverse/delete/update),
  бараа (delete/cancel), өртөг (delete/reverse provisional) — POS буцаалтаар л.

## 8. UI, AI

- Нав (Бараа материал): Касс (POS) `/inventory/pos`, Борлуулалт
  `/inventory/sales` · `/inventory/shifts` · `/inventory/gift-cards` ·
  `/inventory/pos-settings` (тус бүр нав цэс), Тайлан
  `/inventory/reports?tab=sales` (6 таб). `ModuleItem.configKey="pos"` —
  модуль унтраавал/эрх none бол эдгээр цэс нуугдана. Панель `pos-sale`.
- Кассын дэлгэц v2 (§4.1): `PosCheckoutView` orchestrator →
  `components/pos/checkout/{product-panel,ticket-panel,numpad,discount-dialog,parked-dialog}.tsx`;
  цэвэр төлөв `lib/pos/checkout-state.ts` — `addToCart`, `setLineQuantity`
  (≤0 → мөр хасагдана), `setLinePrice` / `setLineDiscountPercent` /
  `setLineDiscountAmount` (% ба ₮ харилцан арилгана), `pressNumpad` /
  `numpadValue` / `applyNumpad(cart, key, mode, buffer)`, `filterCheckoutItems`
  (бүлэг + хайлт, яг таарсан код эхэнд), `resolveScan` (barcode → код → эхний
  илэрц), `parseStoredCart` / `parseParkedTickets` (localStorage-ийн шалгалттай
  уншилт, устсан бараа хасагдана), `parkTicket` / `unparkTicket` (≤ 20).
  `CheckoutData` нэмэлт: `categories[]`, `lastShift` (касс/агуулах/тоолсон бэлэн).
  `OpenShiftForm` нэмэлт props: `defaultCashAccountId`, `defaultOpeningFloat`,
  `openingHint`, `autoFocus`.
- AI tools: `get_pos_status`, `open_pos_shift`, `close_pos_shift` (post),
  `create_pos_sale` (post, ≤10M), `return_pos_sale` (post), `list_pos_sales`,
  `get_pos_sale`, `get_pos_sales_report`; workflow guide `pos_sale`;
  action kind `pos_sale`.

## 9. eBarimt 3.0 (PosAPI 3.0) — Фаз 3

Дизайн `03-ebarimt-integration-plan.md`, нэвтрүүлэлт `docs/deployment/ebarimt.md`.
Функцийн нэр/параметрээс ЗӨРӨХИЙГ ХОРИГЛОНО.

**Цэвэр давхарга** (`lib/ebarimt/receipt.ts`, DB-гүй, тесттэй):

```ts
buildEbarimtReceipt(sale: EbarimtSaleInput, settings: EbarimtSettingsInput,
                    options?: { inactiveId?: string | null }): EbarimtReceiptRequest
  // inactiveId = засварлах (хэсэгчилсэн буцаалт) баримтын СҮҮЛИЙН ДДТД — албан заавар §5
allocatePayments(payments: EbarimtSalePaymentInput[], targetTotal: number): EbarimtPayment[]
taxTypeOf(line: { vatMode }, isVatPayer: boolean): EbarimtTaxType
ebarimtSettingsProblems(settings: EbarimtSettingsInput): string[]
receiptResponseOutcome(response): { ok: true; id } | { ok: false; message }
stripReceiptSecrets(raw: Record<string, unknown>): Record<string, unknown>
  // lottery, qrData-г (дэд баримтаас ч) хасна — DB-д бичигдэх хариу ҮҮГЭЭР л дамжина
class EbarimtError extends Error  // message = `[CODE] текст`

// lib/ebarimt/readiness.ts (ЦЭВЭР)
ebarimtReadiness(input: { items, categories, paymentMethods }): EbarimtReadiness
// lib/ebarimt/posapi-info.ts (ЦЭВЭР)
parsePosApiInfo(body: PosApiInfo): PosApiHealth
isMerchantRegistered(info: PosApiHealth, merchantTin: string): boolean | null
hoursSince(lastSentDate: string | null, nowUlaanbaatar: string): number | null
// lib/ebarimt/tax-product-codes.ts (ЦЭВЭР, албан лавлах)
taxProductCodesFor(vatMode): readonly TaxProductCode[]; taxProductCodeName(code): string | null
```

**Дараалал / worker** (`lib/ebarimt/queue.ts`, `worker.ts`, DB-тэй):

```ts
enqueueEbarimt(orgId, saleId, kind: "send" | "cancel", tx?): Promise<string | null>  // submission id
prepareSubmission(submission, settingsRow): Promise<PreparedSubmission | null>
  // kind=send: request; kind=cancel: БҮТЭН буцаалт → cancel (DELETE), ХЭСЭГЧИЛСЭН →
  // request{inactiveId} — хоёулаа зэрэг ХЭЗЭЭ Ч биш; ТЕГ-д бүртгэх зүйлгүй бол PosAPI дуудалгүй sent
markSent(submissionId, saleId, kind, response, { id, date, type })  // сугалаа/QR бичихгүй
sendSubmissionNow(submissionId, settingsRow, timeoutMs): Promise<EbarimtSaleResult | null>
  // борлуулалтын мөчид шууд илгээж ТҮР үр дүн (сугалаа/QR-тай) — createPosSale хэвлэхэд
processSubmission(submission, settingsRow): Promise<{ outcome, result }>
ebarimtStatusWithPosApi(orgId, settingsRow, todayUb): Promise<EbarimtStatusSummary>  // + /rest/info
loadEbarimtReadiness(orgId): Promise<EbarimtReadiness>
```

Шидэх нөхцөл (payload ҮҮСЭХГҮЙ, submission `failed`): `EBARIMT_SETTINGS`
(тохиргоо дутуу / ТТД, иргэний дугаарын формат), `EBARIMT_UNMAPPED_ITEM`
(ангилалын код 7 орон биш), `EBARIMT_TAX_PRODUCT_CODE` (VAT_FREE|VAT_ZERO-д
3 оронтой код алга), `EBARIMT_UNMAPPED_PAYMENT` (хэлбэрт `ebarimtCode` алга),
`EBARIMT_TOTAL_MISMATCH` (илгээх мөр байхгүй / Σ төлбөр ≠ баримтын дүн).

**PosAPI клиент** (`lib/ebarimt/client.ts`, DB-гүй — browser горимд ч дуудагдана):
`posApiPutReceipt(url, request)`, `posApiDeleteReceipt(url, { id, date })`,
`posApiInfo(url)`, `posApiSendData(url)`. Timeout 10с (sendData 60с), сүлжээний
алдаа → `EBARIMT_POSAPI`.

**Дараалал** (`lib/ebarimt/queue.ts`, DB давхарга, "use server" БИШ):
`enqueueEbarimt(orgId, saleId, kind, handle?)` (ХЭЗЭЭ Ч шидэхгүй — false буцаана),
`requeueEbarimt`, `prepareSubmission(submission, settingsRow)` → `PreparedSubmission | null`
(payload үүсгэж хадгална; аль хэдийн `sent` бол PosAPI дуудахгүй `sent` болгоно),
`markSent`, `markFailed(…) → attempts`, `claimDueSubmissions(limit)`,
`listPendingForBrowser`, `loadSubmissionsForSale`, `ebarimtStatusSummary`,
`settingsInputOf(row)`, `loadSaleForEbarimt(orgId, saleId, handle?)`
(үлдсэн тоо/дүн, ангилалын өвлөлт, төлбөрийн код).

**Worker** (`lib/ebarimt/worker.ts`): `processPendingEbarimt(limit?)`,
`processSubmission(submission, settingsRow)`, `applyPosApiResponse(prepared, response, stage)`
(browser горимын action мөн үүнийг дууддаг), `runEbarimtSendData()`,
`releaseStaleClaims()`. `pending → claimed` атомик шилжилт = давхар илгээлтийн
хамгаалалт; 10 мин гацвал чөлөөлөгдөнө.

**Server Actions** (`lib/actions/ebarimt.ts`, бүгд `ActionResult`):
`getEbarimtStatus`, `testEbarimtConnection` (pos:post), `resendEbarimt(saleId, kind?)`,
`getEbarimtSubmissions(saleId)`, `lookupEbarimtTin(regNo)`, `getEbarimtBranchInfo`,
`pushEbarimtData` (pos:post), `getEbarimtOutbox`, `recordEbarimtResponse`.

**Интеграцийн цэгүүд** (ӨӨРЧЛӨГДӨХГҮЙ зан төлөв):
- `createPosSale` — commit-ийн ДАРАА `enqueueEbarimt(send)` (`ebarimtEnabled` ба
  гар ДДТД өгөөгүй, `skipEbarimt` биш үед); `ebarimtStatus: manual | pending |
  skipped | null` — ЦЭВЭР `initialSaleEbarimtStatus({enabled, isVatPayer,
  manualId, skip})` (`receipt.ts`, тесттэй). `skipEbarimt: true` = кассчин
  төлбөрийн диалогийн «eBarimt баримт илгээх» switch-ийг унтраасан (борлуулалт
  бүрд, default асаалттай) → дараалалд орохгүй, аудитын хураангуйд ил, панелиас
  [eBarimt илгээх] (`resendEbarimt`) — `resendEbarimt` `skipped`-ийг `failed`/
  `pending`-тэй адил хүлээн авна; server горимд
  шууд нэг оролдлого (`void processPendingEbarimt(5)`) — борлуулалт ХҮЛЭЭХГҮЙ
- `returnPosSale` — эх борлуулалт `sent` бол `enqueueEbarimt(cancel)`; worker
  цуцлаад үлдсэн мөр байвал ижил submission дотор шинэ баримт илгээнэ
- `updateSaleEbarimt` — `sent` баримтад ХОРИОТОЙ; гар ДДТД өгвөл хүлээгдэж буй
  submission `cancelled` болно
- `/api/health` → `ebarimt` блок (зөвхөн тоолуур), `app/api/cron/ebarimt`
  (`?job=process|senddata|all`), `lib/ebarimt/ticker.ts` (20 сек, `EBARIMT_WORKER=off`)
- Мэдэгдэл: аудит `pos_sale × ebarimt_failed` → `pos.ebarimt_failed`
  (`lib/notifications/rules.ts`, POS-ийн `write` эрхтэнд, 3 дахь алдаанд нэг л удаа)
- AI tools: `get_ebarimt_status`, `resend_ebarimt`, `lookup_tin`;
  `create_pos_sale`-д `consumerNo` / `customerTin` / `customerRegNo`

## 10. QPay Quick QR (`ewallet` provider) — Фаз 3b

Дизайн `04-qpay-integration-plan.md` (D1–D8 БАТЛАГДСАН). Entry = ХСН, QPay-тэй
ШУУД харьцахгүй — `qpay-dashboard` REST v1 (`x-api-key`)-ээр. Функцийн
нэр/параметрээс ЗӨРӨХИЙГ ХОРИГЛОНО.

**Цэвэр давхарга** (`lib/qpay/intent.ts`, `readiness.ts` — DB-гүй, `crypto`-гүй,
client component ч import хийдэг; тесттэй):

```ts
canTransition(from: QpayIntentStatus, to: QpayIntentStatus): boolean
  // open → paid | cancelled | expired | failed; paid → finalized | failed; бусад ТЕРМИНАЛ
isTerminalStatus(status): boolean
clampInvoiceTtl(value: unknown): number            // 60…900 сек, default 180
isExpired(intent: { status, expiresAt }, now: Date): boolean   // зөвхөн open
checkAllowed(lastCheckAt: Date | null, now: Date, minIntervalMs = 10_000): boolean
amountMatches(intentAmount: number, paidAmount: number | null | undefined): boolean  // |Δ| < 1₮
parseWebhookPayload(body: unknown): QpayWebhookPayload | null   // event="payment.paid" ЗААВАЛ
secondsLeft(expiresAt, now): number
qpayReadiness({ apiUrl, apiKeySet, webhookSecretSet, publicUrl, paymentMethods }): { problems, warnings, ready }
  // problems → идэвхжүүлэхийг ХОРИГЛОНО; warnings (QPay хэлбэр алга, webhook URL localhost) → зөвхөн анхааруулга
// lib/qpay/webhook-signature.ts (SERVER — node:crypto)
verifyWebhookSignature(rawBody: string, signature: string | null | undefined, secret: string): boolean
  // hex HMAC-SHA256(rawBody, secret), timing-safe
```

**Dashboard клиент** (`lib/qpay/client.ts`, DB-гүй, 8 сек timeout, `QpayError(code, message, status)`):
`createDashboardInvoice(config, { amount, description, sender_invoice_no, callback_url })`,
`cancelDashboardInvoice(config, invoiceId)`, `checkDashboardPayment(config, invoiceId)`,
`listDashboardInvoices(config, { limit })` (холболт шалгах + мерчант id).

**Store** (`lib/qpay/store.ts`, DB-тэй, "use server" БИШ):

```ts
resolveQpayConfig(settings): QpayClientConfig        // API key decryptSecret — ЭНД л задардаг
resolveQpayWebhookSecret(settings): string | null
qpayWebhookUrl(intentId?): string | null             // NEXT_PUBLIC_APP_URL + /api/pos/qpay/webhook?intent=
loadQpayReadiness(orgId, settings): Promise<QpayReadiness>
loadIntent / loadIntentView(orgId, intentId)
expireStaleIntents(orgId, now): Promise<string[]>    // open & expiresAt < now → expired
markIntentPaid(orgId, intentId, { paymentId, paidAmount, paidAt }, source): Promise<{ intent, changed }>
  // ИДЕМПОТЕНТ: open → paid нэг л удаа (webhook ба гар шалгалт хоёулаа); дүн зөрвөл → failed + lastError
finalizeIntentInTx(tx, orgId, intentId, saleId): Promise<void>
  // paid & saleId IS NULL → finalized; өөр бол [QPAY_ALREADY_FINALIZED] ШИДНЭ (createPosSale транзакц дотор)
setIntentStatus(orgId, intentId, status, patch?)
listPendingIntents(orgId): QpayIntentView[]          // open | paid (борлуулалтгүй) | failed
qpayStatusSummary(orgId, settings, todayUb): QpayStatusSummary
countPaidUnfinalized(orgId, olderThanMinutes = 10): { count, oldestMinutes }
```

**Server Actions** (`lib/actions/qpay.ts`, бүгд `ActionResult`; эрх `pos`):

```ts
getQpayStatus()                                       // read — тохиргоо (нууц БАЙХГҮЙ, зөвхөн *Set) + readiness + тоолуур
saveQpaySettings({ enabled, apiUrl, apiKey?, webhookSecret?, invoiceTtlSec })  // write, admin+
  // apiKey `^qpd_(live|test)_[A-Za-z0-9_-]{16,}$`, encryptSecret; enabled=true → readiness.problems хоосон ЗААВАЛ
  // аудит `pos_settings` / `qpay_settings` — нууцын УТГА хэзээ ч бичигдэхгүй (зөвхөн «солигдсон»)
testQpayConnection()                                  // list limit 5 → merchantId хадгална
createQpayIntent({ shiftId, amount, saleInput })      // write: DB мөр ЭХЛЭЭД → dashboard нэхэмжлэх
  // sender_invoice_no = intent.id, callback_url = qpayWebhookUrl(intent.id); dashboard унавал intent failed
getQpayIntent(intentId)                               // ЗӨВХӨН Entry DB (QPay-д хүрэхгүй — 2 сек polling үүгээр)
checkQpayIntent(intentId)                             // QPay-руу ГАР шалгалт, 10 сек-д нэг ([QPAY_CHECK_THROTTLED])
cancelQpayIntent(intentId)                            // open → dashboard DELETE → cancelled
listPendingQpayIntents()                              // борлуулалтын жагсаалтын баннер
finalizeQpayIntent(intentId)                          // post: paid intent-ийн cartSnapshot → createPosSale({ ...snapshot, qpayIntentId })
```

**`createPosSale` холболт** (`lib/actions/pos.ts`): `CreatePosSaleInput.qpayIntentId?`.
Төлбөрийн мөрийн хэлбэр `provider = "qpay"` бол `resolveQpayIntentForSale`:
intent ЗААВАЛ, статус `paid`, `saleId IS NULL`, дүн таарна, QPay мөр НЭГ л
байна — эс бөгөөс `[QPAY_INTENT_REQUIRED]` / `[QPAY_INTENT_NOT_PAID]` /
`[QPAY_AMOUNT_MISMATCH]`. Мөрийн `reference` = QPay нэхэмжлэхийн id; транзакц
дотор `finalizeIntentInTx` (борлуулалт унавал intent `paid` хэвээр → D3 гар finalize).
`savePaymentMethod.provider` — зөвхөн `ewallet` kind, зөвхөн `"qpay"` (`resolvePaymentProvider`).

**Webhook** `POST /api/pos/qpay/webhook?intent=<uuid>` (`app/api/pos/qpay/webhook/route.ts`):
raw body → `verifyWebhookSignature` (`x-webhook-signature`, 401) → `parseWebhookPayload`
(422) → `invoice_id` intent-тэй таарна (409) → `markIntentPaid` → 200 `{ ok, status, changed }`.
Аудит `pos_qpay_intent` (`paid` / `webhook_rejected`). Нэвтрэлтгүй (proxy `/api` алгасна),
org нь intent-ээс — ID нь эрх олгохгүй, нууц гарын үсэг л олгоно.

**Нэг товчны холболт + автомат seed (Фаз 2):**

```ts
// lib/qpay/seed.ts (ЦЭВЭР, тесттэй) — асаахад «QPay» хэлбэр + «QPay түр данс» (GL 11000099)
planQpaySeed({ methods, cashAccounts }): { createAccount, createMethod, updateMethod, notes }
  // байгааг хөндөхгүй; QPay нэртэй идэвхтэй MNT банкны данс байвал дахин үүсгэхгүй; идемпотент
ensureQpayPaymentMethod(orgId, creatorUserId?): Promise<string[]>   // store.ts — DB давхарга, notes буцна
qpayReadiness({ …, seedOnEnable? = true })   // true: хэлбэр/данс дутуу = warning (асаахад seed); false: хатуу
// lib/qpay/connect.ts (SERVER)
buildConnectState({ orgId, userId, apiUrl }): string      // AES-GCM + base64url, 15 мин, nonce
parseConnectState(state): QpayConnectState | null        // хуучирсан / засварласан → null
connectUrl(apiUrl, { callback, state, org }): string     // {dashboard}/connect?app=entry&…
exchangeConnectCode(apiUrl, code, state): Promise<{ merchantId, merchantName, apiKey, webhookSecret }>
  // POST /api/connect/exchange; 410 → [QPAY_CONNECT_EXPIRED]
// lib/actions/qpay.ts
startQpayConnect({ apiUrl? })   // post: нийтийн URL ЗААВАЛ; → { url } (browser assign); аудит connect_started
saveQpaySettings(…)             // enabled=true → ensureQpayPaymentMethod → readiness(хатуу) → асаана; → { ok, seeded[] }
// app/api/pos/qpay/connect/callback/route.ts — GET ?state&code → exchange → encryptSecret → seed → readiness
//   → асаана (бэлэн бол) → 303 /inventory/pos-settings?section=qpay&qpay=connected|connected-off|error&reason=
```

**UI:** `components/pos/checkout/qpay-dialog.tsx` (QR `qrText` → `components/ui/qr-code.tsx`
SVG, банкны deeplink, countdown, [Шалгах] 10 сек cooldown, [Цуцлах]); төлбөрийн диалог QPay
мөр «QR үүсгэх» → «Төлөгдсөн» (дүн түгжигдэнэ); тохиргооны «QPay» дэд таб; хэлбэрийн
«Провайдер» багана; борлуулалтын жагсаалтын «QPay хүлээгдэж буй» баннер ([Борлуулалт болгох] /
[Цуцлах]). Attention `pos.qpay_paid_unfinalized` (10 мин, өдөрт нэг); `/api/health.qpay` тоолуур.

