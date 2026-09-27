# POS, eBarimt 3.0, QPay Quick QR

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (§5c). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

### 5c. POS (Борлуулалтын цэг — Бараа материалын дотор) — ХЭРЭГЖСЭН

**Баримт бичиг: `docs/pos/` — POS-ийн код хөндөхийн ӨМНӨ заавал уншина.**
`00-proposal.md` (дизайн, БАТЛАГДСАН 2026-09-19: D1–D9, C1–C3) →
`01-implementation-contract.md` (функцийн нэр/параметр — зөрөхийг хориглоно).
Батлагдсан шийдвэр `docs/cost/README.md` change-control **0.8**.

Борлуулалт = "Төлбөр авах" нэг товч = НЭГ транзакц (`createPosSale`):

```
pos_sales → АР нэхэмжлэх (posted, sourceType "pos": Dr Авлага / Cr Орлого цэвэр [+ Cr НӨАТ — НӨАТ төлөгч бол])
          → зарлага бүр confirmed (sourceType "pos_sale", зарлагын төрөл = COGS)
          → УРЬДЧИЛСАН COGS (cost_entries valuationSource "provisional_avg", posted: Dr COGS / Cr Бараа явцын дунджаар)
          → төлбөр бүрд: касс/банк/түр данс → cash_documents (posted) + settlement; урьдчилгаа/бэлгийн карт/кредит → журнал Dr өглөг / Cr Авлага; зээл → АР нээлттэй
сар хаалт: computePeriodCosting posted урьдчилсан бичилтийг ЗАЛРУУЛНА — ноорог cogs_true_up (ТЭМДЭГТЭЙ) → postCostEntries; хөдөлгөгч (periodic.ts) ӨӨРЧЛӨГДӨӨГҮЙ
```

Хатуу дүрмүүд:

- **Явцын дундаж = PWA-ийн томьёо "өнөөдрийг хүртэл"** (`lib/costing/provisional-cost.ts`):
  сүүлийн тооцоологдсон сарын C2 + түүнээс хойшхи ӨРТӨГТЭЙ орлого; зарлага
  нөлөөлөхгүй (moving average БИШ); өртөгтэй тоо ≤ 0 → бичилт ҮГҮЙ (үнэ
  зохиохгүй), сар хаалтад л үнэлэгдэнэ. Σ(урьдчилсан + залруулга) = тоо × сарын
  эцсийн дундаж — идемпотент, дахин нээх/хаахад давхардахгүй
- **`[POS_SOURCED]`:** POS-оос үүссэн АР / касс / хөдөлгөөн / урьдчилсан өртгийн
  бичилтийг эх модулиас нь засах/устгах/буцаахыг хориглоно — ЗӨВХӨН
  `returnPosSale` (АР кредит + `return_in` + урьдчилсан урвуу + буцаан олголт)
- **Хасах үлдэгдэл — тохиргоогоор** (`pos_settings.allowNegativeStock`, D9;
  ШИНЭ байгууллагад анхдагч ХААЛТТАЙ — SIM ENT-054, хуучин байгууллагын утга
  хэвээр). Асаалттай үед — баримт,
  самбар, сар хаалтын checklist-д мэдэгдэл; хөдөлгөгч тэр бараа×сарыг зогсоодог
  тул `closePeriod` `unvalued-movements` хоригоор (сарын тооцоололд "calculated"
  биш scope-той батлагдсан зарлага/буцаалт/тохируулга) засагдтал хаагдахгүй;
  мөн `open-pos-shifts` (нээлттэй ээлж)
- **НӨАТ `vat_settings.isVatPayer`-ээс** (D4): төлөгч → барааны `salesPrice` НӨАТ
  ОРСОН, мөр бүр `vatMode`-оор задарна; төлөгч биш → НӨАТ мөр огт үгүй
- **НХАТ (нийслэлийн албан татвар, T4 — 2026-09-26, product owner)**: хувь нь
  `pos_settings.cityTaxPercent` — байгууллага ӨӨРӨӨ бичнэ (кодод хуулийн тоо БАЙХГҮЙ,
  0 = НХАТ төлөгч биш, бодохгүй); зөвхөн барааны картад `cityTaxable` тэмдэгтэй бараанд;
  НӨАТ-аас хамаарахгүй. Үнэ хоёр татварыг АГУУЛНА, хоёулаа цэвэр үнээс: цэвэр =
  T/(1+v+c) (`lineTaxes`, `lib/pos/sale-math.ts` ЦЭВЭР, тесттэй — 11,200 = 10,000 + 1,000
  + 200). GL Cr `cityTaxAccountNumber` (default **31440000 «НХАТ өглөг»**, стандарт данс,
  балансын «Татварын өр» мөр), буцаалт Dr (хувь ЭХ мөрөөс); `pos_sales` /
  `pos_sale_lines.cityTaxAmount`; eBarimt `totalCityTax` (item → receipt → root);
  касс/баримт/панель/жагсаалт/тайланд НХАТ-тай үед л мөр/багана. AI
  `update_pos_settings.cityTaxPercent` (таахгүй — хэрэглэгчээс), `create/update_inventory_item.cityTaxable`.
  DB тест `tests/pos-city-tax-flow.test.ts`
- **Хөнгөлөлтийн хөдөлгөгч** (`lib/pos/discounts.ts`, 9 төрөл, тесттэй): төлөх
  дүнд шууд нөлөөлнө, НӨАТ хөнгөлөлтийн ДАРААХ дүнгээс; `approvalReasons`
  хоосон биш → `pos:post` эрх (`[APPROVAL_REQUIRED]`); GL default цэвэр орлого,
  `discountPosting=contra` бол GL-д Cr орлого бүтэн + Dr хөнгөлөлт (АР мөр цэвэр).
  **AI/MCP-ийн `create_pos_sale`** зөвшөөрөл шаардсан борлуулалтад эрхтэй token
  байсан ч ИЛ `managerApproval: true`-гүйгээр `[APPROVAL_REQUIRED]` (ENT-054)
- **Төлбөрийн хэлбэр = лавлах** (`pos_payment_methods`, 10 `kind`): карт/QPay/
  BNPL нь ТҮР ДАНСТАЙ (`cash_accounts` bank) — банкны хуулгаар тэгшитгэнэ,
  `businessObjectType "pos_sale"`-аар объект бүрээр
- **Дансны дугаар кодод байхгүй** — `pos_settings` рольууд (ratified-seed
  `ensurePosSettings`: данс, "Бэлэн худалдан авагч", COGS төрөл, CASH/CREDIT хэлбэр)
- Огноо серверийн УБ цагаар, кассчин огноо сонгохгүй; `assertPeriodOpen` +
  `assertPeriodOpenInTx`; advisory lock 1 (бараа) + 7 (дугаарлалт); эрх `pos`
  (`read`/`write`/`post`) — кассчин `pos:write` л байж болно
- Дараалсан дугаар `POS-YYMM-NNNN`, `RET-…`, `SH-YYMM-NNN`; АР нэхэмжлэх
  `AR-<POS-№>`, кассын баримт `<POS-№>-P<n>` / `-R<n>` / `<SH-№>-V`

Гол файлууд:

```
lib/pos/
├── constants.ts        POS_MODULE_KEY/POS_SOURCE_TYPE/POS_MOVEMENT_SOURCE_TYPE/
│                       POS_BUSINESS_OBJECT/PROVISIONAL_VALUATION_SOURCE/COGS_TRUE_UP_ENTRY_TYPE,
│                       kind/дүрэм/НӨАТ шошго — литералын ЦОРЫН ГАНЦ эх сурвалж
├── types.ts            plain төрлүүд (CartLine, DiscountRule, PaymentMethodView, PosSaleView…)
├── discounts.ts        applyDiscounts — ЦЭВЭР (тесттэй): 9 дүрэм, stacking, pro-rata, approvalReasons
├── sale-math.ts        computeSaleTotals (inclusive НӨАТ), roundToCashUnit, discountNetOf, ulaanbaatarNow
├── payments.ts         planPayments / planRefund — ЦЭВЭР (тесттэй): хариулт, лимит, ханш, үлдэгдэл
├── load-data.ts        ensurePosSettings (ratified-seed), view ачаалагч, loadCheckoutData (бүлгүүд, lastShift)
├── checkout-state.ts   Кассын дэлгэцийн ЦЭВЭР төлөв (тесттэй): addToCart, тоо/хөнгөлөлтийн оролт,
│                       filterCheckoutItems/resolveScan, парк (localStorage бүтэц, шалгалттай parse)
└── reports.ts          loadSalesReport + ЦЭВЭР нэгтгэл (aggregateBy/summarize/aggregatePayments, тесттэй)
lib/costing/provisional-cost.ts  явцын дундаж + trueUpDelta (ЦЭВЭР, тесттэй) + loadProvisionalUnitCosts
lib/costing/period-close.ts      cogs_true_up залруулга (posted урьдчилсан бичилтэд)
lib/actions/pos.ts               createPosSale (атомик) / returnPosSale / ээлж / бэлгийн карт /
                                 тохиргоо / төлбөрийн хэлбэр / хөнгөлөлтийн дүрэм / quotePosSale
app/(dashboard)/inventory/pos    Кассын дэлгэц v2 — дэлгүүрийн POS (tile + ticket; сканнер = гар,
                                 F9 төлбөр, нэг товчны ээлж, баримт хэвлэх) — docs/pos §4.1
app/(dashboard)/inventory/sales  Борлуулалт (жагсаалт) — Ээлж `/inventory/shifts`,
                                 Бэлгийн карт·кредит `/inventory/gift-cards`,
                                 POS тохиргоо `/inventory/pos-settings` нь ТУСДАА нав цэс
                                 (хуудас бүр зөвхөн ӨӨРИЙН өгөгдлөө ачаална; хуучин
                                 `/inventory/sales?tab=` линк redirect хийнэ)
app/(dashboard)/inventory/reports?tab=sales  Борлуулалтын тайлан (8 зүсэлт, COGS cost_period_results-ээс;
                                 топбарын сонгогч «Борлуулалтын тайлан (POS)»)
components/pos/                  pos-checkout-view (orchestrator) + checkout/{product-panel, ticket-panel,
                                 discount-dialog, parked-dialog}, payment-dialog, receipt-preview
                                 (80мм хэвлэлт, usePosPrint); хуудас бүрийн харагдац ТУСДАА —
                                 sales-page-view → sales-list-view / shifts-view + shift-dialogs
                                 (нээх, хаах, Z-тайлан) / gift-cards-view / pos-settings-view
                                 (+ discount-rule-dialog, хөнгөлөлтийн симуляци),
                                 sales-report-view (/inventory/reports?tab=sales, 8 зүсэлт)
components/panel/pos-sale-panel  Борлуулалтын панель (буцаалт: мөр/дүн, буцаан олголт эсвэл
                                 дэлгүүрийн кредит; дахин хэвлэх; eBarimt; АР/журнал/хавсралт)
tests/pos-*.test.ts, tests/provisional-cost.test.ts
```

**eBarimt 3.0 (PosAPI 3.0) — ХЭРЭГЖСЭН (v2, албан баримттай тулгасан).** Баримт:
`docs/pos/03-ebarimt-integration-plan.md` (дизайн v2, §8 хаагдсан),
`docs/deployment/ebarimt.md` (ОПЕРАТОРЫН загвар — нэг PosAPI, олон мерчант).

```
борлуулалт батлагдав ──commit──▶ pos_ebarimt_submissions (pending)
   server горим: ШУУД илгээж ≤8 сек хүлээнэ (sendSubmissionNow) → баримт ДДТД+сугалаа+QR-тай
   хэтэрвэл worker (20 сек) ард үргэлжилнэ; browser горим: кассын дэлгэц илгээнэ
        └─▶ POST {операторын posApiUrl}/rest/receipt ──▶ ДДТД → pos_sales (сугалаа/QR ХАДГАЛАХГҮЙ)
буцаалт ──▶ БҮТЭН: DELETE /rest/receipt · ХЭСЭГЧИЛСЭН: POST + inactiveId=сүүлийн ДДТД (гинж)
өдөр бүр 23:30 УБ ──▶ GET /rest/sendData; scheduler: /rest/info → сугалаа/хоцролт/хүрэлцээ
```

- **Борлуулалт ХЭЗЭЭ Ч илгээлтээс болж зогсохгүй** — enqueue нь commit-ийн
  ДАРАА, async; амжилтгүй бол backoff (15с→1мин→5мин→30мин→2ц, max 20),
  3 дараалсан алдаанд `ebarimt_failed` аудит → `pos.ebarimt_failed` мэдэгдэл
- **Код ЗОХИОХГҮЙ** (ханшийн дүрэмтэй ижил зарчим): барааны ангилалын код
  (7 орон, `inventoryItems.ebarimtClassificationCode`, хоосон бол
  `inventoryCategories`-аас өвлөнө), НӨАТ-гүй/0%-ийн татварын бүтээгдэхүүний
  код (3 орон), төлбөрийн хэлбэрийн `ebarimtCode` — аль нэг дутвал
  `[EBARIMT_UNMAPPED_ITEM]` / `[EBARIMT_TAX_PRODUCT_CODE]` /
  `[EBARIMT_UNMAPPED_PAYMENT]` гэж ШИДЭЖ, submission `failed` болж шалтгаан
  UI-д ил гарна
- **Сугалаа (lottery) ба QR (qrData) ХЭЗЭЭ Ч ХАДГАЛАГДАХГҮЙ** — албан заавар §5
  хориглодог. Зөвхөн илгээлтийн хариуны мөчид (`EbarimtSaleResult`, action
  result / browser fetch) баримт дээр НЭГ удаа хэвлэгдэнэ; дахин хэвлэхэд ДДТД.
  `pos_ebarimt_submissions.response` `stripReceiptSecrets`-ээр; хуучин мөрийг
  preDeploy цэвэрлэнэ; `pos_sales.ebarimt_lottery/qr_data` REMOVED_COLUMNS-д
- **Хэсэгчилсэн буцаалт = `inactiveId` гинж** (§5 «Баримтын засвар»): сүүлийн
  ДДТД-г өгч ШИНЭ бичилт, сугалаа дахин олгогдохгүй, `pos_sales.ebarimtId`
  шинэ ДДТД болно. DELETE зөвхөн БҮТЭН буцаалт. `prepareSubmission` шийднэ —
  `request` ба `cancel` зэрэг ХЭЗЭЭ Ч байхгүй
- **PosAPI-ийн байдал** (`/rest/info`, `posapi-info.ts` ЦЭВЭР): үлдсэн сугалаа
  < 200, ТЕГ рүү ≥48ц илгээгдээгүй (72ц хуулийн хязгаар), хүрэхгүй → `attention.ts`
  (`pos.ebarimt_lottery_low` / `send_stale` / `posapi_down`, өдөрт нэг); статуст
  «Мерчант бүртгэл» = операторын хүсэлтийг харилцагч батласан эсэх
- **Идемпотент:** `pos_ebarimt_submissions` дээр (saleId, kind) partial unique
  (`pending`/`claimed`); аль хэдийн `sent` борлуулалт PosAPI-г дахин дуудахгүй;
  worker `pending → claimed` атомик шилжилтээр нэг мөрийг хоёр instance зэрэг
  илгээхээс сэргийлнэ (10 мин гацвал чөлөөлөгдөнө)
- **Wire-формат албан спекээр** (2026-09-25, #128): `totalVAT` түлхүүр, `billIdSuffix`
  (`billIdSuffixOf` — дахин илгээлтэд ИЖИЛ, засвар бүрд ӨӨР), `/rest/receipt` timeout
  `POSAPI_RECEIPT_TIMEOUT_MS` 90 сек (`EBARIMT_POSAPI_TIMEOUT` — давхар ДДТД-ийн эрсдэл ил) —
  `docs/integrations/01-ebarimt-posapi-verification.md` §2
- **Төлбөрийн код ба лавлах (P1, 2026-09-25):** `payments[].code`-ийн АЛБАН жагсаалт
  `EBARIMT_PAYMENT_CODES` (CASH · PAYMENT_CARD · BANK_TRANSFER · BANK_TRANSFER_QPAY) —
  readiness жагсаалтад байхгүй кодыг `warnings`-аар АНХААРУУЛНА (блоклохгүй, ТЕГ код нэмж
  болно); `credit`-д санал байхгүй (`INVOICE` албан биш). ТЕГ-ийн нийтийн лавлах
  `api.ebarimt.mn` ЗӨВХӨН Монголын IP — env `EBARIMT_PUBLIC_API_BASE` (`publicApiBase()`);
  иргэний РД-аар `getTinInfo` ХОРИОТОЙ (ХХМХ 4.1.11, ТЕГ 2026-05-11), регистрээр лавлах
  2026-06-15-аас хязгаарлагдана → кассын B2B-д **ТТД шууд** үндсэн зам (нэр `getInfo`-оос,
  `lookupTaxpayerByTin`; лавлах унасан ч төлбөр хаагдахгүй). ТТД 11–14 орон (хувь хүн 12–14),
  татварын бүтээгдэхүүний код 3–5 орон (`getProductTaxCode` 5 оронтой ч буцаадаг); `getInfo`-ийн
  `cityPayer`/`freeProject` → мерчантын статус + кассын анхааруулга (НХАТ, VAT_FREE/304 автомат
  БИШ); PosAPI хувилбар сүүлийн хариуны `version`-оос, <3.0.12 улаан (`isPosApiVersionOutdated`)
- **Мерчантын ТТД регистрээс** (2026-09-25): хэрэглэгч 11 оронтой ТТД-гээ
  мэддэггүй тул тохиргооны талбар 7 оронтой байгууллагын РЕГИСТР хүлээж авна —
  «ТЕГ-ээс татах» (хоосон бол `company_settings.registerNo`) эсвэл хадгалахад
  `updatePosSettings` `lookupTinByRegNo`-оор ТТД болгоно; унавал ШИДНЭ (ТТД
  ЗОХИОХГҮЙ). Салбар / кассын дугаар хоосон бол форм «001»-ийг ИЛ санал болгоно
- **ТЕГ-ийн лавлах БРАУЗЕРААС ЭХЛЭЭД** (2026-09-26, `lib/ebarimt/browser-lookup.ts`,
  тесттэй): кассын ААН (регистр → нэр + ТТД), мерчантын «ТЕГ-ээс татах», харилцагчийн
  картын лавлах — хэрэглэгчийн браузер Монголд тул `api.ebarimt.mn`-ийг ШУУД дуудна;
  сүлжээ/CORS/timeout бол серверийн action (прокси) руу буцна, ТЕГ «олдсонгүй»
  гэж хариулсан бол серверээр дахин асуухгүй. ТТД ЗОХИОХГҮЙ хэвээр (`lookup.ts`).
  PosAPI-ийн `/rest/info` регистр буцаадаггүй тул мерчантын ТТД ↔ регистрийн
  эх нь операторын консол (operator.ebarimt.mn → Мерчантын жагсаалт)
- **Дүүргийн код = АЛБАН ЛАВЛАХААС СОНГОНО** (2026-09-26, `lib/ebarimt/district-codes.ts`
  ЦЭВЭР, client-safe, тесттэй): код = аймаг/дүүрэг (2) + сум/хороо (2) — Баянзүрх 3-р хороо
  **2403**, Чингэлтэй 5-р хороо 3505 (гараар андуурагдсан жишээ). Өгөгдөл
  `district-codes.json` (506) — мерчантын багцын `DISTRICT CODE.txt` (ТЕГ `getBranchInfo`
  хариу) → `node scripts/build-ebarimt-districts.mjs <файл>`. Серверээс `getBranchInfo`
  ДУУДАХГҮЙ (гео-хязгаар; хуучин parser хороо алгасаж 2 оронтой код гаргадаг байсан —
  хасагдсан). Жагсаалтад байхгүй 4 оронтой кодыг гараар оруулна — «шалгаагүй» гэж ил,
  ЗОХИОХГҮЙ; `get_ebarimt_status` кодын нэрийг хэлнэ
- **Операторын PosAPI нийтэд ХААЛТТАЙ** (2026-09-25, `docs/deployment/ebarimt.md`
  §4a): Cloudflare WAF нууц header шаардана; Entry сервер PosAPI + лавлахын прокси
  (`EBARIMT_PUBLIC_API_BASE`) руу `EBARIMT_GATEWAY_KEY`-г нэмнэ — ЗӨВХӨН
  `EBARIMT_GATEWAY_HOSTS`-ийн хост руу (харилцагчийн дурын `ebarimtPosApiUrl` руу
  нууц АЛДАГДАХГҮЙ, албан `api.ebarimt.mn` руу хэзээ ч). ЦЭВЭР
  `lib/ebarimt/gateway-auth.ts` (тесттэй); `/api/health.ebarimt.gatewayAuth` зөвхөн boolean
- **Гар ДДТД (`manual`)** автомат илгээлтэд ОРОХГҮЙ; `sent` баримтын ДДТД-г
  гараар засах ХОРИОТОЙ (давхар баримт)
- **Борлуулалт бүрд eBarimt-гүй (`skipped`)**: төлбөрийн диалогийн «eBarimt
  баримт илгээх» switch (default асаалттай) → `skipEbarimt` → статус `skipped`,
  дараалалд орохгүй, аудитын хураангуйд ил; панелиас [eBarimt илгээх]
  (`resendEbarimt`) дараа нь илгээнэ. Анхны статусын дүрэм ЦЭВЭР
  `initialSaleEbarimtStatus` (receipt.ts, тесттэй) — гар ДДТД > унтраалттай
  (null) > skipped > pending; action дотор давтахгүй
- **НӨАТ төлөгч БУС байгууллага ч eBarimt олгоно** (хууль, 2026-09-26 product owner):
  бүх мөр `NOT_VAT`, `totalVAT` 0, татварын бүтээгдэхүүний код шаардахгүй
  (readiness `isVatPayer:false`). НӨАТ төлөгч эсэхээр eBarimt-ийг ХААХГҮЙ
  (асаах, илгээх, worker, sendData, буцаалт, outbox) — зөвхөн `taxTypeOf`
  нөлөөлнө. Кассад checkbox-гүй «eBarimt» мөр (Хувь хүн | ААН), «☐ НӨАТ» горимгүй
- **Кассын «НӨАТ» мөр** (`components/pos/checkout/vat-receipt-bar.tsx`, НӨАТ төлөгчид;
  төлөгч бус бол eBarimt асаалттай үед худалдан авагчийн хэсэг л): ☑ НӨАТ (анхдагч, борлуулалт бүрийн дараа буцна) → «Хувь хүн» (eBarimt
  дугаар, сонголтоор) | «ААН» (7 оронтой РЕГИСТР бичмэгц ТЕГ-ээс НЭР + ТТД —
  `getTinInfo` нь ЗӨВХӨН ТТД-г тоогоор буцаадаг, нэр `getInfo?tin=`-ээс;
  олдоогүй бол ТӨЛБӨР хаагдана). Худалдан авагчийн ЦЭВЭР дүрэм
  `lib/pos/ebarimt-buyer.ts` (тесттэй); төлбөрийн диалогт зөвхөн хураангуй
- **НӨАТ-гүй борлуулалт** (☐ НӨАТ — нөхөж оруулах, залруулга; `lib/pos/non-vat.ts`
  ЦЭВЭР, тесттэй): НӨАТ задлахгүй, eBarimt ОГТ үүсэхгүй (`resendEbarimt` /
  гар ДДТД татгалзана), GL-д `pos_settings.nonVatRevenue/ReceivableAccountNumber`
  (default `51100002` / `13110002` — бусад рольтой ижил, дансны модонд байхгүй
  бол `ensurePosSettings` стандарт нэрээр нээнэ; хуучин null-ийг preDeploy нөхнө), шалтгаан ЗААВАЛ
  (`pos_sales.nonVatReason`), эрх `pos:post` (approvalReasons), аудитад ил;
  жагсаалтын «НӨАТ баримт» багана + «НӨАТ-гүй» шүүлт, панель. Буцаалт эх АР
  мөрийн орлогын данс руу. AI `create_pos_sale` `nonVat` + `nonVatReason`
- **Зээлээр (`credit`) = НЭХЭМЖЛЭХ:** зээлийн хэсэгтэй борлуулалт `B2C/B2B_INVOICE`
  төрлөөр, тэр хэсэг `payments[].status = PAY` (бусад PAID), сугалаагүй —
  `receiptTypeOf` (receipt.ts, тесттэй); `EBARIMT_INVOICE_PAYMENT_KINDS` нь ЦОРЫН ГАНЦ эх
- **taxType бүлэглэл:** НӨАТ төлөгч бус → бүх мөр `NOT_VAT`; төлөгч бол
  барааны `vatMode` → `VAT_ABLE|VAT_FREE|VAT_ZERO`, мөрүүд дэд баримт
  (`receipts[]`) болж бүлэглэгдэнэ. Хэсэгчилсэн буцаалтын дараа үлдсэн мөрөөр
  л илгээгдэж, төлбөрүүд хувь тэнцүүлэн хуваарилагдана (Σ = баримтын дүн)
- **Мерчантын тохиргоо харилцагчийн апп-д** (`pos_settings.ebarimt*`), Console-д
  БИШ; `/api/health`-ийн `ebarimt` блокт зөвхөн ТООЛУУР (ТТД, нууц байхгүй)
- **АСААХААС ӨМНӨ бэлэн байдал шалгагдана** (`readiness.ts` ЦЭВЭР, тесттэй):
  ангилалын кодгүй идэвхтэй бараа (бүлгээс өвлөх нь тооцогдоно), татварын
  бүтээгдэхүүний кодгүй НӨАТ-гүй/0% бараа, eBarimt кодгүй идэвхтэй төлбөрийн
  хэлбэр — тоо + эхний нэрсээр. Үлдсэн бол switch идэвхгүй бөгөөд
  `updatePosSettings` ШИДНЭ. Эдгээр алдаа урьд нь зөвхөн борлуулалтын ДАРАА
  async гарч ирдэг байв

```
lib/ebarimt/
├── constants.ts   PosAPI-ийн литерал (төрөл, taxType, статус, алдааны код,
│                  backoff) + EBARIMT_PAYMENT_CODE_SUGGESTIONS — CLIENT-SAFE
├── types.ts       PosAPI JSON + Entry-ийн ЦЭВЭР оролт (EbarimtSaleInput)
├── receipt.ts     buildEbarimtReceipt / allocatePayments / taxTypeOf /
│                  ebarimtSettingsProblems — ЦЭВЭР (tests/ebarimt-receipt.test.ts)
├── readiness.ts   ebarimtReadiness — ЦЭВЭР (tests/ebarimt-readiness.test.ts):
│                  идэвхжүүлэхийн ӨМНӨХ кодын дутуу; DB давхарга нь
│                  queue.ts `loadEbarimtReadiness`
├── posapi-info.ts parsePosApiInfo / isMerchantRegistered / hoursSince — ЦЭВЭР
│                  (tests/ebarimt-posapi-info.test.ts); client.ts fetchPosApiHealth
├── tax-product-codes.ts  НӨАТ-гүй (305–446) / 0% (501–507) кодын АЛБАН лавлах —
│                  барааны картын сонгогч; хориглолт биш (ТЕГ код нэмж болно)
├── classification-search.ts  7 оронтой АНГИЛЛЫН код (ҮСХ «Бүтээгдэхүүн, үйлчилгээний
│                  нэгдсэн ангилал» = CPC 2.1 + 2 оронтой үндэсний задаргаа) хайлт —
│                  ЦЭВЭР (tests/ebarimt-classification-search.test.ts)
├── classification-codes.json/.ts  АЛБАН жагсаалт (3499 код) — SERVER-т л ачаална
│                  (client bundle-д оруулахгүй). ЭХ = ҮСХ БҮНА PDF (мерчантын багц
│                  Angilal/, х.4–91): `python3 scripts/extract-buna-pdf.py <pdf> x.csv`
│                  → `node scripts/build-ebarimt-classifications.mjs x.csv`. Багцын
│                  gs1_gs1.xlsx-ийг ХЭРЭГЛЭХГҮЙ (тэргүүлэх 0 алдагдсан, нэр тасарсан).
│                  Эх баримтын давхардсан код (2441030) — дэд ангийн угтвартай таарсан
│                  нь үлдэнэ. Хайлт: бүтэн үг > үгийн эхлэл > дэд мөр. Жагсаалтад
│                  байхгүй 7 оронтой кодыг гараар оруулж болно — ЗОХИОХГҮЙ.
│                  Хайлт: lib/actions/ebarimt-classification.ts; UI сонгогч
│                  components/inventory/ebarimt-code-pickers.tsx (7 ба 3 оронтой)
├── client.ts      PosAPI REST: putReceipt / deleteReceipt / info / sendData
│                  (DB-гүй — browser горимд кассын дэлгэц ч дуудна)
├── gateway-auth.ts WAF-ын нууц header — allowlist-ийн хост руу л (ЦЭВЭР, тесттэй)
├── lookup.ts      ТЕГ-ийн нийтийн getTinInfo (РД → ТТД) + getInfo (ТТД → нэр)
│                  (24ц кэш; parse нь ЦЭВЭР, tests/ebarimt-lookup.test.ts)
├── district-codes.ts/.json  Дүүрэг/хорооны АЛБАН лавлах (506, client-safe) — тохиргооны сонгогч
├── queue.ts       DB давхарга: enqueue / prepare / markSent / markFailed /
│                  claimDueSubmissions / ebarimtStatusSummary
├── worker.ts      claim → PosAPI → бичих; sendSubmissionNow (шууд, timeout-тэй,
│                  түр үр дүн); sendData; гацсан claim чөлөөлөх
└── ticker.ts      In-process worker (20 сек) — EBARIMT_WORKER=off унтраана
lib/actions/ebarimt.ts   Тохиргоо/холболт шалгах/дахин илгээх/лавлах/outbox
app/api/cron/ebarimt     Гадаад cron (Bearer CRON_SECRET)
tests/ebarimt-receipt.test.ts
```

**QPay Quick QR (Фаз 3b, Фаз 1–2 ХЭРЭГЖСЭН).** Баримт:
`docs/pos/04-qpay-integration-plan.md` (D1–D8 БАТЛАГДСАН 2026-09-20, §3.6 нэг
товчны холболт), гэрээ `docs/pos/01-implementation-contract.md` §10,
нэвтрүүлэлт `docs/deployment/qpay.md`. **Entry = ХСН — QPay-тэй ШУУД
харьцахгүй**, `Tuguldur0107/qpay-dashboard` REST v1 (x-api-key) хаалгаар.

```
Холбох: [QPay холбох] → state (AES-GCM, 15 мин) → {dashboard}/connect (бүртгэл/онбординг/consent)
   → callback?state&code → Entry сервер POST /api/connect/exchange → key+secret (НЭГ удаа) → шифртэй хадгална
   → «QPay» хэлбэр + «QPay түр данс» (GL 11000099) seed → readiness → асна   (гар зам: key хуулах хэвээр)
АВТОМАТ (QPAY_PARTNER_KEY): Компанийн мэдээлэл (регистр, MCC, хот/дүүрэг, хаяг, утас, данс ★) → [QPay-д бүртгүүлэх]
   → Entry сервер POST {dashboard}/api/partner/merchants (Bearer, external_id = org id, ИДЕМПОТЕНТ)
   → мерчант + dashboard хэрэглэгч (эзний и-мэйл, нууц үг тохируулах линк) + данс → key+secret → ижил зам
   → qpay_provisioned_at; компанийн данс хадгалах → PUT …/bank-accounts (Entry эх сурвалж)
QPay мөр → [QR үүсгэх] → pos_qpay_intents (open, cartSnapshot) → dashboard POST /api/v1/invoices
   → QR + deeplink; диалог ENTRY DB-ээс 2 сек тутам (QPay polling ҮГҮЙ — ККТТ гэрээ хориглодог)
   ← webhook POST /api/pos/qpay/webhook?intent= (HMAC-SHA256 x-webhook-signature) ЭСВЭЛ [Шалгах] 10 сек-д нэг
→ paid → «Төлбөр авах» → createPosSale({ qpayIntentId }) → транзакц дотор finalizeIntentInTx
```

- **Intent машин ЦЭВЭР** (`lib/qpay/intent.ts`, тесттэй): open → paid | cancelled |
  expired | failed; paid → finalized | failed. `markIntentPaid` ИДЕМПОТЕНТ (webhook ба
  гар шалгалт хоёулаа нэг зам), дүн зөрвөл `failed` + шалтгаан — төлбөр ЗОХИОХГҮЙ
- **Борлуулалт intent-ээс салахгүй:** QPay мөртэй `createPosSale` нь intent `paid`,
  `saleId IS NULL`, дүн таарсан (|Δ|<1₮), QPay мөр НЭГ — эс бөгөөс
  `[QPAY_INTENT_REQUIRED]` / `[QPAY_INTENT_NOT_PAID]` / `[QPAY_AMOUNT_MISMATCH]`.
  Төлөгдсөн ч борлуулалт унавал (D3) intent `paid` хэвээр → борлуулалтын
  жагсаалтын баннер [Борлуулалт болгох] `finalizeQpayIntent` (snapshot-оос ижил
  оролтоор) — мөнгө орсон ч бараа хасагдаагүй ХЭЗЭЭ Ч чимээгүй үлдэхгүй; 10 мин
  хэтэрвэл `pos.qpay_paid_unfinalized` мэдэгдэл (`attention.ts`, өдөрт нэг)
- **GL ӨӨРЧЛӨЛТГҮЙ:** `ewallet` хэлбэрийн түр данс (банкны хуулгаар тэгшитгэнэ,
  ККТТ 1% шимтгэл settlement-д гарна); QPay буцаалт БАЙХГҮЙ (Quick QR refund-гүй) —
  бэлэн / дэлгүүрийн кредитээр
- **Settlement автомат** (`lib/cash/ewallet-settlement.ts` ЦЭВЭР, тесттэй; DB
  `ewallet-settlement-data.ts`): провайдер шимтгэлээ суутгаад банкинд шилжүүлсэн
  хуулгын мөрийг түр дансны ТУЛГАГДААГҮЙ орлогуудтай FIFO-оор тулгана (үлдэгдэлд
  суурилсан — баримт тэмдэглэх баганагүй; хэлбэрийн `feePercent` мөр бүрд, 1₮ +
  0.5₮/орлого хүлцэл; текст = провайдерийн alias / хэлбэрийн нэр → «Хүчтэй»,
  зөвхөн дүн → «Дунд», зөвхөн бүх үлдэгдэл таарсан үед). «Ашиглах» / MCP
  `ewalletSettlement: true` → хадгалахад мөр нь ОРЛОГО биш **түр данс → банк
  ШИЛЖҮҮЛЭГ** (цэвэр) + **шимтгэлийн зарлага** (түр данснаас,
  `pos_settings.ewalletFeeAccountNumber`, default 73100008) — касс модуль ба GL
  хоёул тулна. Нийт нь тулгагдаагүй үлдэгдлээс хэтрэхгүй; шимтгэлийг ЗОХИОХГҮЙ
  (нийт − цэвэр = хуулгын бодит дүн). `get_pos_status` тулгагдаагүй дүнг заана
- **Key-ийн АВТОМАТ сэргээлт** (2026-09-26, пилот: dashboard-ын UI-аас «API key
  солих» Entry-ийн key-г хүчингүй болгож QR зогссон): dashboard интеграц бүрд
  ТУСДАА key олгоно (`qpay-dashboard` `lib/client-keys.ts` — consent
  `entry@<хост>`, partner `entry@<хост>#<org id>`; UI-ийн «солих» зөвхөн мерчантын
  гар key-д). Entry 401 авбал `withQpayKeyRecovery` (`lib/qpay/partner.ts`) →
  `POST …/partner/merchants/{id}/credentials` (partner key, `external_id` + `client_host`)
  → шинэ key + одоогийн secret шифртэй → НЭГ удаа давтана; webhook-ийн гарын үсэг
  таарахгүй (open intent) бол мөн сэргээж дахин шалгана. Cooldown байгууллагад
  минутад нэг (`lib/qpay/recovery.ts` ЦЭВЭР, тесттэй); аудит `credentials_recovered`
  / `credentials_recover_failed` (угтвар л). QPAY_PARTNER_KEY-гүй (dedicated) бол
  [QPay дахин холбох] — алдааны мессеж замыг нэрлэнэ
- **Нууц:** API key (`qpd_live_…`/`qpd_test_…`) ба webhook secret `encryptSecret`-ээр
  (`pos_settings.qpayApiKeyEnc/qpayWebhookSecretEnc`), зөвхөн `lib/qpay/store.ts`
  задална; `getQpayStatus` → `*Set: boolean`; аудит, лог, `/api/health.qpay`-д УТГА
  ХЭЗЭЭ Ч гарахгүй. Console мерчантын нууц хадгалахгүй
- **Идэвхжүүлэхээс ӨМНӨ readiness** (`lib/qpay/readiness.ts` ЦЭВЭР, тесттэй): API URL,
  key, webhook secret, `NEXT_PUBLIC_APP_URL` (нийтийн webhook URL) — дутуу бол
  switch идэвхгүй, `saveQpaySettings` ШИДНЭ; localhost → анхааруулга
- **Асаахад хэлбэр + данс АВТОМАТ** (`lib/qpay/seed.ts` ЦЭВЭР төлөвлөгч, тесттэй;
  `ensureQpayPaymentMethod` DB) — ratified-seed: «QPay» (ewallet, provider qpay) +
  «QPay түр данс» (банк, GL 11000099) дутуу бол л үүснэ, байгааг хөндөхгүй;
  readiness `seedOnEnable` (default) хэлбэр/данс дутууг warning гэж үзнэ, seed-ийн
  ДАРАА `seedOnEnable:false` хатуу шалгана. eBarimt код `BANK_TRANSFER_QPAY`
  (PosAPI 3.0 албан жагсаалт, 2026-09-25 — урьд null); кодгүй байгаа QPay хэлбэрт нөхнө, хэрэглэгчийн оноосныг хөндөхгүй
  Провайдергүй, кодоороо `QPAY…` гэсэн ewallet (асаахаас ӨМНӨ гараар үүсгэсэн,
  лавлах асуудаг) байвал ШИНЭ хэлбэр үүсгэхгүй — түүнийг `provider "qpay"` +
  лавлах заавал биш болгож QR горимд оруулна (`adopt`; кассанд хоёр QPay товч
  гарахаас сэргийлнэ — Хос Хас 2026-09-26)
- **Автомат бүртгэл — Partner API** (`docs/deployment/qpay.md` §2b, plan §3.7;
  dashboard `docs/API.md` «Partner»): `lib/qpay/provision.ts` ЦЭВЭР (тесттэй —
  `buildQpayProvisionPlan`: регистрээс company/person, дутууг МОНГОЛООР нэрлэнэ,
  `mapQpayBankAccounts` банкны код нэрээс таагдвал л, default нэг);
  `lib/qpay/reference.ts` CLIENT-SAFE лавлах (MCC 85, банкны код, хот, УБ дүүрэг —
  ЭХ dashboard `src/lib/*`; аймгийн сум `getQpayDistricts` action); `lib/qpay/partner.ts`
  SERVER (`provisionQpayMerchantForOrg` — нууц connect callback-тай ИЖИЛ замаар
  шифртэй, `syncQpayBankAccountsForOrg` best effort — `{ warning }` буцаана,
  хадгалалт унахгүй). Partner key `qpayPartnerKey()` store.ts-д (partner ↔ store
  импортын тойрог үүсгэхгүй). `company_settings.mcc_code/city_code/district_code`,
  `pos_settings.qpay_provisioned_at` (null = consent/гар зам → данс sync ҮГҮЙ).
  Код ЗОХИОХГҮЙ — dashboard 400/502-ийн шалтгаан `[QPAY_PROVISION_REJECTED]`-ээр
  хэрэглэгчид ил
- **QPay данс = КАССЫН МОДУЛИЙН банкны данс, салбар = агуулах** (2026-09-25;
  `company_settings.bank_accounts` ЗӨВХӨН нэхэмжлэхийн толгойд — тэнд QPay sync
  ҮГҮЙ, `isDefault` хуучин мөрд л): `cash_accounts.bank_code` (жагсаалтаас —
  `qpayBankName`), `iban`, `account_holder` (хоосон бол компанийн нэр),
  `qpay_payout` («QPay төлбөр хүлээн авах» — MNT банкны данс, дугаартай),
  `qpay_default` (нэг л — `afterQpayAccountChange` бусдаас авна, үндсэнгүй бол
  эхний тэмдэглэсэн). ЦЭВЭР `payoutAccountsFromCashAccounts` (тесттэй), DB
  `loadQpayPayoutAccounts`; create/update/toggle/delete бүр QPay-д хамаатай
  өөрчлөлтөд sync (toast анхааруулга). `warehouses.qpay_cash_account_id` (FK set
  null; тэмдэглэсэн идэвхтэй банкны данс л — `resolveWarehouseQpayAccount`) →
  `createQpayIntent` ээлжийн агуулахаас `resolveWarehousePayoutAccount` →
  `createDashboardInvoice({ payoutAccountNumber })` → dashboard `payout_account_number`
  (sync-лэсэн данс л, тэр нэхэмжлэхэд default; бүртгэлгүй → 400). Сонгоогүй
  агуулах = үндсэн данс; сонгосон данс тэмдэг/идэвхгүй болсон бол QR үүсгэхэд
  ИЛ алдаа (fallback ҮГҮЙ). GL/settlement өөрчлөлтгүй (нэг түр данс). preDeploy
  нэг удаа: provisioned байгууллагын company_settings данстай дугаараар таарах
  кассын дансыг тэмдэглэнэ. AI `create_cash_account` `bankCode/accountHolder/
  iban/qpayPayout/qpayDefault`
- **Нэг товчны холболт** (`lib/qpay/connect.ts` SERVER, тесттэй; `startQpayConnect`;
  `app/api/pos/qpay/connect/callback`): state нь authenticated шифр (org, user,
  apiUrl, 15 мин) — өөр байгууллагын нэрээр зохиох боломжгүй; code нэг удаагийн
  (5 мин), солилцоо СЕРВЕР-СЕРВЕР — нууц URL/browser/лог/аудитад ХЭЗЭЭ Ч орохгүй.
  Дахин холбоход dashboard-ын key СОЛИГДОНО (UI анхааруулна). Нийтийн URL-гүй
  бол товч идэвхгүй, гар зам хэвээр. Dashboard тал: `src/app/connect`,
  `src/app/api/connect/{approve,exchange}`, `src/lib/connect-grants.ts`
- **Raw `sql` template-д Date объект ШУУД параметр болохгүй** — postgres драйвер
  string/Buffer шаардана (`${date.toISOString()}::timestamptz` эсвэл drizzle
  operator). 2026-09-20: `/api/health.qpay` null, QPay таб production-д
  уншигдахгүй байв; `tests/sql-date-params.test.ts` статикаар барина
- **Client/server хил:** `intent.ts` `crypto`-гүй (кассын диалог import хийдэг);
  HMAC нь `webhook-signature.ts` (зөвхөн route). Webhook нэвтрэлтгүй — org нь
  intent-ээс, эрх нь гарын үсгээс (401/422/409 кодоор татгалзана, аудит
  `pos_qpay_intent`)
- Хэлбэрийн `provider` зөвхөн `ewallet` kind-д, зөвхөн `"qpay"`
  (`resolvePaymentProvider`); нэг борлуулалтад QPay мөр НЭГ

```
lib/qpay/
├── constants.ts        QPAY_PROVIDER/статус/TTL (60–900, default 180)/шалгалтын
│                       интервал/алдааны код — CLIENT-SAFE
├── types.ts            Dashboard JSON + QpayIntentView / QpayStatusSummary
├── intent.ts           canTransition, clampInvoiceTtl, isExpired, checkAllowed,
│                       amountMatches, parseWebhookPayload, secondsLeft — ЦЭВЭР (тесттэй)
├── readiness.ts        qpayReadiness (seedOnEnable) — ЦЭВЭР (тесттэй)
├── seed.ts             planQpaySeed — асаахад хэлбэр + түр данс (ЦЭВЭР, тесттэй)
├── connect.ts          buildConnectState / parseConnectState / connectUrl / exchangeConnectCode — SERVER (тесттэй)
├── webhook-signature.ts verifyWebhookSignature (node:crypto, timing-safe) — SERVER
├── client.ts           Dashboard REST: create/cancel/check/list (8 сек timeout, QpayError)
└── store.ts            DB давхарга: config (decrypt), intent CRUD, markIntentPaid,
                        finalizeIntentInTx, expireStaleIntents, summary, countPaidUnfinalized
lib/actions/qpay.ts     getQpayStatus / saveQpaySettings (seed) / testQpayConnection /
                        startQpayConnect / createQpayIntent / getQpayIntent / checkQpayIntent /
                        cancelQpayIntent / listPendingQpayIntents / finalizeQpayIntent
app/api/pos/qpay/webhook/route.ts            payment.paid webhook
app/api/pos/qpay/connect/callback/route.ts   нэг товчны холболтын буцах зам (exchange → хадгалах → асаах)
components/pos/checkout/qpay-dialog.tsx  QR диалог; components/ui/qr-code.tsx SVG QR
lib/ai/tools.ts get_qpay_status (унших — getQpayStatus-тай НЭГ loader)
tests/qpay-{intent,readiness,seed,connect}.test.ts, tests/sql-date-params.test.ts
```
