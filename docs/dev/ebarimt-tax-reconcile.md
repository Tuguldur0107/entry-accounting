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
  орчин, ITC нэвтрэх нэр, нууц үг, (X-API-KEY) → ebarimt_tpi_connections (шифртэй)
      │
ticker (10 мин тутам шалгана) → isTaxSyncDue → syncEbarimtTaxReceipts
  Keycloak password grant (vatps) → өдөр бүрд:
    getSalesTotalData status 3 (нэхэмжлэх)      → ebarimt_tax_receipts (isInvoice)
    getSalesTotalData status 0 (бүгд) → prParentRno-той л → ebarimt_tax_receipts (parentDdtd)
  syncedThrough урагшилна → тулгалтын тойм → lastCheckSummary
      │
loadEbarimtTaxChecks (амьд): Entry-ийн ТЕГ-д нэхэмжлэх болж бүртгэгдсэн авлага
  (АР: ar_ap_documents.ebarimtId · POS «Зээлээр»: pos_sales.ebarimtId → АР баримт)
  × ТЕГ-ийн нэхэмжлэх − Σ хүүхэд баримт × Entry-ийн илгээсэн төлөлтийн баримт
      │
«Анхаарах» (lastCheckSummary) · Авлага → eBarimt → «ТЕГ-ийн тулгалт» · АР панель · MCP
```

- **Хуваарь** (`isTaxSyncDue`, ЦЭВЭР): анх → шууд; нөхөлт дуусаагүй → 10 мин тутам
  (нэг удаад ≤ 31 өдөр); алдаатай → 1 цаг хүлээнэ; гүйцсэн бол өдөрт нэг, УБ 06:00-аас
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
Entry-ийн «илгээсэн төлөлт» = `sent` төлөвтэй `payment` submission-уудын
`payload.request.totalAmount` — ЗӨВХӨН ангилалд (ТЕГ-ийн бүртгэлтэй дүнгийн эх нь TPI).

## 4. Хатуу дүрэм

- **ЗӨВХӨН унших** — ТЕГ-д юу ч бичихгүй, тулгалт дүн ЗОХИОХГҮЙ, автоматаар засахгүй
  (зөрүүг хэрэглэгч ТЕГ-ийн портал / «Дахин илгээх»-ээр шийднэ).
- Нууц (нууц үг, X-API-KEY) `encryptSecret`-ээр; утга нь client, лог, аудит, алдаа,
  тестэд ХЭЗЭЭ Ч гарахгүй; талбар write-only (хоосон = хуучнаа хадгална).
  X-API-KEY байгууллагад хадгалаагүй бол серверийн `ITC_TPI_API_KEY`.
- Хост ЗӨВХӨН `lib/itc/constants.ts` (staging/production) эсвэл env `ITC_TPI_BASE` /
  `ITC_AUTH_BASE` (Монголд байрлах прокси — api.ebarimt.mn, auth.itc.gov.mn зөвхөн
  Монголын IP); хэрэглэгч URL оруулахгүй.
- Хуваарьт татлага ХЭЗЭЭ Ч шидэхгүй, request scope ашиглахгүй; багцад eBarimt
  боломжгүй бол алгасна. Тохиргоо хадгалах/шалгах/устгах admin+, гар татлага `ar:write`,
  унших `ar:read`; хадгалах/устгах/гар татлага бүр `logAuditEvent` (`ebarimt_tpi_connection`).
- Зөвхөн нэхэмжлэх ба `prParentRno`-той баримт хадгалагдана (B2C баримтын урсгал биш).

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

## 6. Staging-д баталгаажуулах (код таамаглалтай хэсэг)

Монголын IP-тэй орчноос (`docs/deployment/mongolia-network-runbook.md`), staging
хэрэглэгч `АА10010110` + staging X-API-KEY-гээр:

1. `getSalesTotalData`-ийн body-ийн wire нэр (`year/month/day/status/startCount/endCount`)
   ба хариуны талбар (`posRno`, `posRamt`, `prParentRno` …) — `docs/integrations/00` §4.4 №3
2. `startCount`/`endCount`-ийн утга (0/1-ээс, төгсгөл орох эсэх), хуудасны дээд хэмжээ
3. Token-ий хамрах хүрээ: body-д ТТД байхгүй — нэвтэрсэн хэрэглэгч олон байгууллагад
   эрхтэй бол аль байгууллагын өгөгдөл ирэх вэ (тулгалт Entry-ийн ДДТД-ээр л таардаг тул
   өөр байгууллагын мөр тулгалтад орохгүй ч хадгалагдана)
4. X-API-KEY оператор (Entry) бүрд нэг үү, татвар төлөгч бүрд үү (§4.4 №6); «том татвар
   төлөгчид зориулсан» сервисийг жижиг байгууллагад олгох эсэх
5. `prParentRno` нь `invoiceId`-тай баримт бүрд ирж буй эсэх; хэсэгчилсэн буцаалтын
   засварын (`inactiveId`) дараа хуучин/шинэ нэхэмжлэхийн ДДТД аль нь жагсаалтад гарах
6. Порталын «Үлдэгдэл» = нэхэмжлэх − Σ төлбөрийн баримт гэдгийг нэг нэхэмжлэх дээр тулгах
