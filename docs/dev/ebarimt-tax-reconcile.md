# ТЕГ ↔ Entry нэхэмжлэхийн үлдэгдлийн тулгалт (eBarimt TPI)

`CLAUDE.md` §5c-ийн eBarimt хэсгийн дэлгэрэнгүй. Шийдвэр (product owner, 2026-10-01):
ТЕГ-ийн порталын «Үлдэгдэл»-ийг Entry-тэй **автоматаар** тулгана — порталаас Excel
татах гар ажиллагааг ашиглахгүй. Холбоотой: `docs/pos/05-ebarimt-invoice-plan.md`
(нэхэмжлэх + төлөлтийн баримт), `docs/integrations/00-itc-developer-portal.md` §2–§4
(нэвтрэлт, TPI, гео-хязгаар).

## 1. Яагаад

Entry нэхэмжлэх (`*_INVOICE`) ба төлөлт бүрийг `invoiceId`-тай `*_RECEIPT` болгож PosAPI-д
илгээдэг, гэхдээ «PosAPI SUCCESS хариулсан»-аас өөрийг мэддэггүй. ТЕГ-ийн e-invoice
порталд нэхэмжлэх бүр «Үлдэгдэл / НӨАТ / Нийт дүн» баганатай, мөн **«+» товчоор гараар
төлөлт нэмж болдог** — Entry ч илгээвэл ТЕГ-д төлөлт ДАВХАР бүртгэгдэнэ. Тулгалт
ийм зөрүүг, ТЕГ-д хүрээгүй баримтыг, Entry-д мэдэгдээгүй төлөлтийг илрүүлнэ.

## 2. Урсгал

```
Тохиргоо (админ): POS тохиргоо → eBarimt → «ТЕГ-ийн тулгалт (TPI)»
  орчин, ITC нэвтрэх нэр, нууц үг → ebarimt_tpi_connections (шифртэй); X-API-KEY = серверийн env
      │
ticker (10 мин тутам шалгана) → isTaxSyncDue → syncEbarimtTaxReceipts
  Keycloak password grant (vatps) → өдөр бүрд:
    getSalesTotalData status 3 (нэхэмжлэх)      → ebarimt_tax_receipts (isInvoice)
    getSalesTotalData status 0 (БҮХ баримт)     → ebarimt_tax_receipts (2026-10-02-оос бүгд; parentDdtd, posNo)
  syncedThrough урагшилна → тулгалтын тойм → lastCheckSummary
      │
loadEbarimtTaxChecks (амьд): Entry-ийн ТЕГ-д нэхэмжлэх болж бүртгэгдсэн авлага
  (АР: ar_ap_documents.ebarimtId · POS «Зээлээр»: pos_sales.ebarimtId → АР баримт)
  × ТЕГ-ийн нэхэмжлэх − Σ хүүхэд баримт × Entry-ийн илгээсэн төлөлтийн баримт
      │
«Анхаарах» (lastCheckSummary) · Авлага → eBarimt → «ТЕГ-ийн тулгалт» · АР панель · MCP
```

- **Хуваарь** (`isTaxSyncDue`, ЦЭВЭР): анх → шууд; нөхөлт дуусаагүй → 10 мин тутам
  (нэг удаад ≤ 31 өдөр); алдаатай → 1 цаг хүлээнэ; гүйцсэн бол өдөрт нэг. **Бодит орчинд
  ЗӨВХӨН 01:00–07:00 УБ** (албан хуудас: сервисийг зөвхөн шөнийн цагт дуудна; туршилтын
  орчинд хязгааргүй) — цонх хаагдвал явцаа хадгалаад зогсоно, гар «Одоо татах» цонхны
  гадна ил тайлбартай татгалзана, «Холболт шалгах» зөвхөн нэвтрэлтийг шалгана
  (PosAPI-ийн 23:30 `sendData`-ийн дараа). Сүүлийн 3 өдрийг үргэлж дахин татна —
  PosAPI ТЕГ рүү 72 цаг хүртэл хоцорч түлхдэг.
- **Анхны татлагын эхлэл** = Entry-ийн ТЕГ-д илгээсэн хамгийн эртний нэхэмжлэх
  (≤ 400 хоног), байхгүй бол сүүлийн 3 өдөр. Нэвтрэх нэр/орчин солигдвол явц ЭХНЭЭС.
- **Хуудаслалт** (`tpiPageWindow`): `startCount`/`endCount`-ийн утга албан тайлбарт
  тодорхойгүй тул дараагийн хуудас өмнөхийн `endCount`-оос — аль ч тайлбарт мөр
  алгасахгүй, ≤1 давхцал (ДДТД-ээр upsert). Өдөр × status-д ≤ 400 хуудас, хэтэрвэл ил алдаа.
- Танигдахгүй мөр (ДДТД/дүнгүй) алгасаж ТООЛНО → `lastSyncSkipped`, тохиргоонд ил.

## 3. Тулгалтын ангилал (`checkTaxInvoice`, ЦЭВЭР — `tests/ebarimt-tax-reconcile.test.ts`)

Дараалал чухал — ТЕГ-ийн бүртгэлийн эрсдэл Entry талын дутуугаас түрүүлнэ. Тэвчээр 1₮.

| Ангилал | Нөхцөл | Өнгө |
|---|---|---|
| `pending` | ТЕГ-д алга ч Entry сүүлийн 72 цагт илгээсэн | muted |
| `not_synced` | Нэхэмжлэх татсан хугацаанаас өмнө / хэзээ ч татаагүй | muted |
| `tax_missing_invoice` | Нэхэмжлэх 72 цагаас хойш ТЕГ-д алга | danger |
| `total_mismatch` | ТЕГ-ийн нэхэмжлэх ≠ Entry-ийн бүртгэсэн дүн (`ebarimtTotal`), эсвэл төлөлт тулсан ч үлдэгдэл зөрсөн | danger |
| `tax_extra` | ТЕГ-ийн төлөлт > Entry-ийн илгээсэн — **порталд гараар нэмсэн / давхар** | danger |
| `tax_missing_payment` | ТЕГ-ийн төлөлт < Entry-ийн илгээсэн, 72 цагаас хойш | danger |
| `entry_reversed` | Entry-ийн илгээсэн > Entry-ийн авлагын төлөлт (касс буцаасан) | danger |
| `entry_unreported` | Entry-ийн авлагын төлөлт > илгээсэн (алдаатай баримт, кассгүй хаалт, 2026-10-01-ээс өмнөх POS-ийн зээл) | warning |
| `ok` | Бүгд тулсан | success |

«Анхаарах»-д `ok`/`pending`/`not_synced`-ээс бусад нь тоологдоно; danger нь тусад нь.

**ДДТД-ийн гинж:** POS «Зээлээр»-ийн хэсэгчилсэн буцаалт бүр шинэ ДДТД-тэй засвар
(`inactiveId`) илгээдэг. Засварын өмнөх төлөлтийн баримт хуучин ДДТД-д (`prParentRno`)
бүртгэлтэй тул ТЕГ-ийн төлөлтийг борлуулалтын бүх амжилттай илгээлтийн ДДТД-ээр
нийлүүлнэ (`previousDdtds`; баримт бүр нэг эх-тэй — давхар тоологдохгүй).
**Мэдэгдэж буй жинхэнэ зөрүү:** зээлийн борлуулалтын төлөгдсөн хэсгийг БЭЛНЭЭР буцаахад
ТЕГ-д өмнө явсан төлбөрийн баримт буцаагдахгүй — `total_mismatch` гарч, ТЕГ-ийн
порталаас засна (Entry автоматаар засахгүй).
Entry-ийн «илгээсэн төлөлт» = `sent` төлөвтэй `payment` submission-уудын
`payload.request.totalAmount` — ЗӨВХӨН ангилалд (ТЕГ-ийн бүртгэлтэй дүнгийн эх нь TPI).

## 4. Хатуу дүрэм

- **ЗӨВХӨН унших** — ТЕГ-д юу ч бичихгүй, тулгалт дүн ЗОХИОХГҮЙ, автоматаар засахгүй
  (зөрүүг хэрэглэгч ТЕГ-ийн портал / «Дахин илгээх»-ээр шийднэ).
- Нууц үг `encryptSecret`-ээр; утга нь client, лог, аудит, алдаа, тестэд ХЭЗЭЭ Ч
  гарахгүй; талбар write-only (хоосон = хуучнаа хадгална).
- **X-API-KEY = Entry-ийн ОПЕРАТОРЫН түлхүүр** (product owner 2026-10-02: «манайд
  operator эрх байгаа») — серверийн env `ITC_TPI_API_KEY`; харилцагчийн UI-д талбар
  БАЙХГҮЙ, харуулахгүй. Хуучин байгууллагын түлхүүр (`apiKeyEnc`) зөвхөн серверийн
  түлхүүр тохируулаагүй үед нөөц (`sessionOf`). Info сервисийн key мөн серверийн env
  (`EBARIMT_INFO_API_KEY`, docs/deployment/ebarimt.md).
- Хост ЗӨВХӨН `lib/itc/constants.ts` (staging/production) эсвэл env `ITC_TPI_BASE` /
  `ITC_AUTH_BASE` (Монголд байрлах прокси — api.ebarimt.mn, auth.itc.gov.mn зөвхөн
  Монголын IP); хэрэглэгч URL оруулахгүй.
- Хуваарьт татлага ХЭЗЭЭ Ч шидэхгүй, request scope ашиглахгүй; багцад eBarimt
  боломжгүй бол алгасна. Тохиргоо хадгалах/шалгах/устгах admin+, гар татлага `ar:write`,
  унших `ar:read`; хадгалах/устгах/гар татлага бүр `logAuditEvent` (`ebarimt_tpi_connection`).
- **БҮХ борлуулалтын баримт хадгалагдана** (2026-10-02, product owner): нэхэмжлэх, төлөлт,
  ААН, иргэний баримт — §8. Нэхэмжлэхийн тулгалт (§3) хэвээр нэхэмжлэх + хүүхэд баримтаар.

## 5. Файлууд

```
lib/itc/tpi.ts                 tpiPageWindow / tpiHasMorePages (ЦЭВЭР) + parseSalesTotalData (prParentRno)
lib/ebarimt/tax-reconcile.ts   ЦЭВЭР: buildTaxLedger, checkTaxInvoice, ангилал/тайлбар, isTaxSyncDue,
                               taxSyncDays, view төрлүүд (client-safe)
lib/ebarimt/tax-sync.ts        DB: холболт, sessionOf (нууц тайлах, token сунгах), syncEbarimtTaxReceipts,
                               testTpiConnection, loadEbarimtTaxChecks, runDueEbarimtTaxSyncs
lib/ebarimt/ticker.ts          10 мин тутам maybeRunTaxSync (тикийг блоклохгүй, давхар эхлэхгүй)
lib/actions/ebarimt-tpi.ts     get/save/test/sync/delete + getEbarimtTaxChecks (ActionResult)
components/pos/ebarimt-tpi-settings.tsx        тохиргоо (POS тохиргоо → eBarimt)
components/ebarimt/ebarimt-tax-check-view.tsx  Авлага → eBarimt → «ТЕГ-ийн тулгалт» (?view=tax)
components/arap/arap-ebarimt-field.tsx         панельд ТЕГ-ийн үлдэгдэл + шалтгаан
lib/notifications/attention.ts  ebarimt-tax-mismatch, ebarimt-tax-sync-failed (48 цаг)
lib/ai/tools.ts                 get_ebarimt_tax_reconciliation (унших)
```

## 6. Албан хуудастай тулгалт ба staging-д үлдсэн зүйл

**2026-10-02 — developer.itc.gov.mn-ийн албан хуудас (Монголын IP-ээс)** «Борлуулалтын
задаргааны мэдээлэл татах сервис» (`POST /api/tpi/receipt/getSalesTotalData`):

- Хүсэлт: `year`, `month` (заавал), `day` — **string**; `status`, `startCount`, `endCount` —
  number (заавал) → `salesTotalDataBody` засагдсан
- Хариу: `data.content[]` (схемд `data.list`) + `data.pageModel.totalElements`; НХАТ нь
  **`citytax`** (жижиг үсэг); `posSid`, `operatorName`, `fromType` нэмэлт → parser засагдсан,
  хуудаслалт `totalElements`-ээр
- **Цагийн хязгаар: бодит орчинд зөвхөн 01:00–07:00** (туршилтын орчинд хязгааргүй) → хуваарь
- **Хамрах хүрээ:** «их хэмжээний борлуулалтын баримт илгээдэг, том сегментэд харьяалагддаг
  татвар төлөгч» — X-API-KEY-г ТЕГ-ийн Татвар төлөгчид үйлчлэх газарт албан тоотоор авна.
  Жижиг харилцагчид олгох эсэхийг ТЕГ-ээс тодруулна
- Жишээ хариунд ДДТД, регистр ДАЛДЛАГДСАН («0000054355*******…») — өөрийн байгууллагын
  бодит хариунд бүтэн ДДТД ирэх эсэхийг staging-д шалгана (тулгалт ДДТД-ээр)

Staging-д үлдсэн (Монголын IP, `АА10010110` + staging X-API-KEY):

1. `month`/`day`-ийн тэргүүлэх тэг («9» vs «09») — албан жишээгүй
2. `startCount`/`endCount`-ийн утга (0/1-ээс, төгсгөл орох эсэх) — `totalElements`-тэй тул
   мөр алгасахгүй, ≤1 давхцал
3. Token-ий хамрах хүрээ (body-д ТТД байхгүй) — олон байгууллагад эрхтэй хэрэглэгч
4. `prParentRno` нь `invoiceId`-тай баримт бүрд ирж буй эсэх; засварын дараах ДДТД
5. Бодит хариунд ДДТД бүтэн ирэх эсэх (жишээнд далдлагдсан)
6. Порталын «Үлдэгдэл» = нэхэмжлэх − Σ төлбөрийн баримт гэдгийг нэг нэхэмжлэх дээр тулгах

## 7. Худалдан авалтын eBarimt ↔ өглөг (TPI `getSaleListERP`)

Албан хуудаст худалдан авалтын ЦОРЫН ГАНЦ сервис — «Толгой татвар төлөгч өөрийн охин
компанийн худалдан авалт татах сервис» (`POST /api/tpi/receipt/getSaleListERP`; тусдаа «buy»
зам байхгүй, хариу нь `receiptBuyModelList`). `subPin` хоосон бол `pin`-ий (байгууллагын
РЕГИСТР — Компанийн мэдээлэл) ӨӨРИЙН худалдан авалт ирнэ. **Борлуулагчийн нэр/регистр
ДАЛДЛАГДСАН** («ГУР*****МБА», «57***85») тул тааруулалт ЗӨВХӨН ДДТД-ээр.

```
ticker (борлуулалтын татлагын дараа, ижил хуваарь) → runDueEbarimtPurchaseSyncs
  → syncEbarimtTaxPurchases: pin = registerNo, 31 хоногийн муж (≤4/удаа), сүүлийн 3 өдрийг
    давтана, анхдагч эхлэл 2 сарын өмнөх сарын 1 → ebarimt_tax_purchases (ДДТД-ээр upsert)
loadEbarimtPurchaseChecks: ТЕГ-ийн баримт × өглөг (ap_bill, батлагдсан, буцаагдаагүй;
  НӨАТ = оролтын НӨАТ-ын дансны мөрүүд, mainAccountOfCode) — ar_ap_documents.supplierEbarimtId
```

| Ангилал | Нөхцөл | Өнгө |
|---|---|---|
| `ok` | ДДТД холбогдсон, дүн/НӨАТ тэнцүү (±1₮) | success |
| `amount_mismatch` | Холбосон өглөгийн дүн/НӨАТ ≠ ТЕГ | danger |
| `entry_missing` | ТЕГ-ийн баримт өглөгт холбогдоогүй — ижил дүн ±7 хоногийн ДДТД-гүй өглөгийг САНАЛ | warning |
| `tax_missing` | Өглөгт бичсэн ДДТД ТЕГ-ийн жагсаалтад алга (3 хоногоос хуучин) | danger |
| `no_receipt` | НӨАТ-тай өглөгт ДДТД холбогдоогүй (eBarimt-гүй авсан НӨАТ хасагдахгүй) | warning |
| `pending` / `not_synced` | Сүүлийн 3 хоног / татаагүй хугацаа | muted |

- **Холбох нь хэрэглэгчийн үйлдэл** — `linkApEbarimtReceipt` (ap:write, аудит
  `arap`/`ebarimt_link`): Өглөг → eBarimt-ийн «Холбох» (санал), өглөгийн панелийн
  «Нийлүүлэгчийн eBarimt», MCP `link_ap_ebarimt_receipt`. Байгаа холбоосыг автоматаар
  үүсгэхгүй. Байгууллагад нэг ДДТД нэг л өглөгт (`ar_ap_documents_org_supplier_ebarimt_ux`).
  Журнал хөндөхгүй (мета) тул хаагдсан үед ч болно.
- Борлуулалтын тулгалтаас ТУСДАА явц/алдаа (`purchasesSyncedThrough`, `lastPurchaseSync*`) —
  сервис «толгой татвар төлөгч»-д зориулсан тул эрхгүй байж болно; нэгний алдаа нөгөөг
  зогсоохгүй. «Анхаарах»: `arap.ebarimt_purchase_mismatch` (ap:write гишүүдэд).
- MCP: `get_ebarimt_purchase_reconciliation` (унших), `link_ap_ebarimt_receipt`.
- Staging-д шалгах: `startDate`/`endDate`-ийн хэлбэр («YYYY-MM-DD HH:mm:ss» гэж илгээнэ —
  албан жишээ хариунд л), хуудаслалт байхгүй тул нэг мужид ирэх дээд хэмжээ, энгийн
  (толгой биш) байгууллагад эрх олгогдох эсэх, `buyerRegNo` далдлагдах эсэх.

Файлууд: `lib/ebarimt/purchase-reconcile.ts` (ЦЭВЭР, `tests/ebarimt-purchase-reconcile.test.ts`),
`lib/ebarimt/purchase-sync.ts`, `components/ebarimt/ebarimt-purchase-check-view.tsx`
(`/payables/ebarimt`), `components/arap/ap-ebarimt-receipt-field.tsx` (панель).

## 8. ТЕГ-ийн БҮХ борлуулалтын баримт (2026-10-02)

Шийдвэр (product owner): борлуулалтын бүх баримтыг татна. `getSalesTotalData` status 0-ийн
мөр бүр `ebarimt_tax_receipts`-д (ДДТД-ээр upsert, `posNo`, `districtCode`); нэхэмжлэх (status 3)
түрүүлж хадгалагдана (`isInvoice` алдагдахгүй).

- **Төрөл** `taxReceiptKindOf` (ЦЭВЭР, `lib/ebarimt/tax-sales.ts`): нэхэмжлэх > нэхэмжлэхийн
  төлөлт (`prParentRno`) > ААН (худалдан авагчийн регистртэй — далдлагдсан ч) > иргэн
- **Entry-тэй тулгалт** (`loadEbarimtTaxSales`, `tax-sync.ts`): `sent` submission-ий хариуны
  ДДТД (толгой `id` + дэд `receipts[].id` — хэсэгчилсэн буцаалтын өмнөх ДДТД ч) эсвэл гар
  ДДТД-тэй POS борлуулалт → «POS / Авлагын нэхэмжлэх / Төлөлтийн баримт»; эс бөгөөс
  **«Entry-д алга»** (өөр касс, ТЕГ-ийн апп, порталаас олгосон) — Entry-ийн борлуулалтад
  бүртгэгдээгүй орлого байж болзошгүй тул «Анхаарах»-тай ижил ач холбогдолтой. Дүн ЗОХИОХГҮЙ
- **Хураангуй** (`summarizeTaxSales`): нэхэмжлэхийн төлөлт борлуулалтын нийлбэрт ДАВХАР
  орохгүй (ТЕГ ч НӨАТ-ын тайланд давхар тусгадаггүй), зөвхөн тоонд
- **UI:** Авлага → eBarimt → «ТЕГ-ийн бүх баримт» (`?view=sales`, огноо = URL `from/to` →
  топбарын период, ≤ 20 000 мөр), chip (Бүгд / Entry-д алга / төрөл), Excel, давхар даралт →
  Entry-ийн эх баримт
- **Хуучин холболт** (`allReceiptsFrom` null) дараагийн татлагад `syncedThrough`-ыг тэглэж
  `syncFrom`-оос БҮХ баримтыг дахин татна (`taxSalesBackfillNeeded`; ердийн хуваариар —
  01:00–07:00, нэг удаад ≤ 31 өдөр). Шинэ холболтын анхдагч эхлэл = Entry-ийн ТЕГ-д илгээсэн
  хамгийн эртний нэхэмжлэх/POS баримт (≤ 400 хоног), байхгүй бол энэ сарын 1
- Staging/бодит орчинд шалгах: status 0 нь толгой эсвэл дэд баримтын ДДТД буцаадаг эсэх
  (Entry хоёуланг тулгадаг); B2C баримтын `buyerRegNo` хоосон ирэх эсэх
