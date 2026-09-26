# Авлага/өглөг: кредит нэхэмжлэл, ECL нөөц, найдваргүй авлага

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (§5d–§5e). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

### 5d. Кредит нэхэмжлэл / дебит нэхэмжлэх (ENT-029) — ХЭРЭГЖСЭН

Шийдвэр: `docs/product/2026-09-audit-followup-proposal.md` §3 (D-CN-1…4 —
зөвлөмжөөр батлагдсан 2026-09-24). Нэхэмжлэхийн БУЦААЛТ нь тусдаа баримт:
`ar_credit_note` «Кредит нэхэмжлэл» (CN-), `ap_debit_note` «Дебит нэхэмжлэх»
(DN-) — дүн ЭЕРЭГ, эх нэхэмжлэхтэй (`source_document_id`), мөр бүр эх мөртэй
(`source_line_id`, хоёулаа SET NULL). Сөрөг мөртэй нэхэмжлэх ХЭРЭГЛЭХГҮЙ.

- **Төрлөөс хамаарах бүх шийдвэр `lib/arap/document-kind.ts`-д** (ЦЭВЭР):
  `arapLedger` (эрх, журналын модуль AR/AP), `controlSide` (хяналтын данс Дт/Кт),
  `settlementCashType` (үлдэгдлийг хаах мөнгө орох/гарах — касс, ханшийн
  олз/гарз, хуулгын импорт), `ledgerSign` (үлдэгдэл, KPI, тулгалт),
  `lineMovementType` (return_in / return_out), `offsetPair`. `=== "ar_invoice"
  ? … : …` гэсэн хоёр салаат шалгалт шинэ төрлийг АП руу чимээгүй унагадаг —
  ШИНЭ КОДОД ХОРИОТОЙ
- **GL:** кредит нэхэмжлэл Dr 51900001 «Борлуулалтын хөнгөлөлт» (АР-ын 5-бүлгийн
  мөр, сегмент нь эх мөрийнх; бусад мөр эх данс руугаа) + Dr НӨАТ өглөг / Cr
  авлага; дебит нэхэмжлэх Dr өглөг / Cr эх данс (клиринг/зардал) + Cr оролтын
  НӨАТ. НӨАТ-ын мөрийг хэрэглэгч сонгохгүй — буцаасан цэвэр дүнгийн хувиар
  (бүтэн буцаалтад үлдэгдэл бүтнээрээ); `computeVatReturn` өөрчлөгдөөгүй
- **Хязгаар:** буцаах тоо/дүн эх мөрийн ҮЛДЭГДЛЭЭС (батлагдсан бусад кредитийн
  дараа) хэтрэхгүй — үүсгэхэд `planCreditNote`, батлахад эх нэхэмжлэхийг
  `for update` түгжээд `creditOverrunError` ДАХИН шалгана. Кредит нь эх
  нэхэмжлэхийн ВАЛЮТ, ХАНШААР (ханшийн зөрүү үүсэхгүй); огноо ≥ эх огноо
- **Тооцоо (D-CN-3):** батлахад эх нэхэмжлэхийн нээлттэй үлдэгдэлд АВТОМАТААР
  (settlement хос, voucherId = кредитийн ӨӨРИЙН журнал, нэмэлт GL үгүй);
  илүүдэл = харилцагчийн кредит → кассаар буцаан олгох (зарлага) эсвэл
  `settleArApOffset`-оор дараагийн нэхэмжлэхтэй суутгах (Дт ↔ Кт хос).
  Энэ тооцоог `reverseArApOffset` БУЦААХГҮЙ — баримтыг буцаана
- **Бараа:** бараатай мөр батлагдмагц НООРОГ return_in (АР) / return_out (АП)
  хөдөлгөөн — сар хаалтад дунджаар үнэлэгдэнэ. «Тоо 0 + дүн» = бараа буцахгүй
  үнийн хөнгөлөлт
- **Хамгаалалт:** идэвхтэй кредиттэй эх нэхэмжлэхийг буцаах/устгахгүй
  (`[HAS_CREDIT_NOTES]`); батлагдсан кредитийг устгахгүй — буцаалтаар (тооцоо
  хамт сэргэнэ); кредитийн мөр/хяналтын данс засагдахгүй (`[CREDIT_LINES_LOCKED]`).
  POS-ийн нэхэмжлэх → `return_pos_sale`; PO-той нэхэмжлэх — ENT-064-тэй хамт.
  eBarimt-ийн засвар (D-CN-4) — дараагийн фаз

```
lib/arap/document-kind.ts        ЦЭВЭР: төрөл, дэвтэр, тал, чиглэл, хөдөлгөөн, суутгалын хос
lib/arap/credit-note.ts          ЦЭВЭР: planCreditNote, creditOverrunError, creditApplicationAmount
lib/arap/credit-note-db.ts       DB: эх ачаалах, буцаагдсан дүн, тооцоо хийх/буцаах (tx)
lib/actions/arap-credit-note.ts  getCreditNoteSource / createCreditNote (+ postNow)
lib/actions/arap.ts              батлах/буцаах/устгах/суутгал — төрлөөс үл хамаарах
components/arap/credit-note-dialog.tsx  панелийн «Кредит нэхэмжлэл» диалог
lib/ai/tools.ts                  create_credit_note (preview, lineNo)
tests/arap-credit-note.test.ts, tests/credit-note-flow.test.ts (DB)
```

### 5e. Авлагын ECL нөөц, найдваргүй авлага (ENT-065, IFRS 9) — ХЭРЭГЖСЭН

Шийдвэр: `docs/product/2026-09-audit-followup-proposal.md` §4 (D-ECL-1…4,
product owner 2026-09-25), `docs/cost/README.md` **1.2**. Хуудас Авлага → ECL
нөөц (`/receivables/ecl`, огноо = топбарын периодын төгсгөл).

- **Дансууд РОЛЬ** (`arap_ecl_settings`, ratified-seed): нөөц `12000099`
  (contra), зардал/сэргэлт `87000002`, DTA `26000001`, хойшлогдсон татварын
  зардал `70000004` — кодод хатуу бичихгүй
- **Хялбаршуулсан арга** — хугацаа хэтэрсэн хоногийн matrix (default 1/5/10/25/
  50/100%, хугацаа болоогүй нь эхний бүлэгт), байгууллага засна (admin + `ar:post`,
  аудит). Суурь = asOf-ийн байдлаарх батлагдсан АР нэхэмжлэлийн үлдэгдэл
  (тэр өдрөөс хойшхи тооцоо тоологдохгүй). Сарын журнал = шаардлагатай −
  GL-ийн нөөцийн үлдэгдэл, ЗААВАЛ НООРОГ (§9); дахин ажиллуулахад ноорог солигдоно
- **Хойшлогдсон татвар** (D-ECL-3): DTA = нөөц × байгууллагын ОРУУЛСАН ААНОАТ-ын
  хувь; хувь хоосон бол бодогдохгүй (ИЛ хэлнэ) — ХУВЬ ЗОХИОХГҮЙ. DTA данс бусад
  түр зөрүүтэй хуваалцдаг тул ECL-ийн мөр `businessObjectType "ecl_deferred_tax"`
- **Хасалт** (`writeOffArApDocument`, `ar:post`, шалтгаан заавал, зөвхөн `ar_invoice`):
  Dr нөөц (Кт үлдэгдлээр хязгаарлагдана — нөөц ХЭЗЭЭ Ч Дт болохгүй) + үлдэгдэл
  Dr зардал / Cr хяналтын данс; үлдэгдэл settlement-ээр хаагдана (`arap_write_offs`).
  Суутган тооцооны буцаалт хасалтыг буцаахгүй (`[USE_WRITE_OFF_REVERSE]`)
- **Сэргэлт** (D-ECL-4): Dr авлага / Cr ECL зардал → үлдэгдэл дахин нээгдэж
  ердийн кассын орлогоор хаагдана (`arap_write_off_recoveries`). Сэргэлттэй
  хасалт буцаагдахгүй (`[HAS_RECOVERY]`); сэргэлтгүйг эх огноогоор буцаана
- **Сар хаалтын checklist-ийн 5-р алхам** (`/close`, `get_month_end_checklist`):
  сарын эцсийн өдрийн шаардлагатай нөөц (+ DTA) GL-тэй тэнцсэн эсэх —
  `eclChecklistStatus` (ЦЭВЭР, тесттэй): ноорог батлагдаагүй → анхаарах, delta
  байгаа → хийгдээгүй, тэнцүү → бэлэн. Хаалтын ХОРИГ БИШ (ноорог нь drafts-аар
  хориглоно); төлөвлөгөөг `loadEclPlan` (ecl-db.ts) — ECL хуудастай НЭГ loader

```
lib/arap/ecl.ts            ЦЭВЭР (tests/arap-ecl.test.ts): matrix, planEclProvision,
                           eclJournalLines, splitWriteOff, recoveryProblem, view төрлүүд
lib/arap/ecl-db.ts         DB: loadEclSettings (seed), creditBalanceOf, loadEclOpenInvoices
lib/actions/arap-ecl.ts    getEclOverview / runEclProvision / saveEclSettings /
                           writeOffArApDocument / recoverArApWriteOff / reverseArApWriteOff /
                           listArapWriteOffs
components/arap/ecl-view.tsx, components/arap/write-off-section.tsx (АР панель)
tests/arap-ecl-flow.test.ts (DB)
```
