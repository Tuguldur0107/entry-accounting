# eBarimt 3.0 (PosAPI 3.0) — Entry-ийн холболтыг албан баримттай тулгасан тайлан

**Огноо:** 2026-09-25. **Тулгасан эх:** developer.itc.gov.mn `ebarimt-api` проектын
албан хуудсууд (2026-08-20-ны хуулбар — `00-itc-developer-portal.md` §6, §7),
өөрчлөлтийн түүх v3.0.12 (2025-03 → 2026-06-18), ХСН-д тавигдах шаардлагын 18
зүйл, гурван нээлттэй SDK. **Тулгасан код:** `lib/ebarimt/*`, `lib/pos/ebarimt-buyer.ts`,
`tests/ebarimt-*.test.ts`, `docs/pos/03-ebarimt-integration-plan.md`,
`docs/deployment/ebarimt.md`.

**Дүгнэлт:** Архитектур (операторын нэг PosAPI, олон мерчант), урсгал (дараалал →
POST /rest/receipt → ДДТД; хэсэгчилсэн буцаалт `inactiveId`; бүтэн буцаалт DELETE;
`sendData`; `/rest/info` хяналт), нууцлал (сугалаа/QR хадгалахгүй), ангилал/татварын
код, taxType бүлэглэл — **албан баримттай нийцнэ**. Гэвч **wire-формат ба
идемпотентийн 3 асуудал (P0)** staging дээр шалгаж засахгүйгээр «баталгаажсан» гэж
хэлж болохгүй; 4 P1, 12 P2 зүйл доор. Энэ орчноос PosAPI staging-д хүрэх боломжгүй
(Монголын IP шаардлагатай) тул §4-ийн тестийг Монголоос ажиллуулна.

---

## 1. Нийцсэн зүйлс (✅)

| Сэдэв | Албан баримт | Entry |
|---|---|---|
| Замууд | `POST/DELETE /rest/receipt`, `GET /rest/info`, `GET /rest/sendData`, `GET /rest/bankAccounts` | `POSAPI_PATHS` (bankAccounts хэрэглэдэггүй — шаардлагагүй) |
| Топологи | §1.2 нэг PosAPI олон ААН; Best practice ≤1000 мерчант, ≤100k баримт/өдөр | Операторын нэг PosAPI (A′), `merchantTin` = харилцагчийнх |
| Баримтын төрөл | B2C_RECEIPT, B2B_RECEIPT, B2C_INVOICE, B2B_INVOICE (+ STOCK_QR — ОАТ-д л) | `receiptTypeOf`: ТТД → B2B, зээлийн хэсэг (`PAY`) → INVOICE |
| taxType бүлэглэл | «татварын төрөл тус бүрээр дэд баримт үйлдэнэ» | `receipts[]` taxType-аар Map бүлэглэлт |
| `posNo` | «Тухайн байгууллагын дотоод кассын дугаар» | `pos_settings.ebarimtPosNo` (PosAPI-ийн 8 оронтой posNo-той андуурахгүй — баримтжуулсан) |
| `branchNo` | 3 оронтой, татвар төлөгч өөрөө тодорхойлно | чөлөөт мөр (3 орон гэж UI-д зөвлөх — P2) |
| `consumerNo` | 8 орон, зөвхөн B2C_RECEIPT | `CONSUMER_NO_RE`, B2B-д илгээгдэхгүй |
| Хэсэгчилсэн буцаалт | `inactiveId` = сүүлийн ДДТД, гинж, сугалаа дахин олгохгүй | `prepareSubmission` — ДДТД шинэчлэгдэж дараагийн засвар гинжлэнэ |
| Бүтэн буцаалт | `DELETE {id, date}` | `posApiDeleteReceipt` |
| Сугалаа / QR | «хэвлэхээс өөрөөр ямар ч хэлбэрээр хадгалахыг хориглоно» | `stripReceiptSecrets`, `pos_sales`-аас багана хасагдсан, зөвхөн хариуны мөчид хэвлэнэ |
| Ангилалын код | 7 оронтой БҮНА; VAT_FREE/ZERO-д `taxProductCode` | `CLASSIFICATION_CODE_RE`, бүлгээс өвлөлт, readiness |
| `barCodeType` | UNDEFINED / GS1 / ISBN | `barcodeTypeOf` |
| Хариу | `id` (33 орон ДДТД), `status` SUCCESS/ERROR/PAYMENT, `lottery`, `qrData`, `date`, `easy` | `receiptResponseOutcome`, `resultOf` |
| `/rest/info` | operatorName, operatorTIN, posNo, lastSentDate, leftLotteries, merchants[{name,tin,customers[]}] | `parsePosApiInfo`, `isMerchantRegistered` → «Мерчант бүртгэл» |
| Хяналт | Шаардлага №6: сугалаа дуусах, 3 хоногийн хугацаа анхааруулах; №4 өдөрт ≥1 автомат илгээлт | `pos.ebarimt_lottery_low` (<200), `send_stale` (48ц/72ц), `posapi_down`; 23:30 `sendData` |
| Нийтийн лавлах | `getTinInfo?regNo=` → `data: <ТТД тоо>`; `getInfo?tin=` → name/vatPayer/cityPayer/freeProject/found | `parseTinInfoResponse`, `parseTaxpayerInfoResponse` (тесттэй) |
| Нэвтрүүлэлт | operator.ebarimt.mn → мерчант нэмэх → e-invoice / Ebarimt-Mobile-аар батлах (2025-12-18) | `docs/deployment/ebarimt.md` §2 (мобайл апп-аар батлах замыг нэмэх — P2) |

---

## 2. P0 — staging тестгүйгээр production-д ИТГЭХ БОЛОМЖГҮЙ

### 2.0 Засварын тэмдэглэл (2026-09-25 — P0-1/P0-2/P0-3 нэг PR)

**Staging тест (§4.1) ЭНЭ удаа АЖИЛЛУУЛААГҮЙ — шалтгаан:** Монголын IP
(Улаанбаатар, Univision) байсан ч §4.1-ийн тест PosAPI daemon (`localhost:7080`)
руу явдаг. Daemon нь Linux `.deb` (Qt, NIC шаардана); хөгжүүлэлтийн Mac дээр Docker
ч, суулгасан PosAPI ч байхгүй; Railway-ийн `Entry Accounting` төсөлд PosAPI service
БАЙХГҮЙ (PROD PosAPI операторын өөрийн серверт — `docs/deployment/ebarimt.md` §4,
тест баримт илгээх ХОРИОТОЙ). `st-operator.ebarimt.mn` (200) ба
`api.ebarimt.mn` (200) хүрч байгааг л баталгаажуулав. §4.1 (1)(2)(3)(5) тестийг
тестийн оператор PosAPI суусан Linux машин / контейнерээс ажиллуулж үр дүнг
доорх хүснэгтэд нөхнө — production деплойн ӨМНӨ.

| # | Тест | Үр дүн | Огноо / PosAPI version |
|---|---|---|---|
| 1 | `totalVat` (хуучин) | _хүлээгдэж байна_ | — |
| 2 | `totalVAT` (шинэ) | _хүлээгдэж байна_ | — |
| 3 | `billIdSuffix`-гүй | _хүлээгдэж байна_ | — |
| 4 | `billIdSuffix` 6 / 8 оронтой цифр (Entry-ийн бодит урт), үсэгтэй | _хүлээгдэж байна_ | — |
| 5 | Ижил `billIdSuffix` өдөртөө 2 удаа | _хүлээгдэж байна_ | — |

**Кодонд хийсэн (албан баримтыг дагаж, staging хариу хүлээлгүй — хоёр SDK ба
албан хуудас нэг л хэлбэрийг заадаг):**

- **P0-1 ✅** `EbarimtItem` / `EbarimtSubReceipt` / `EbarimtReceiptRequest`-ийн талбар
  `totalVAT` (TS нэр = wire түлхүүр); `receipt.ts` гурван түвшинд `totalVAT`;
  `tests/ebarimt-receipt.test.ts`-д wire JSON snapshot (`"totalVat"` ХЭЗЭЭ Ч үгүй,
  `"totalVAT":` тоо = 1 + receipts + items). `lib/`, `components/`, `app/`-д өөр
  уншигч байгаагүй (grep).
- **P0-2 ✅** `billIdSuffixOf(documentNo, edit)` (`receipt.ts`, ЦЭВЭР, тесттэй):
  `POS-YYMM-NNNN` → `MMNNNN` (6 орон — сарын дараалал тул өдөртөө давтагдахгүй,
  сарын хил дээр хоцорч илгээгдсэн баримт MM-ээр ялгарна); `edit ≥ 1` → + 2 орон
  (`09000101`); POS биш угтвар (`RET-`) → тэргүүлэх `9`; цифргүй →
  `[EBARIMT_BILL_ID]`. `buildEbarimtReceipt` root-д ЗААВАЛ тавина; `inactiveId`
  засварт `edit` өгөөгүй бол 1 (эх suffix-тэй ижил явуулбал PosAPI дедуп хийгээд
  шинэ ДДТД олгохгүй байж болзошгүй). `prepareSubmission` `edit` = тухайн
  борлуулалтын ЭНЭ submission-оос ЭРТ үүссэн submission-ийн тоо (`editIndexOf`,
  createdAt/id дараалал) — оролдлогын тооноос ХАМААРАХГҮЙ тул нэг submission-ийн
  бүх дахин илгээлтэд ИЖИЛ (PosAPI дедуп), дараагийн бичилт бүрд ӨӨР. Зөвхөн
  цифр, ердийн урт 6–8 — §4.1 (4)-ийг энэ уртаар шалгана.
- **P0-3 ✅** `POSAPI_RECEIPT_TIMEOUT_MS = 90_000` — `POST`/`DELETE /rest/receipt`
  хоёуланд (`/rest/info` 10с, `sendData` 60с хэвээр); `EBARIMT_INLINE_SEND_TIMEOUT_MS`
  8с хэвээр (кассын хүлээлт, Promise.race — ажил ард үргэлжилнэ, claim 10 мин
  хүртэл). Timeout нь тусдаа код `EBARIMT_POSAPI_TIMEOUT` («хүрсэнгүй» биш —
  «хүрч ДДТД үүссэн байж болзошгүй»); worker `lastError`-д «ДАВХАР ДДТД-ийн
  ЭРСДЭЛ: дахин илгээхэд ижил billIdSuffix=… явна — PosAPI үүгээр давхардлыг
  таних ёстой; ТЕГ-ийн баримтыг гараар тулгана» гэж ил бичээд backoff-оор дахин
  оролдоно. `/rest/info`-оор амьд эсэхийг урьдчилж шалгах алхмыг НЭМЭЭГҮЙ (§4.1 (5)
  дедупийн хариу гартал — PosAPI дедуп хийдэг бол шаардлагагүй, хийдэггүй бол
  timeout-ын дараа АВТОМАТ дахин илгээлтийг өөрөө зогсоох хэрэгтэй болно).

### P0-1. JSON түлхүүрийн бичлэг: `totalVAT` (албан) vs `totalVat` (Entry)

| Эх | Root | receipts[] | items[] |
|---|---|---|---|
| Албан хуудас (хүсэлт + хариуны хүснэгт, жишээ JSON, PosAPI 3.2.44 хариу) | `totalVAT` | `totalVAT` | `totalVAT` |
| Fibocloud/payment-sdks (2026-03) | `totalVAT` | `totalVAT` | `totalVAT` |
| hurelhuyag/ebarimt Java (2025-02) | `totalVAT` | `totalVAT` | `totalVAT` |
| techpartners-asia/ebarimt-pos3-go (2026-08) | `totalVat` | `totalVat` | `totalVat` |
| **Entry** `lib/ebarimt/types.ts`, `receipt.ts` | **`totalVat`** | **`totalVat`** | **`totalVat`** |

Эрсдэл: PosAPI (Qt/C++) JSON түлхүүрийг case-sensitive уншдаг бол Entry-ийн
НӨАТ-ын дүн `null` гэж хүлээн авагдаж, VAT_ABLE баримт **НӨАТ 0-тэй** ТЕГ-д
бүртгэгдэнэ (сарын НӨАТ тайлан ↔ eBarimt зөрүү, шалгалтын эрсдэл). Techpartners
production SDK `totalVat` ашигладаг тул PosAPI хоёуланг таньдаг байж болох ч
**баталгаа байхгүй**. Албан баримт `totalVAT` — Entry үүнийг дагах ёстой.

Санал: `EbarimtItem/EbarimtSubReceipt/EbarimtReceiptRequest`-ийн талбарыг
`totalVAT` болгон солих (TS нэр ба wire түлхүүр ижил байлгах — `stripReceiptSecrets`-тэй
адил ил байх); `tests/ebarimt-receipt.test.ts` 4 assert дагаж солино; §4.1 тестээр
хоёр хувилбарын хариуны `totalVAT`-г тулгана.

### P0-2. `billIdSuffix` (✔ шаардлагатай) Entry илгээдэггүй

Албан: *«Баримтын ДДТД-ыг давхцуулахгүйн тулд олгох дотоод дугаарлалт. Тухайн
өдөртөө дахин давтагдашгүй дугаар»* — root түвшинд **шаардлагатай** (✔), жишээ `"01"`.
Fibocloud SDK: «must be unique within the current day (used to deduplicate ДДТД)».
Entry `EbarimtReceiptRequest`-д талбар ОГТ БАЙХГҮЙ.

Эрсдэл: (а) шинэ PosAPI хувилбар талбар дутууг ERROR гэж татгалзаж болно
(одоогийн production дээр амжилттай явж байгаа бол PosAPI өөрөө нөхдөг гэсэн үг —
§4.1 (3) тестээр тогтооно); (б) **P0-3-ын давхардлаас хамгаалах цорын ганц механизм**
энэ талбар.

Санал: `billIdSuffix` = борлуулалтын дугаарын өдөрт давтагдашгүй хэсэг
(`POS-YYMM-NNNN` → `NNNN`; буцаалтын засвар (`inactiveId`) бол `NNNN` + засварын
дараалал, `RET-` баримтад тусдаа угтвар) — ЦЭВЭР `billIdSuffixOf(sale, attempt)`
`receipt.ts`-д, тесттэй. Зөвшөөрөгдөх тэмдэгт/урт албан баримтад байхгүй → §4.1 (4)-ээр
цифр 4–8 орон гэж шалгана.

### P0-3. Timeout → дахин илгээлт → давхар баримтын эрсдэл

- `POSAPI_TIMEOUT_MS = 10_000` (`client.ts`), worker timeout-д `markFailed` → backoff →
  **ижил payload дахин POST**. Techpartners SDK-ийн тэмдэглэл: *«the POS 3.0 daemon can
  legitimately take tens of seconds to answer /rest/receipt while it flushes its
  backlog to the gov host»*. Хүсэлт PosAPI-д хүрч ДДТД үүссэн ч Entry 10 сек-д таслаад
  «амжилтгүй» гэж үзвэл дараагийн оролдлого **хоёр дахь ДДТД + хоёр дахь сугалаа**
  үүсгэнэ (ТЕГ-д борлуулалт давхардана, НӨАТ давхар).
- `EBARIMT_INLINE_SEND_TIMEOUT_MS = 8_000` нь зөвхөн кассын хүлээлтийг таслаж
  ажлыг ард үргэлжлүүлдэг (`Promise.race`) — энэ нь зөв; асуудал HTTP-ийн 10 сек.

Санал: HTTP timeout-ийг 60–90 сек болгох (SDK-ийн шиг холболтын dial-ийг богино,
хариуны толгойг урт); `billIdSuffix` (P0-2) ижил утгаар дахин илгээх → PosAPI
дедуп хийнэ гэсэн таамгийг §4.1 (5)-аар шалгах; PosAPI-д «ДДТД шалгах» GET байхгүй
тул timeout-ын дараа **дахин илгээхийн өмнө** `/rest/info`-оор амьд эсэхийг шалгаж,
`pos_ebarimt_submissions.lastError`-д «timeout — давхардлын эрсдэл» гэж ил тэмдэглэх.

---

## 3. P1 — ажиллагаанд нөлөөлөх

> **Төлөв 2026-09-25:** P1-1 (`EBARIMT_PUBLIC_API_BASE` env, `publicApiBase()`), P1-2
> (иргэний РД татгалзана, ТТД шууд → нэр `lookupTaxpayerByTin`, касс ТТД-г үндсэн зам
> болгов, алдаанд ТТД-ийн зөвлөмж), P1-4 (`EBARIMT_PAYMENT_CODES`, readiness `warnings`,
> QPay seed `BANK_TRANSFER_QPAY`, `INVOICE` санал хасагдав) кодонд оров. P1-3 — DELETE-ийн
> урсгал ХЭВЭЭР (бүтэн буцаалт → DELETE), татгалзсан хариунд ТЕГ-ийн дүрмийг ил бичнэ;
> B2B бүтэн буцаалтын зөв замыг §4.1 (7) staging тестээр тогтооно. Харилцагчийн картад
> ТТД хадгалах (schema багана) — дараагийн PR.

| # | Асуудал | Албан эх | Entry одоо | Санал |
|---|---|---|---|---|
| P1-1 | **Гео-хязгаар:** `api.ebarimt.mn`, `auth.itc.gov.mn` зөвхөн Монголын сүлжээнээс | API холболтын заавар «Сүлжээний тохиргоо» | `lookup.ts` (`getTinInfo`/`getInfo`/`getBranchInfo`) Railway серверээс шууд `fetch` → гадаад бүсэд **унах магадлал өндөр**; кассын ААН лавлах, дүүргийн сонголт ажиллахгүй | Монголд байрлах egress (операторын PosAPI сервер дээрх reverse proxy / VPN) — `EBARIMT_PUBLIC_API_BASE`-ийг env-ээр солигддог болгох; production log-оор одоогийн амжилтын хувийг шалгах |
| P1-2 | **`getTinInfo?regNo=` зогсох төлөвлөгөө (2026-06-15)** — хувь хүний мэдээлэл хамгаалах хууль 4.1.11 | Мэдэгдэл 2026-05-11 | B2B худалдан авагч: 7 оронтой РЕГИСТР → `getTinInfo` → ТТД (`ebarimt-buyer.ts`, `lookup.ts`) | ТТД-г шууд оруулах зам байгаа (`orgNoKind "tin"`) — үүнийг үндсэн болгож регистр замыг «боломжтой бол» болгох; харилцагчийн картад ТТД хадгалах (`counterparties`), нэг удаа лавласныг дахин лавлахгүй; иргэний РД-аар лавлахгүй (`REGISTER_NO_RE` зам) |
| P1-3 | **DELETE зөвхөн B2C_RECEIPT, иргэн баталгаажуулаагүй баримт**; баталгаажсан бол «Баталгаажаагүй буцаалт» → иргэн апп-аас зөвшөөрсний дараа л идэвхгүй | DELETE /rest/receipt хуудас | Бүх төрлийн (B2B ч) бүтэн буцаалтыг DELETE-ээр, амжилтад `cancelled` | B2B_RECEIPT/INVOICE бүтэн буцаалт → `inactiveId`-тай засвар эсвэл ТЕГ-ийн зааврыг §4.1 (7)-оор тогтоох; DELETE-ийн хариунд «хүлээгдэж буй» төлөв байвал `cancelled` биш `cancel_pending` гэж ил харуулах |
| P1-4 | **Төлбөрийн кодын жагсаалт:** CASH, PAYMENT_CARD, BANK_TRANSFER, **BANK_TRANSFER_QPAY** | payments[].code хүснэгт | `EBARIMT_PAYMENT_CODE_SUGGESTIONS`: credit → `"INVOICE"` (жагсаалтад БАЙХГҮЙ), ewallet/transfer/bnpl → null | QPay хэлбэрт `BANK_TRANSFER_QPAY`, шилжүүлэгт `BANK_TRANSFER` санал болгох (QPay seed `lib/qpay/seed.ts` — код ЗОХИОХГҮЙ дүрэм хэвээр, харилцагч батална); `credit`-ийн код нь дараа төлөгдөх хэлбэрийнх (`PAY` статустай) — `INVOICE` кодыг хасаж §4.1 (8)-аар шалгах |

---

## 4. Staging тестийн төлөвлөгөө (Монголын IP, ~1 цаг)

Орчин: `st-operator.ebarimt.mn` (`АА10010110` / `Test@123`, TEST OPERATOR1), PosAPI
staging `.deb` (`share.itc.gov.mn`), `http://localhost:7080/web/` идэвхжүүлэх, мерчант
`37900846788` нэмж `stg-invoice.ebarimt.mn`-д батлах, «Мэдээлэл илгээх» → `/rest/info`
`merchants[]`-д гарна. Ачааллын тест ХОРИОТОЙ.

### 4.1 Шалгах зүйлс (curl — Entry-ийн бодит payload-аар)

Entry-ийн payload авах: `pos_ebarimt_submissions.payload.request` (аль ч харилцагчийн
staging DB) эсвэл `tests/ebarimt-receipt.test.ts`-ийн fixture-ээр `buildEbarimtReceipt`.

| # | Тест | Хүлээгдэх / Тэмдэглэх |
|---|---|---|
| 1 | Payload-ыг **яг одоогийнхоор** (`totalVat`) илгээх | Хариуны `totalVAT` = хүлээгдэж буй НӨАТ үү, 0 уу? 0 бол P0-1 БАТЛАГДАНА |
| 2 | Ижил payload `totalVAT`-аар | `totalVAT` зөв; `status: SUCCESS` |
| 3 | `billIdSuffix`-гүй илгээх | ERROR уу, PosAPI өөрөө нөхөв үү (хариуны `id`-ийн сүүлийн орнууд) |
| 4 | `billIdSuffix` 6 / 8 оронтой цифр (Entry: `090001` / `09000101`), үсэгтэй | Зөвшөөрөгдөх урт/тэмдэгт — 8 орон татгалзвал `billIdSuffixOf`-ийн засварын дугаарыг 1 орон болгоно |
| 5 | **Ижил `billIdSuffix` өдөртөө 2 удаа** (P0-3 симуляц) | Хоёр дахь нь ижил ДДТД буцаах уу (дедуп) / ERROR уу / шинэ ДДТД үү |
| 6 | `taxType: "NOT_VAT"` ба `"NO_VAT"` (НӨАТ төлөгч бус тест мерчант байвал) | Аль нь хүлээн авагдах; Entry НӨАТ төлөгч бус байгууллагад илгээдэггүй тул нөлөө бага (§5) |
| 7 | B2B_RECEIPT-ийг `DELETE` | Хариу (хүлээн авах / татгалзах / хүлээгдэж буй) → P1-3 |
| 8 | `payments[].code`: `BANK_TRANSFER_QPAY`, `INVOICE` (PAY статустай) | `INVOICE` татгалзагдвал suggestion-оос хасна |
| 9 | `customerTin` 12 ба 13 оронтой (хувь хүний civil id) | Хүлээн авагдвал `MERCHANT_TIN_RE` → `^\d{11,14}$` |
| 10 | `taxProductCode` 5 оронтой (`getProductTaxCode`-ийн `43401` жишээ) VAT_FREE-д | Хүлээн авагдвал `TAX_PRODUCT_CODE_RE` сулруулах, лавлахыг `getProductTaxCode`-оос татах |
| 11 | `/rest/receipt` хариуны хугацаа 20 удаа (backlog-тэй үед) | p95 > 10 сек бол P0-3 БАТЛАГДАНА |
| 12 | Хариуны `version` (жишээ 3.2.44) | Операторын PosAPI ≥ 3.0.12 (2025-11-25 «яаралтай») эсэх |

```bash
POSAPI=http://localhost:7080
curl -sS -X POST "$POSAPI/rest/receipt" -H 'Content-Type: application/json' -d @payload.json | jq '{id,status,message,totalVAT,version,lottery:(.lottery|length)}'
curl -sS "$POSAPI/rest/info" | jq '{operatorTIN,posNo,leftLotteries,lastSentDate,merchants:[.merchants[].tin]}'
```

### 4.2 Entry талын тест (кодын өөрчлөлтийн дараа)

```bash
npm test -- tests/ebarimt-receipt.test.ts tests/ebarimt-posapi-info.test.ts tests/ebarimt-lookup.test.ts tests/ebarimt-readiness.test.ts
```

Шинэ тест (✅ 2026-09-25, `tests/ebarimt-receipt.test.ts`): `billIdSuffix` өдөрт
давтагдашгүй, дахин илгээлтэд тогтвортой, `inactiveId` засварт өөр, `RET-` эхээс
өөр; wire JSON-д `totalVAT` түлхүүр, `totalVat` үгүй (snapshot).

---

## 5. P2 — сайжруулалт / баримтжуулалт

> **Төлөв 2026-09-25:** кодонд — P2-1 (`MERCHANT_TIN_RE` 11–14), P2-2 (`TAX_PRODUCT_CODE_RE`
> 3–5, лавлахыг API-аас татах хэвээр хийгдээгүй), P2-3/P2-4 (`getInfo`-ийн `freeProject`/
> `cityPayer` кассын лавлах + мерчантын статуст анхааруулга — автомат VAT_FREE/НХАТ бичихгүй),
> P2-9 (`lastSendDate`), P2-10 (хариуны `version` статуст, <3.0.12 улаан), P2-14 (branchNo hint),
> P2-13 (байсан). Баримтад — P2-11/12/15 (`ebarimt.md`), P2-5/6/8/16 (`02-implementation-status.md`
> хязгаарлалт — schema/UI-ийн тусдаа change-control). P2-7 N/A.

| # | Зүйл | Санал |
|---|---|---|
| P2-1 | `MERCHANT_TIN_RE = ^(\d{11}|\d{14})$` — албан: хуулийн этгээд 11, **хувь хүн 12–14** | `^\d{11,14}$` (§4.1 (9)-ийн дараа) — customerTin, merchantTin хоёуланд |
| P2-2 | `TAX_PRODUCT_CODE_RE = ^\d{3}$` — `getProductTaxCode` жишээ `43401` (5 орон); албан жагсаалт огноотой (`startDate/endDate`) | Лавлахыг API-аас (Монголын egress) татаж `tax-product-codes.ts`-тэй тулгах; урт 3–5 |
| P2-3 | `getInfo` → `freeProject: true` бол `taxType VAT_FREE` + `taxProductCode "304"` (НӨАТ-аас чөлөөлөгдөх төслийн худалдан авагч) | B2B худалдан авагчийн лавлахад `freeProject`-ийг авч мөрүүдийг VAT_FREE/304 болгох сонголт (баталгаажуулалттай) |
| P2-4 | `cityPayer` (НХАТ) — `totalCityTax` үргэлж 0 (T4 хойшилсон) | Зочид буудал/ресторан/бар харилцагч авахаас өмнө T4; `getInfo.cityPayer` = true бол readiness анхааруулга |
| P2-5 | `items[].data.stockQR[]` — ОАТ-ын тэмдэгтэй бараа (архи, тамхи) **2025-04-01-ээс заавал**; `type STOCK_QR` | Барааны картад «ОАТ тэмдэгтэй» тэмдэг + QR сканнердах — дэмжигдээгүй, `02-implementation-status.md`-д ил хязгаар болгож бичих |
| P2-6 | `receipts[].data.location` (GPS / LICENSE) — 2026-06-18-аас боломж | Сонголтоор: `pos_settings`-д салбарын өргөрөг/уртраг; LICENSE-д `cityTax/location` (X-API-KEY) |
| P2-7 | `payments[].data` EASY_BANK_CARD (terminalID, rrn, maskedCardNumber, easy) — банкны терминалтай холбогдсон бол «заавал» (шаардлага №18) | Entry терминалтай холбогдоогүй → N/A; ирээдүйн карт интеграцид `exchangeCode`-оос гадна `data` |
| P2-8 | `reportMonth` — B2B_RECEIPT/INVOICE-ийг сарын 1–7-нд өмнөх сараар нөхөн үүсгэх | Нөхөн илгээх UI байхгүй — өмнөх сарын `failed` баримтыг сарын 1–7-нд `reportMonth`-тэй илгээх сонголт |
| P2-9 | `/rest/info` талбар `lastSentDate` (албан) vs `lastSendDate` (Go SDK) | `parsePosApiInfo` хоёуланг унш (`leftLoteries`-тэй ижил хэв маяг) |
| P2-10 | Хариуны `version` хадгалагдана (`response` jsonb) ч UI-д харагдахгүй | Тохиргооны табд «PosAPI хувилбар» (3.0.12-оос доош бол анхааруулга) |
| P2-11 | Best practice №3: PosAPI нийтийн сүлжээнд ил байж болохгүй | Railway ↔ операторын PosAPI: VPN/tunnel + IP allowlist; `docs/deployment/ebarimt.md` §4-д нэмэх |
| P2-12 | `noEasyResponse = true` (posapi.ini) — банкны хариу хүлээхгүй; `skipHours = 1114,1821` update цаг | Операторын суулгацын checklist-д (`ebarimt.md` §4) |
| P2-13 | Шаардлага №5 «гараар илгээх товч» (`sendData`) | ✅ Байна — `pushEbarimtData` (`lib/actions/ebarimt.ts`); шалгалтад үзүүлэх алхам гэж `ebarimt.md`-д тэмдэглэх |
| P2-14 | `branchNo` 3 оронтой тоон утга (000–999) | UI hint + `ebarimtSettingsProblems`-д `^\d{3}$` анхааруулга (хориг биш — хуучин тохиргоо) |
| P2-15 | Мерчант батлах — Ebarimt-Mobile апп «Үйлчилгээ» цэсээр (2025-12-18) | `docs/deployment/ebarimt.md` §2 алхам 3-д нэмэх |
| P2-16 | НӨАТ төлөгч бус байгууллага: Entry огт илгээдэггүй (`initialSaleEbarimtStatus`); `NOT_VAT`-ийн албан утга нь «хилийн гадна борлуулсан» (SDK тайлбар) — «НӨАТ төлөгч бус» биш байж магадгүй | Хуулиар НӨАТ төлөгч бус ч баримт олгох үүрэгтэй эсэхийг ITC-ээс тодруулж (§4.1 (6)), шаардлагатай бол `/rest/info.merchants[].customers[].vatPayer`-ээр шийдэх |

---

## 6. Дараагийн алхам

1. §4.1-ийг Монголоос ажиллуулж үр дүнг энэ баримтын §2–3-д бичих (огноо, PosAPI version)
2. ✅ P0-1/P0-2/P0-3 НЭГ PR-аар (types → receipt → client timeout → тест) — §2.0;
   production деплойн өмнө staging дээр §4.1 (1)(2)(3)(5) + 1 бүтэн + 1 хэсэгчилсэн
   буцаалт + 1 B2B (ХҮЛЭЭГДЭЖ БАЙНА — PosAPI daemon-той Linux орчин хэрэгтэй)
3. P1-1/P1-2 — Монголын egress шийдэл (операторын сервер) + харилцагчийн картын ТТД
4. `docs/pos/03-ebarimt-integration-plan.md` §8-д «2026-09-25 developer портал v3.0.12-тэй
   тулгав» мөр, `02-implementation-status.md`-д P2-5 (ОАТ) хязгаар
