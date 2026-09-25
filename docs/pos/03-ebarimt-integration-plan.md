# eBarimt 3.0 (PosAPI 3.0) нэвтрүүлэлтийн төлөвлөгөө — POS Фаз 3

**Төлөв:** v2 **БАТЛАГДСАН** (2026-09-20) — операторын багц (`Entry integration
other Systems/eBarimt`) уншигдаж §8 хаагдав; Фаз 3.1–3.4 + v2 засварууд кодонд.
Дэлгэрэнгүй хэрэгжилт: `02-implementation-status.md`, нэвтрүүлэлт:
`docs/deployment/ebarimt.md` (операторын загвар). Үлдсэн нээлттэй: §7-ийн T3
(зээлийн борлуулалт INVOICE эсэх), T4 (хотын татвар).
**Суурь:** `00-proposal.md` §3.11 (D8), `02-implementation-status.md` Фаз 3.
**Эх сурвалж (v2):** ГТСМТТ УҮГ «POS API 3.0 хэрэглэгчийн гарын авлага» (2023,
PROD + ST хувилбар), «Хэрэглэгчийн систем нийлүүлэгчийн 3 талт гэрээ», ТЕГ-ийн
тестийн шалгах жагсаалт (`check_list_draft_POS.docx`), НӨАТ-гүй/0% барааны
кодын албан жагсаалт (`Angilal/`), PROD `Links.txt`; өмнө нь developer портал
(`developer.itc.gov.mn/docs/ebarimt-api`) ба нээлттэй SDK-ууд.

---

## 1. eBarimt 3.0 юу вэ — Entry-д хамаарах гол баримт

| Сэдэв | Баримт | Entry-д нөлөө |
|---|---|---|
| Архитектур | **PosAPI 3.0 = ОПЕРАТОРЫН талд төвлөрсөн үйлчилгээ** (Qt, Linux `.deb`, REST, default порт 7080; DB QPSQL/QSQLITE). Албан заавар §1.2: нэг PosAPI **олон мерчант** (олон ТТД)-ын баримт бүртгэнэ. Баримт бүрийг ТЕГ-ийн серверт өөрөө илгээж, ДДТД/сугалаа/QR буцаана; сүлжээгүй үед дотоод санд хадгалаад `sendData`-аар дараа илгээнэ | Entry-г нийлүүлэгч = оператор. Харилцагч бүрийн `pos_settings.ebarimtPosApiUrl` → операторын НЭГ PosAPI; `merchantTin` = харилцагчийнх. Харилцагчийн серверт юу ч суулгахгүй (§3 A′) |
| Бүртгэл | ebarimt.mn мерчант портал → «PosAPI 3.0 хүсэлт» → батлагдмагц **merchantTin (ТТД, 11/14 орон)**, **branchNo (салбар)**, **posNo (кассын дугаар)**, **districtCode (4 оронтой дүүрэг)** олгогдоно; PosAPI суулгац тэдгээрээр идэвхжинэ | `pos_settings`-д eBarimt блок; кассын ээлж бүр ≠ posNo (posNo нь бүртгэлтэй терминал — ээлжээс тусдаа) |
| Баримтын төрөл | `B2C_RECEIPT` (иргэн, `consumerNo` 8 оронтой эсвэл хоосон), `B2B_RECEIPT` (`customerTin` — байгууллага), `B2C_INVOICE` / `B2B_INVOICE` (нэхэмжлэх, дараа төлөгдөх) | POS борлуулалт → RECEIPT; зээлээр (`credit`) төлбөр → INVOICE эсэх — §8 асуулт |
| Татварын төрөл | Дэд баримт (`receipts[]`) бүр нэг `taxType`: `VAT_ABLE` / `VAT_FREE` / `VAT_ZERO` / `NOT_VAT` (НӨАТ төлөгч бус) | Барааны `vatMode` (standard/exempt/zero) + `vat_settings.isVatPayer` → мөрүүдийг taxType-аар БҮЛЭГЛЭНЭ |
| Барааны ангилал | Мөр бүрд **`classificationCode` 7 оронтой** (ТЕГ-ийн бараа/үйлчилгээний ангилал), `VAT_FREE`/`VAT_ZERO`-д **`taxProductCode` 3 оронтой** заавал; `barCode` + `barCodeType` (`UNDEFINED`/`GS1`/`ISBN`…), `measureUnit`, `qty`, `unitPrice` (татвар ОРСОН), `totalVat`, `totalCityTax`, `totalAmount` | `inventory_items`-д 2 шинэ талбар; ангилалгүй бараа eBarimt-д илгээгдэхгүй → UI-д улаан |
| Хотын татвар | `totalCityTax` (НХАТ — зөвхөн тодорхой салбар: зочид буудал, ресторан, бар, согтууруулах ундаа/тамхи) | `pos_settings.cityTaxPercent` (default 0); НХАТ өглөгийн данс роль |
| Төлбөр | `payments[]`: `code` (`CASH`, `PAYMENT_CARD`, … ), `status: PAID`, `paidAmount`, `exchangeCode` (гуравдагч системийн код); Σ = `totalAmount` | 10 `kind` → eBarimt код map (§4.3) |
| Хариу | `id` (**ДДТД**), `lottery` (сугалааны дугаар), `qrData` (баримт дээрх QR), `date` (`yyyy-MM-dd HH:mm:ss`), `status`, `message` | `pos_sales.ebarimtId/ebarimtLottery/ebarimtStatus` + шинэ `ebarimtQrData`, `ebarimtDate` |
| Буцаалт | `DELETE /rest/receipt` `{id, date}` — эх баримтыг ЦУЦАЛНА (өдрийн/сарын хязгаар — §8) | Бүтэн буцаалт → цуцлах; ХЭСЭГЧИЛСЭН буцаалт → эхийг цуцлаад үлдсэн мөрөөр шинэ баримт (§4.5) |
| Илгээлт | Баримт үүсэх бүрд ТЕГ рүү шууд; унасан бол дотоод сан → `GET /rest/sendData`; `GET /rest/info` = үйлчилгээний төлөв (сүүлд илгээсэн, хүлээгдэж буй тоо) | Өдөр бүр `sendData`, самбарт «илгээгдээгүй баримт» тоолуур |
| Нийтийн лавлах | `GET api.ebarimt.mn/api/info/check/getTinInfo?regNo=` (РД → ТТД, нэр), `getBranchInfo` (дүүргийн кодууд), `getInfo?tin=` — нэвтрэлтгүй | B2B баримтад харилцагчийн ТТД автоматаар; тохиргоонд дүүргийн сонголт |

**Хуулийн шаардлага (яагаад Фаз 3 хойшлуулж болохгүй):** НӨАТ төлөгч байгууллага
борлуулалт бүрд цахим баримт олгох үүрэгтэй; v1-д кассчин ТЕГ-ийн апп-аар гараар
олгож ДДТД бичдэг (§3.11) — өдөрт 50+ борлуулалттай дэлгүүрт ажиллахгүй.

---

## 2. Зорилго ба хамрах хүрээ

**Зорилго:** POS борлуулалт батлагдмагц eBarimt баримт **автоматаар** үүсч, баримт дээр
ДДТД + сугалаа + QR хэвлэгдэнэ; буцаалт ТЕГ-д тусгагдана; илгээгдээгүй баримт хэзээ ч
чимээгүй алдагдахгүй.

**Хамрах хүрээ (Фаз 3.0):** POS борлуулалт/буцаалт (`pos_sales`) л. АР нэхэмжлэх
(B2B_INVOICE), АП баримтын НӨАТ-ийн тулгалт (оролтын eBarimt) — **дараагийн фаз**.

**Хамрахгүй:** ТЕГ-ийн нэвтрэлттэй API (`/api/tpi/...` — борлуулалтын нэгтгэл татах),
easy registration (QR-аар иргэн бүртгэх), гадаад иргэний паспорт.

---

## 3. Байршуулалтын топологи — ШИЙДЭГДСЭН (T1 = A′, 2026-09-20)

**A′. Операторын төвлөрсөн PosAPI** — албан заавар §1.2 (нэг PosAPI, олон
мерчант) ба §4 (оператор консолоос мерчант нэмэх → харилцагч e-invoice-д
батлах) энэ загварыг шууд тодорхойлдог. Оператор PosAPI-г НЭГ удаа суулгаж
(одоо PROD-д ажиллаж байна), харилцагч бүр `server` горимоор тэр хаяг руу
илгээнэ. Доорх A/B/C нь v1-ийн харьцуулалт — A′ нь A-гийн «харилцагч бүрд
тусдаа service» хэсгийг ХАСНА (гэрээ 1.9: PosAPI-г бусдад дамжуулахгүй).

*v1-ийн харьцуулалт (түүх):*

| Хувилбар | Хэрхэн | Давуу | Сул | Зөвлөмж |
|---|---|---|---|---|
| **A. Серверт суулгасан PosAPI** — харилцагчийн Railway төсөлд PosAPI 3.0-г тусдаа Docker service (Java) болгон суулгаж, Entry апп дотоод сүлжээгээр `http://posapi.railway.internal:7080` дуудна | ТЕГ-ийн PosAPI-г Linux серверт суулгах (олон ERP ингэж төвлөрүүлдэг); мерчант порталд тэр серверийн IP/нэрээр бүртгэнэ | Cloud архитектурт бүрэн нийцнэ; кассын компьютерт юу ч суулгахгүй; олон касс = олон `posNo` нэг PosAPI; Entry-ийн worker шууд дуудна | PosAPI-ийн Linux багц/лиценз, `data` volume (дотоод сан), Java санах ой (~512MB); ТЕГ нэг ТТД-д нэг PosAPI суулгац зөвшөөрөх эсэх (§8) | **Зөвлөж байна** — Entry-ийн «харилцагч = fork + Railway төсөл» загварт яг таарна |
| B. Кассын компьютерт PosAPI + браузер шууд дуудна | Кассын дэлгэц (browser) `http://localhost:7080/rest/receipt`-ийг өөрөө дуудаад хариуг серверт хадгална | Суулгац энгийн (ТЕГ-ийн стандарт зам) | Browser → localhost (CORS, mixed content — localhost зөвшөөрөгддөг ч PosAPI CORS толгой өгдөг эсэх тодорхойгүй); кассын PC унтарвал дараалал зогсоно; AI/MCP/REST-ээс борлуулалт хийхэд браузер байхгүй | Нөөц хувилбар |
| C. «Entry Bridge» агент — кассын PC дээр жижиг Node/Go үйлчилгээ cloud дарааллыг уншаад PosAPI-д дамжуулна | Агент polling / SSE | Offline-д тэсвэртэй, cloud-оос эх сурвалж хараат бус | Нэмэлт бүтээгдэхүүн (суулгац, шинэчлэлт, дэмжлэг) | Хожим, олон салбартай харилцагчид |

Аль ч хувилбарт код нэг: `lib/ebarimt/client.ts` нь `EBARIMT_POSAPI_URL`-аар л ялгаатай.
A-д worker сервер талд, B-д ижил payload-ыг браузер илгээж `recordEbarimtResult`
action-оор хадгална.

---

### 3.1 Entry Console-ийн үүрэг — БАТЛАГДСАН (2026-09-19)

Мерчантын тохиргоо харилцагчийн апп-д, дэд бүтэц ба хяналт Console-д. **Console
нь борлуулалтын runtime хамаарал БИШ** — Console унтарсан ч касс, eBarimt илгээлт
ажиллана.

| Зүйл | Байрлал | Шалтгаан |
|---|---|---|
| ТТД, салбар, posNo, дүүргийн код, НХАТ %, горим | Харилцагчийн апп `pos_settings` (eBarimt таб) | Харилцагчийн өөрийн мэдээлэл; өгөгдлийн тусгаарлалт хэвээр |
| PosAPI service үүсгэх (Docker image + volume + `EBARIMT_POSAPI_URL`) | **Console** — `provision-customer` урсгалд «eBarimt идэвхжүүлэх» алхам | Console харилцагчийн repo + Railway төслийг үүсгэдэг давхарга |
| Мерчантын бүртгэл (харилцагч × ТТД × PosAPI хувилбар × идэвхтэй эсэх) | **Console** — read-only + провижн төлөв | Fleet-ийн тойм; ТЕГ-ийн PosAPI шинэчлэлтэд хэнийг шинэчлэхийг мэднэ |
| Эрүүл мэнд: PosAPI `/rest/info`, илгээгдээгүй/алдаатай баримтын тоо, сүүлд илгээсэн цаг | **Console** — `entry-console-monitor` cron (5 мин); харилцагчийн `/api/health`-д `ebarimt` блок | Харилцагч мэдэхээс өмнө оператор мэднэ |
| Мерчантын нууц (PosAPI API key, ТЕГ нэвтрэлт) | ЗӨВХӨН харилцагчийн Railway env | Console-д төвлөрүүлбэл нэг цоорхой = бүх харилцагч |

**Хориглох:** Console-ийг олон мерчантын төвлөрсөн PosAPI hub болгох — суулгац
мерчантын ТТД-д бүртгэгддэг, нэг суулгацад олон мерчант дэмжигдэх нь баталгаагүй
(§8), ТЕГ-ийн зөвшөөрлийн асуудал. Харилцагч бүр өөрийн PosAPI-тай (fork загвар).

**`entry-console` repo-д тусдаа PR-ын хамрах хүрээ** (Фаз 3.5, +2 өдөр):

1. Провижн: `provision-customer` dispatch-д `ebarimt: true` сонголт → Railway
   төсөлд `posapi` service (ТЕГ-ийн PosAPI 3.0 image, `data` volume, дотоод
   сүлжээ) + харилцагчийн апп-д `EBARIMT_POSAPI_URL` env
2. Бүртгэл: харилцагчийн картад eBarimt хэсэг — идэвхтэй эсэх, ТТД (апп-ын
   `/api/health`-ээс уншина, Console-д гараар давхар бичихгүй), PosAPI хувилбар,
   провижн огноо
3. Хяналт: monitor cron-д `/api/health.ebarimt` (`{enabled, posApiReachable,
   pending, failed, lastSentAt}`) — `failed > 0` эсвэл `posApiReachable=false`
   30 минутаас удаан бол Console-ийн анхааруулга
4. Харилцагчийн апп талд (энэ repo): `/api/health`-д `ebarimt` блок (лицензийн
   token-оор л уншигдана), PosAPI Docker тодорхойлолт `docs/deployment/ebarimt.md`

## 4. Дизайн

### 4.1 Өгөгдлийн бүтэц (schema)

```
pos_settings (өргөтгөл)      ebarimtEnabled bool default false
                             ebarimtMerchantTin text        — ТТД (11/14 орон)
                             ebarimtBranchNo text           — салбарын дугаар
                             ebarimtDistrictCode text       — 4 оронтой дүүрэг (getBranchInfo-оос сонгоно)
                             ebarimtPosNo text              — default posNo (ээлж/касс тус бүрд override: pos_shifts.ebarimtPosNo?)
                             ebarimtPosApiUrl text          — http://posapi.railway.internal:7080 (A) | http://localhost:7080 (B)
                             ebarimtMode text               — "server" | "browser"
                             cityTaxPercent numeric default 0 + cityTaxAccountNumber (НХАТ өглөгийн роль)
                             ebarimtDefaultClassificationCode text? — ангилалгүй барааны түр default? → ҮГҮЙ (үнэ зохиохгүйтэй ижил: ангилал ЗОХИОХГҮЙ)
inventory_items (өргөтгөл)   ebarimtClassificationCode text (7 орон), ebarimtTaxProductCode text (3 орон, exempt/zero-д заавал)
inventory_categories         ebarimtClassificationCode text? — бүлгийн default, бараанд хоосон бол өвлөнө (ил дүрэм)
pos_sales (өргөтгөл)         ebarimtQrData text, ebarimtDate text, ebarimtType text (B2C_RECEIPT…), ebarimtConsumerNo text, ebarimtCustomerTin text
                             ebarimtStatus: null | pending | sent | failed | cancelled | manual
pos_ebarimt_submissions      id, organizationId, saleId, kind send|cancel, payload jsonb, response jsonb,
                             status pending|sent|failed|cancelled, attempts int, lastError text, nextAttemptAt,
                             sentAt, createdAt — idempotent: (saleId, kind) partial unique index (pending/sent)
counterparties               registerNo (одоо байгаа) → getTinInfo-оор ТТД кэш: ebarimtTin text
```

### 4.2 Payload үүсгэгч — `lib/ebarimt/receipt.ts` (ЦЭВЭР, тесттэй)

`buildEbarimtReceipt(sale: PosSaleDetail, settings, items): EbarimtReceiptRequest`

1. Мөр бүрийн taxType: org НӨАТ төлөгч биш → бүгд `NOT_VAT`; төлөгч бол `vatMode`
   standard→`VAT_ABLE`, exempt→`VAT_FREE`, zero→`VAT_ZERO`.
2. Мөрүүдийг taxType-аар бүлэглэж `receipts[]` дэд баримт болгоно; дэд баримт бүр
   `totalAmount/totalVat/totalCityTax` = Σ мөр.
3. Мөр: `unitPrice` = хөнгөлөлтийн ДАРААХ нэгж үнэ (татвар орсон), `totalAmount` =
   `lineTotal`, `totalVat` = `vatAmount` — POS-ийн `computeSaleTotals`-той ЯГ ижил
   бөөрөнхийлөл (largest-line absorb); Σ мөр = баримтын `total` (бөөрөнхийллийн
   `roundingAmount` → тусдаа мөр биш, ТЕГ-ийн дүрмээр §8).
4. `payments[]`: §4.3 map; Σ paidAmount = totalAmount (хариулт ХАСАГДСАН).
5. `type`: customerTin байвал `B2B_RECEIPT`, үгүй бол `B2C_RECEIPT` (+ consumerNo сонголтоор).
6. Шалгалт → `[EBARIMT_UNMAPPED_ITEM]` (ангилалгүй бараа), `[EBARIMT_TAX_PRODUCT_CODE]`
   (exempt/zero-д код хоосон), `[EBARIMT_TOTAL_MISMATCH]` — payload үүсэхгүй, борлуулалт
   ЗОГСОХГҮЙ (status failed, шалтгаан ил).

### 4.3 Төлбөрийн код map (`lib/ebarimt/constants.ts`)

| POS kind | eBarimt `code` | Тайлбар |
|---|---|---|
| cash, cash_fx | `CASH` | валют → MNT `baseAmount` |
| card | `PAYMENT_CARD` | `exchangeCode` = терминалын лавлагаа |
| ewallet, transfer, bnpl | ТЕГ-ийн жагсаалтаас (§8 — `QPAY`/`SOCIALPAY`/`BANK_TRANSFER` мэт код байгаа эсэх) | олдохгүй бол `PAYMENT_CARD`? → ҮГҮЙ, шийдвэр §8 |
| credit | `INVOICE` (хэрэглэгчийн шийдвэр 2026-09-25); баримт `B2C/B2B_INVOICE`, статус `PAY` | T3 — `receiptTypeOf` |
| advance, gift_card, store_credit | урьдчилж төлөгдсөн → `CASH`? | §8 (гуравдагч талаас баталгаажуулна) |

### 4.4 Илгээлтийн урсгал (async, борлуулалт зогсохгүй)

```
createPosSale (транзакц) ──commit──▶ enqueue pos_ebarimt_submissions(kind=send, pending)
                                            │
   worker (A: server cron /api/ebarimt/worker, 15с; B: браузер) ──▶ POST {posApiUrl}/rest/receipt
                                            │
            ┌── SUCCESS: pos_sales.ebarimt* ← id/lottery/qrData/date; status sent; баримт дахин хэвлэгдэнэ (QR)
            └── ERROR:   attempts+1, backoff (15с → 1мин → 5мин → 30мин, max 20), lastError; 3 удаа дараалан
                         унавал мэдэгдэл (`pos.ebarimt_failed`, lib/notifications/rules.ts)
returnPosSale ──▶ enqueue kind=cancel {id: эх ДДТД, date} ──▶ DELETE /rest/receipt
   хэсэгчилсэн буцаалт: cancel + шинэ send (үлдсэн мөр) — нэг submission-д хоёр алхам, дараалалтай
Өдөр бүр 23:30 УБ: GET /rest/sendData + GET /rest/info → `pending` тоо самбарт
```

- Идемпотент: нэг борлуулалт нэг л `send`; давхар илгээхийг partial unique index хориглоно;
  PosAPI-ийн хариуд ДДТД ирсэн бол дараагийн оролдлого ҮГҮЙ.
- ДДТД **`ar_ap_documents.externalRef`**-д хуулбарлагдана (idempotency + АР жагсаалтад хайлт).
- Кассчин гараар ДДТД бичсэн (`manual`) бол автомат илгээлт ҮГҮЙ — давхар баримт үүсгэхгүй.

### 4.5 UI

- **Кассын дэлгэц:** төлбөрийн диалогт «Худалдан авагч: иргэн (eBarimt дугаар/утас) | байгууллага (РД → `getTinInfo` → нэр, ТТД)»; B2B сонговол харилцагч бүртгэлээс авна.
- **Баримт (80мм):** ДДТД, сугалааны дугаар, **QR (`qrData`)** — `qrcode` библиотек (client, ~10KB); илгээгдээгүй бол «eBarimt: илгээж байна…» гэж хэвлээд дахин хэвлэх боломж.
- **Борлуулалтын жагсаалт:** eBarimt багана → `StatusBadge` (sent/pending/failed/manual/cancelled); `FilterChips`-д «eBarimt алдаатай»; панельд [Дахин илгээх], алдааны текст, ТЕГ-ийн хариу.
- **Тохиргоо → eBarimt дэд таб:** ТТД/салбар/posNo/дүүрэг (getBranchInfo dropdown)/PosAPI URL/горим; [Холболт шалгах] (`GET /rest/info`); хотын татвар %.
- **Бараа:** карт + Excel импорт/экспортод `Ангилал (eBarimt)`, `Татварын бүтээгдэхүүний код`; жагсаалтад «ангилалгүй» шүүлт; бүлгээс өвлөх.
- **Самбар (Бараа материал):** «eBarimt хүлээгдэж буй / алдаатай» карт; сар хаалтын checklist-д POS алхамд «илгээгдээгүй eBarimt» анхааруулга (хориг БИШ — ТЕГ-ийн хугацаа §8).

### 4.6 AI / MCP / REST tools

`get_ebarimt_status` (тохиргоо, PosAPI info, pending/failed тоо), `resend_ebarimt(sale)`,
`lookup_tin(regNo)`; `create_pos_sale`-д `customerRegNo` / `consumerNo` параметр.
Бүгд `lib/ai/tools.ts` нэг давхарга (§9a).

### 4.7 Файлууд

```
lib/ebarimt/
├── constants.ts    төрөл/taxType/paymentCode/status литералууд — ЦОРЫН ГАНЦ эх
├── types.ts        EbarimtReceiptRequest/Response (PosAPI 3.0 JSON яг)
├── receipt.ts      buildEbarimtReceipt — ЦЭВЭР (тесттэй): бүлэглэл, бөөрөнхийлөл, map, шалгалт
├── client.ts       PosAPI HTTP: putReceipt / deleteReceipt / info / sendData (fetch, timeout 10с, DB import ҮГҮЙ)
├── lookup.ts       getTinInfo / getBranchInfo (нийтийн API, кэш 24ц)
└── queue.ts        enqueue / claim / markSent / markFailed (DB давхарга, "use server" БИШ)
lib/actions/ebarimt.ts       Server Actions: тохиргоо, холболт шалгах, дахин илгээх, browser горимд recordEbarimtResult
app/api/ebarimt/worker/route.ts   cron (Railway cron эсвэл Vercel-маягийн secret header) — A горим
components/pos/ebarimt-settings.tsx, receipt-preview.tsx (QR), sales-list-view.tsx (багана)
tests/ebarimt-receipt.test.ts     бүлэглэл, VAT/NOT_VAT, хэсэгчилсэн буцаалт, Σ таарах, ангилалгүй бараа
```

---

## 5. Фазын хуваарь

| Фаз | Ажил | Гаралт | Өдөр |
|---|---|---|---|
| **3.0 Бэлтгэл** | Мерчант багцаас ТТД/салбар/posNo/дүүрэг, PosAPI суулгац (staging `stg-invoice`/тест ТТД), Linux серверт ажиллах эсэх туршилт (Docker + Java), ТЕГ-ийн албан docs-той §8 асуултуудыг хаах | Шийдвэр T1–T6, `docs/pos/03` v2 (БАТЛАГДСАН) | 2 |
| **3.1 Master data** | schema (§4.1), барааны карт/импорт/экспорт/AI tool-д ангилал+татварын код, тохиргооны eBarimt таб + холболт шалгах, `getBranchInfo`/`getTinInfo` lookup | `/inventory/sales?tab=settings` eBarimt дэд таб ногоон | 2 |
| **3.2 Payload** | `lib/ebarimt/receipt.ts` + тест (НӨАТ төлөгч/бус, exempt/zero, хөнгөлөлт, бөөрөнхийлөл, B2B, хэсэгчилсэн буцаалт), payment map | 371+ тест ногоон | 2 |
| **3.3 Дараалал + worker** | `pos_ebarimt_submissions`, createPosSale/returnPosSale enqueue, worker (backoff, идемпотент), sendData cron, мэдэгдлийн дүрэм, `externalRef` sync | Staging-д бодит ДДТД буцаж ирнэ | 3 |
| **3.4 UI** | Баримт QR/сугалаа, жагсаалт/панель статус + дахин илгээх, checkout-д худалдан авагч (иргэн/байгууллага), самбарын карт, checklist | Кассчин ямар ч нэмэлт алхамгүй | 2 |
| ✅ 3.1–3.4 | Schema, `lib/ebarimt/*` (payload ЦЭВЭР+тесттэй, PosAPI клиент, лавлах, дараалал, worker), actions, ticker/cron, health, AI tools, UI (тохиргоо/QR/статус/дахин илгээх/ангилалын код) | Кассчин нэмэлт алхамгүй | ✅ |
| **3.5 Deploy (A) + Console** | PosAPI Docker service (Railway) + volume, `EBARIMT_POSAPI_URL`, `/api/health.ebarimt`, `docs/deployment/ebarimt.md`, мерчант порталд бүртгэх алхам; **entry-console**: провижн алхам, мерчантын бүртгэл, monitor (§3.1) | Харилцагчийн Railway төсөлд Console-оос нэг товчоор; fleet-ийн eBarimt тойм | 3–4 |
| **3.6 Хяналт** | Сарын тулгалт: `pos_sales` (sent) vs PosAPI `info`/ТЕГ портал; «илгээгдээгүй» тайлан; AI tools | Сар хаалтын checklist мөр | 1 |
| | | **Нийт** | **15–16** |

Дараагийн фаз (тусдаа санал): АР нэхэмжлэх → `B2B_INVOICE`; АП баримтын оролтын
eBarimt тулгалт (ТЕГ-ийн нэвтрэлттэй API); easy registration QR.

---

## 6. Эрсдэл

| # | Эрсдэл | Бууруулалт |
|---|---|---|
| R1 | PosAPI Linux/серверт ажиллахгүй эсвэл ТЕГ зөвшөөрөхгүй | Фаз 3.0-д туршина; ажиллахгүй бол B (браузер) горимд шилжинэ — код ижил (§3) |
| R2 | Барааны ангилалын код (7 орон) бөглөх ажил их | Бүлгээс өвлөх + Excel импорт + «ангилалгүй» шүүлт; ТЕГ-ийн ангилалын жагсаалтыг лавлах болгон татах (`lib/constants/ebarimt-classifications.ts`?) — §8 |
| R3 | Бөөрөнхийллийн зөрүү (Σ мөр ≠ total) → ТЕГ татгалзана | Payload тест бүрд Σ шалгалт; `roundingAmount`-ийг ТЕГ-ийн дүрмээр (§8) |
| R4 | Хэсэгчилсэн буцаалтын дүрэм (цуцлах + шинэ баримт) хугацааны хязгаартай | Буцаалтын диалогт eBarimt үр дагаврыг ил харуулна; хугацаа хэтэрсэн бол `manual` + анхааруулга |
| R5 | PosAPI унтарсан үед баримт хэвлэгдэхгүй гэж кассчин зогсох | Борлуулалт зогсохгүй (async), баримт «илгээж байна» гэж хэвлэгдэнэ, дахин хэвлэх |

---

## 7. Батлуулах шийдвэрүүд (T)

| # | Асуулт | Санал |
|---|---|---|
| **T1** | Байршуулалтын топологи | **A** (серверт PosAPI, Railway service) — Фаз 3.0-ийн туршилтаар баталгаажуулна |
| **T1a** | Console-ийн үүрэг | **БАТЛАГДСАН** — §3.1: тохиргоо апп-д, провижн/бүртгэл/хяналт Console-д, runtime хамаарал биш, төвлөрсөн PosAPI hub ҮГҮЙ |
| **T2** | Ангилалгүй бараа борлуулж болох уу | Болно (борлуулалт зогсохгүй), eBarimt `failed` + улаан; хэрэглэгч ангилал бөглөөд дахин илгээнэ |
| **T3** | `credit` (зээлээр) төлбөртэй борлуулалт | RECEIPT биш `B2C/B2B_INVOICE` илгээх; төлөгдөхөд ТЕГ-ийн invoice→receipt урсгал (§8-д баталгаажуулна) |
| **T4** | Хотын татвар (НХАТ) | Тохиргооны % (default 0) + өглөгийн данс роль; POS тооцоололд НӨАТ-тай зэрэгцээ мөр |
| **T5** | Гараар ДДТД (v1 `manual`) хэвээр үлдэх үү | Үлдэнэ (PosAPI унасан үеийн fallback), автомат илгээлтээс хасагдана |
| **T6** | eBarimt-ийг `custom/`-д биш core-д | Core (бүх монгол харилцагчид хэрэгтэй), `pos_settings.ebarimtEnabled`-аар унтраана |

---

## 8. Мерчант багцаас тулгасан — ХААГДСАН (2026-09-20)

Багц (`Entry integration other Systems/eBarimt`) бүрэн уншигдав. Нууц түлхүүр /
нууц үг ХУУЛААГҮЙ (Credential.txt, 5bae2f22.txt хөндөөгүй).

| Асуулт | Хариулт | Эх | Кодонд |
|---|---|---|---|
| PosAPI суулгац | Linux `.deb` (Qt), Windows; `posapi.ini`: db QPSQL/QMYSQL/QODBC/QSQLITE, workDir, порт 7080; идэвхжүүлэлт оператор эрхээр PosAPI web-ээс | Гарын авлага §2–3, PROD/Package | `docs/deployment/ebarimt.md` §4 |
| Нэг суулгац олон ТТД | **ТИЙМ** — §1.2 | Гарын авлага | Топологи A′ |
| Мерчант нэвтрүүлэх | operator.ebarimt.mn → posNo-гоор PosAPI → «Мерчант нэмэх» (ТТД) → харилцагч e-invoice.ebarimt.mn-д батална | §4, Links.txt | `ebarimt.md` §2; статус «Мерчант бүртгэл» |
| ТТД, салбар, posNo, дүүрэг | Харилцагчийнх; `posNo` = дотоод кассын дугаар (PosAPI-ийн 8 оронтой posNo-той өөр) | §5 | `pos_settings` хэвээр |
| `POST /rest/receipt` талбарууд | Спекийн JSON: + `inactiveId`, `reportMonth`, `totalBonus`, `data{}`; `type` 4 утга; `taxType` VAT_ABLE/FREE/ZERO; `barCodeType` UNDEFINED/GS1/ISBN | §5 | `inactiveId` нэмэгдэв; бусад сонголтоор |
| Төлбөрийн код | Гарын авлагад CASH, PAYMENT_CARD, BONUS_CARD_TEST; ewallet/transfer/BNPL-ийн код developer порталаас — staging дээр тулгана | §5 | `EBARIMT_PAYMENT_CODE_SUGGESTIONS` хэвээр |
| Хариуны алдаа | `status`/`message`; `httpStatus` DELETE-д | §5–6 | хэвээр |
| Цуцлах / хэсэгчилсэн | Бүтэн → DELETE (§6); хэсэгчилсэн → `inactiveId` гинж, **сугалаа дахин олгохгүй** (§5) | Гарын авлага | **ЗАСАГДАВ** (v1 DELETE+шинэ байсан) |
| Сугалаа / QR хадгалалт | **ХОРИОТОЙ** (§5; checklist «QR код хадгалахгүй») | Гарын авлага, checklist | **ЗАСАГДАВ** — `pos_sales`-аас хасагдав, response стрип |
| Бөөрөнхийлөл | Дүн бүр татвар шингэсэн; `totalAmount = үнэ + НӨАТ + НХАТ (+ бонус)` | §5 | хэвээр (largest-line absorb) |
| Ангилалын код (7 орон) | ҮСХ «Бүтээгдэхүүн, үйлчилгээний нэгдсэн ангилал» 4-р багана (`Angilal/*.pdf`, GS1 xlsx) | §5, Angilal | ✅ 3499 код `lib/ebarimt/classification-codes.json` (PDF х.4–91, `scripts/extract-buna-pdf.py`); барааны карт + ангиллын диалогт хайлттай сонгогч |
| Татварын код (3 орон) | Албан жагсаалт: чөлөөлөгдөх 46 (305–446), 0% 7 (501–507) | Angilal/*.xlsx | `lib/ebarimt/tax-product-codes.ts` + сонгогч |
| Staging | `st-operator.ebarimt.mn`, `stg-invoice.ebarimt.mn`; тест эрх ГТСМТТ-ээс и-мэйлээр | ST гарын авлага, Линкүүд.docx | `ebarimt.md` §4 |
| Илгээх хугацаа | **72 цаг** (гэрээ 3.6), checklist «3 өдөр» | Гэрээ | `EBARIMT_SEND_STALE_HOURS`=48 анхааруулга, 72 улаан |
| Сугалаа дуусах анхааруулга | Checklist заавал — `/rest/info` `leftLotteries` | Checklist, §6 | `pos.ebarimt_lottery_low` |
| Хотын татвар | НХАТ тусдаа (`totalCityTax`) — манай салбарт (дэлгүүр) хамаарахгүй; T4 хойшилсон | §5 | 0 хэвээр |
| Оператор ↔ ТЕГ гэрээ | Chipmo POS 2024-01 тэнцсэн; хэрэглэгчийн системд өөрчлөлт оруулбал УҮГ/ТЕГ-д мэдэгдэх (4.6.2) | Гэрээ | Эзэн: тестийн бэлтгэл шаардлагагүй гэж шийдэв (2026-09-20) |

Энэ баримт **v2 (БАТЛАГДСАН)**; функцийн гэрээ `01-implementation-contract.md` §9-д.
