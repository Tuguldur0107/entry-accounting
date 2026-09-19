# POS модуль — хэрэгжүүлэлтийн КОНТРАКТ (v1, 2026-09-19)

Дизайн: [00-proposal.md](00-proposal.md) (БАТЛАГДСАН D1–D9, C1–C3). Энэ файл
хэрэгжсэн кодын функцийн нэр, параметр, буцах утгыг бүртгэнэ — зөрөхийг
хориглоно. Батлагдсан шийдвэр: `docs/cost/README.md` change-control **0.8**.

## 0. Схем (`lib/db/schema.ts`)

- `inventoryItems`: `salePrice`, `minSalePrice`, `barcode` (org-д partial unique
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
  `/inventory/sales` (`?tab=sales|shifts|cards|settings`), Тайлан
  `/inventory/reports?tab=sales` (6 таб). `ModuleItem.configKey="pos"` —
  модуль унтраавал/эрх none бол эдгээр цэс нуугдана. Панель `pos-sale`.
- AI tools: `get_pos_status`, `open_pos_shift`, `close_pos_shift` (post),
  `create_pos_sale` (post, ≤10M), `return_pos_sale` (post), `list_pos_sales`,
  `get_pos_sale`, `get_pos_sales_report`; workflow guide `pos_sale`;
  action kind `pos_sale`.
