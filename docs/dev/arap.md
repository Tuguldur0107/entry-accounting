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
- **GL (улаан сторно, 2026-09-27 — `documentPosting`):** кредит нэхэмжлэл Кт
  51900001 «Борлуулалтын хөнгөлөлт» −X (АР-ын 5-бүлгийн мөр, сегмент нь эх мөрийнх;
  бусад мөр эх данс руугаа) + Кт НӨАТ өглөг −X / Дт авлага −X; дебит нэхэмжлэх Кт
  өглөг −X / Дт эх данс (клиринг/зардал) −X + Дт оролтын НӨАТ −X — эх нэхэмжлэхийн
  талд сөрөг, Дт/Кт солихгүй (үлдэгдлийн нөлөө өмнөхтэй ижил). Жагсаалт/панельд ХАСАХ. НӨАТ-ын мөрийг хэрэглэгч сонгохгүй — буцаасан цэвэр дүнгийн хувиар
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

### 5f. Нэхэмжлэхийн линкээр QPay-ээр төлөх + PDF дээрх QR — ХЭРЭГЖСЭН (2026-09-27)

Шийдвэр (product owner 2026-09-27): **1% шимтгэлийг байгууллага даана** (харилцагч
нэхэмжлэхийн дүнг л төлнө); **зөвхөн НЭЭЛТТЭЙ ҮЛДЭГДЛЭЭР бүтэн** — хэсэгчилсэн
төлбөр линкээр ҮГҮЙ.

- **Нөхцөл** (`invoiceQpayAvailable`, `lib/qpay/arap.ts`): `ar_invoice`, MNT,
  posted / partially_paid, үлдэгдэлтэй, `pos_settings.qpayEnabled` + readiness.
  Нийтийн хуудас `/invoice/[token]` дээр «QPay-ээр төлөх» (`components/arap/invoice-qpay-pay.tsx`)
- **Intent** = `pos_qpay_intents` `purpose "arap"` + `ar_ap_document_id` (shift / cashier
  NULL). Нээлттэй ижил дүнтэй intent-ийг дахин ашиглана; баримтад цагт ≤ 10 шинэ QR
  (`ARAP_QPAY_MAX_PER_HOUR`), IP-ээр 20/мин (`lib/actions/invoice-qpay.ts`). Төлөв Entry
  DB-ээс 3 сек тутам; [Төлсөн бол шалгах] QPay-ээс ≤ 1/10 сек
- **Бүртгэл** (`settleArapIntent`, ШИДЭХГҮЙ): webhook / шалгалт → `paid` → орлогын баримт
  `createCashDocument({ receipt, toCashAccountId: QPay түр данс, counterAccount: хяналтын
  данс, arApDocumentId, postNow, externalRef "qpay-arap:<id>" })` → intent `finalized` +
  `cash_document_id`. Журнал: Dt QPay түр данс / Кт авлага → ewallet settlement-ээр банк
  руу тулгагдана (шимтгэл тэнд). Webhook + шалгалт зэрэг ирвэл externalRef-ийн unique
  index → өмнөх баримтыг л холбоно (давхар орлого ҮГҮЙ)
- **Илүү / хоцорсон төлбөр** (харилцагч өөр замаар төлсөн, нэхэмжлэх хаагдсан):
  нэхэмжлэхэд бүртгэхгүй — intent `paid` + `[QPAY_ARAP_OVERPAID]`, POS жагсаалтын QPay
  баннерт «Нэхэмжлэх AR-…» → «Нэхэмжлэхэд бүртгэх» (дахин оролдох) эсвэл «Буцаах»
- **PDF дээрх QR** (`lib/pdf/invoice-pdf.tsx` `LinkQr`, `lib/qr/matrix.ts`): нийтийн линкийн
  URL (`NEXT_PUBLIC_APP_URL` заавал — байхгүй бол QR-гүй). И-мэйлээр илгээхэд токеныг
  урьдчилан үүсгэж PDF-д оруулна; апп доторх PDF татах нь ХҮЧИНТЭЙ линк байвал л QR
  (`activeInvoiceLinkToken`) — **PDF татах нь нийтийн линк ҮҮСГЭХГҮЙ** (гадагш нээх нь
  ИЛ үйлдлээр л). QPay идэвхтэй бол «QR уншуулж QPay-ээр төлөх», эс бөгөөс «онлайнаар үзэх»

```
lib/qpay/arap.ts                 startInvoiceQpay / invoiceQpayStatus / settleArapIntent / invoiceQpayAvailable
lib/qpay/arap-types.ts           InvoiceQpayView (client-safe)
lib/actions/invoice-qpay.ts      нийтийн action (токеноор, IP rate limit)
lib/arap/invoice-pdf-options.ts  PDF-ийн QR сонголт
tests/qpay-arap-flow.test.ts (DB), tests/qr-matrix.test.ts
```

### 5g. eBarimt нэхэмжлэх (docs/pos/05) — ХЭРЭГЖСЭН, анхнаасаа УНТРААЛТТАЙ

- Батлагдсан `ar_invoice` (POS-оос үүсээгүй) commit-ийн ДАРАА `enqueueArapInvoiceEbarimt`
  (`createArApDocument(postNow)` + `postArApDocumentCore`) — шидэхгүй, батлалтыг зогсоохгүй
- `ar_ap_documents.ebarimt*` — төлөв/ДДТД; панель `components/arap/arap-ebarimt-field.tsx`,
  «Дахин илгээх» `resendArapEbarimt` (ar:post)
- Нэхэмжлэх = ил `B2B/B2C_INVOICE` + мерчантын ТЕГ-д бүртгэлтэй данс (`receipts[].bankAccountNo`
  ЗААВАЛ, `iBan`), төлбөр тохиргооны АЛБАН код PAID (албан спек 3.0.1; `PAY`/«INVOICE» ХЭРЭГЛЭХГҮЙ)
- **Төлөлт** (кассын баримттай settlement — касс, банк, хуулга, QPay линк) → `invoiceId`-тай
  `*_RECEIPT` (`lib/ebarimt/invoice-payment.ts`, ЦЭВЭР): сканнер `enqueueArapInvoicePayments`
  (worker), settlement бүрд НЭГ, нэхэмжлэхийн ДДТД/төлөвийг хөндөхгүй; буцаасан төлөлт панельд ил.
  Харилцан суутгал, ECL хасалт, кредит нэхэмжлэл ОРОХГҮЙ (кассгүй)
- Кредит нэхэмжлэл, нэхэмжлэхийн буцаалт eBarimt-д ИЛГЭЭГДЭХГҮЙ — docs/pos/05 Q5


### 5g. Төлбөрийн автомат сануулга — ХЭРЭГЖСЭН (2026-09-28)

Авлага → **Сануулга** (`/receivables/reminders`). Төлөгдөөгүй нэхэмжлэхийн харилцагчид
нэхэмжлэхийн нээлттэй линктэй (QPay идэвхтэй бол шууд төлөх, §5f) и-мэйл.

- **Анхнаасаа УНТРААЛТТАЙ** (`ar_reminder_settings.enabled`); асаах/шат засах `ar:post`,
  асаахад илгээх бэлэн байдал (`reminderSenderProblem`: `RESEND_API_KEY`, илгээгч —
  нэхэмжлэх илгээхтэй ИЖИЛ `resolveInvoiceSender`, `NEXT_PUBLIC_APP_URL`) шалгагдана.
  Өөрчлөлт бүр аудит (`settings` / `ar_reminders`)
- **Шат:** хугацаанаас `beforeDays` (default 3) өмнө + хэтэрсний дараа `afterDays`
  (default 1, 7, 14; ≤ 5 шат). `dueReminderStage` (ЦЭВЭР, тесттэй): өнөөдөр болсон
  ХАМГИЙН СҮҮЛИЙН НЭГ шат, шат болсноос ≤ `REMINDER_CATCH_UP_DAYS` (7) хоногийн дотор,
  хожуу шат явсан бол өмнөхийг нөхөхгүй, урьдчилсан шат хэтэрсний дараа үгүй. Асаамагц
  аль эрт хэтэрсэн нэхэмжлэх рүү «хуучин өр» захиа цацахгүй
- **Хамрах:** `ar_invoice`, posted / partially_paid, үлдэгдэл > 0.01 (хасалт, кредит
  нэхэмжлэл `paidAmount`-аар тооцогдоно), харилцагч и-мэйлтэй, `arRemindersDisabled`
  биш. И-мэйлгүй / хасагдсан → `skipped` (мөр бичихгүй — и-мэйл нэмбэл дараагийн шат явна)
- **Хөдөлгүүр** (`lib/arap/reminders-run.ts`, request scope-гүй): ticker 10:00 УБ-аас
  (`REMINDER_JOB_HOUR_UB`), cron `?job=reminders`. Байгууллага × өдөр `notification_runs`
  (job `ar_reminders`) НЭГ дуудагч; нэхэмжлэх × төлөх огноо × шат `ar_invoice_reminders`
  unique INDEX-ээр булаагдсаны ДАРАА л захиа явна (олон instance давхардахгүй; төлөх огноо
  өөрчлөгдвөл шат шинээр). Resend алдаа → `failed`, дараагийн өдөр дахин (≤ 3 оролдлого).
  Байгууллагад өдөрт ≤ 100 захиа
- **Захиа:** гарчигт ДҮН БИЧИХГҮЙ (`buildReminderEmail`); биед үлдэгдэл, төлөх огноо,
  хэтэрсэн хоног, линк, банкны данс. Захиа бүр шинэ `ar_ap_invoice_sends` (`purpose
  reminder`, channel email) — «Үзсэн» төлөв, илгээлтийн түүхэнд «Сануулга ·». Аудит
  `arap` / `reminder_sent` (мэдэгдэл үүсгэхгүй)
- **Алдаа ЧИМЭЭГҮЙ үлдэхгүй:** захиа бүтэлгүй бол аудит `arap` / `reminder_failed`,
  асаалттай ч бүхэлдээ гацвал (илгээгч, домэйн, түлхүүр) `settings` / `reminders_blocked`
  → мэдэгдэл `arap.reminder_failed` (instant, ar:post; нэхэмжлэх × өдөр / өдөрт нэг).
  Хуваарьт ажил `system: true` — owner ч мэдэгдэл авна (docs/dev/notifications.md)
- **Гараар** (`sendManualInvoiceReminder`, action `sendInvoiceReminder` ar:write, AI
  `send_payment_reminder`): нэхэмжлэх илгээх цонхны «Төлбөрийн сануулга илгээх».
  Автомат унтраалттай ч, харилцагч хасагдсан ч (ИЛ үйлдэл) — шат `manual:<өдөр>`,
  нэхэмжлэхэд өдөрт НЭГ, автомат шатыг хөндөхгүй. AI унших `get_payment_reminders`;
  тохиргоо өөрчлөх нь ЗӨВХӨН вэбээс
- **Хэвлэх хуудас / PDF-ийн QR:** хүчинтэй линк байвал (`lib/arap/invoice-link.ts`
  `activeInvoiceLinkUrl`). Хэвлэх хуудас хэвлэх агшинд л mount болдог тул QR матрицыг
  СЕРВЕРТ бодно (`ArApDocumentDetail.publicLinkQr`, `lib/qr/matrix.ts`) — асинхрон
  `QrCode` тэнд хоосон гарна

```
lib/arap/reminders.ts            ЦЭВЭР (tests/ar-reminders.test.ts): шат, тохиргоо, захиа
lib/arap/reminders-run.ts        DB хөдөлгүүр: sendOrgInvoiceReminders, runInvoiceReminders
lib/actions/ar-reminders.ts      getArReminderOverview / saveArReminderSettings /
                                 sendInvoiceReminder / setCounterpartyReminderOptOut
components/arap/reminders-view.tsx, app/(dashboard)/receivables/reminders
tests/ar-reminders-flow.test.ts (DB)
```

### 5h. Давтамжтай нэхэмжлэх — ХЭРЭГЖСЭН (2026-09-28)

Авлага → **Давтамжтай** (`/receivables/recurring`); шинээр нэмэх нь нэхэмжлэхийн
панелийн **«Давтамжтай болгох»** — мөр, данс, НӨАТ-ын мөр, дүн нь ТЭР нэхэмжлэхээс
хуулагдана (тусдаа мөрийн editor байхгүй). Түрээс, захиалга, үйлчилгээний гэрээнд.

- **Хамрах** (`loadRecurringSource`): АР нэхэмжлэх, ₮ (ханш ЗОХИОХГҮЙ — валют нь
  сар бүрийн МБ ханш шаардана), бараагүй (бараа материал хөдөлгөхгүй), POS/PO-гүй,
  буцаагдаагүй. Панелийн товч мөн адил нөхцөлтэй
- **Хуваарь** (`lib/arap/recurring.ts` ЦЭВЭР, тесттэй): 1 / 3 / 6 / 12 сар, сарын
  өдөр 1–28 эсвэл сүүлийн өдөр (богино сард сүүлийн өдөр, 31 → 30 → 31 алдагдахгүй),
  эхлэх / дуусах огноо, төлөх хугацаа (default эх нэхэмжлэхийнх)
- **Горим:** анхдагч НООРОГ → мэдэгдэл `arap.recurring_created` (нягтлан батална);
  «Автоматаар батлах» + «И-мэйлээр илгээх» (PDF + линк, QPay) ИЛ сонголт — батлах
  тохиргоо `ar:post` эрх шаардана. Ноорог + и-мэйл хослол татгалзана
- **Хөдөлгүүр** (`lib/arap/recurring-run.ts`, ticker 09:00 УБ-аас tick бүрд, cron
  `?job=recurring`): нэхэмжлэх нь owner-ийн нэрээр ердийн `createArApDocument`-оор
  (период, данс, дугаар, eBarimt дараалал — тусдаа логик ҮГҮЙ), огноо = хуваарийн
  өдөр, утга «<утга> — YYYY-MM». Давхардалгүй: `externalRef recurring:<id>:<огноо>`
  (unique) + `nextRunDate`-ийг нөхцөлтэй урагшлуулна. Нэг tick-д ≤ 3 нөхөлт; дуусах
  огноо давбал `ended`. Алдаа (период хаалттай г.м) → `lastError` + `recurring_failed`
  → мэдэгдэл (instant, өдөрт нэг), дараагийн tick дахин оролдоно. Аудит `system: true`
- **Засах:** батлах/илгээх, төлөх хугацаа, дуусах огноо. Давтамж / өдрийг ЗАСАХГҮЙ
  (тэр сарын нэхэмжлэх давхардах) — шинээр үүсгэнэ. **Түр зогсоох / сэргээх** —
  сэргээхэд зогссон хугацааны нэхэмжлэх НӨХӨГДӨХГҮЙ. **«Дараагийнхыг одоо үүсгэх»**
  — дараагийн occurrence-ийг ӨНӨӨДРИЙН огноогоор (ирээдүйн сар батлагдахгүй), тэр
  өдөр ticker давхарлахгүй. Устгахад үүссэн нэхэмжлэхүүд хэвээр
- **Хүсэлтийн гадна `revalidatePath`:** ticker-ээс action дуудахад Next «static
  generation store missing» шиддэг — `lib/next/revalidate.ts` `revalidatePathSafe`
  (АР action-ууд, нэхэмжлэх илгээх) тэр алдааг л залгина

```
lib/arap/recurring.ts            ЦЭВЭР (tests/ar-recurring.test.ts): хуваарь, шалгалт, шошго
lib/arap/recurring-run.ts        DB: loadRecurringSource, createRecurringFromDocument,
                                 runRecurringInvoices, runRecurringNow, listRecurringTemplates
lib/actions/ar-recurring.ts      getRecurringInvoices / getRecurringSourcePreview /
                                 createRecurringInvoice / updateRecurringInvoice /
                                 setRecurringInvoiceStatus / deleteRecurringInvoice /
                                 runRecurringInvoiceNow
components/arap/recurring-dialog.tsx, recurring-view.tsx, app/(dashboard)/receivables/recurring
AI: list_recurring_invoices, create_recurring_invoice
tests/ar-recurring-flow.test.ts (DB)
```

### 5i. Тооцоо нийлсэн акт — ХЭРЭГЖСЭН (2026-09-28)

Авлага (эсвэл Өглөг) → Тайлан → **Тооцоо нийлсэн акт** (`/receivables|payables/reports/statement`,
топбарын период + `?counterparty=`). Нэг харилцагчийн АВЛАГА + ӨГЛӨГ НЭГ хуулгад (харилцагч
хоёр талтай байж болно), ₮ (гүйлгээний огнооны ханшаар).

- **Тэмдэг** (`statementDocumentSign`, `document-kind.ts`-ээс): + = харилцагч бидэнд өртэй.
  АР нэхэмжлэх + / кредит нэхэмжлэл − / АП нэхэмжлэх − / дебит нэхэмжлэх +; тооцоо (төлбөр,
  хасалт) нь баримтынхаа эсрэг тэмдэгтэй
- **Эх өгөгдөл** (`lib/arap/statement-db.ts`): батлагдсан баримт (ноорог, буцаагдсаныг хасна),
  `ar_ap_settlements` (кассын баримтын дугаар / журналын дугаартай), нэхэмжлэхгүй мөнгөн
  гүйлгээ (урьдчилгаа — харилцагчтай, `arApDocumentId` null, харилцах данс нь тэр харилцагчийн
  хяналтын данс). Кассгүй хос тооцоо (кредит нэхэмжлэлийн тооцоо, АР↔АП суутгал) нэг voucher-т
  нийлбэр 0 бол гарахгүй — үлдэгдэлд нөлөөгүй; ECL хасалт гарна
- **Эхний үлдэгдэл** = `from`-оос өмнөх бүх гүйлгээ; мөр бүрт хуримтлагдсан үлдэгдэл; хөлд
  гүйлгээний дүн + эцсийн үлдэгдэл; дүгнэлт «…-ны байдлаар X нь Y-д N₮ төлөх үлдэгдэлтэй»
- **PDF** (`/api/arap/statement`, `lib/pdf/statement-pdf.tsx`): манай бүртгэл + харилцагчийн
  бүртгэлийн ХООСОН дебит/кредит багана (гараар бөглөж баталгаажуулна), хоёр талын захирал /
  нягтлангийн гарын үсэг, тамга. Хязгаар: валютын баримт ₮-өөр (ханшийн тэгшитгэл орохгүй)

### 5j. Авлагын цуглуулалтын самбар — ХЭРЭГЖСЭН (2026-09-28)

Авлага → Хяналтын самбар, «Авлага»-ын гол тооны доор (хуудасны гол тоо хэвээр НЭГ):
`lib/arap/collections.ts` (ЦЭВЭР, тесттэй) + `collections-db.ts`.

- **DSO** = авлага / сүүлийн 90 хоногийн зээлийн борлуулалт (кредит нэхэмжлэл хасна) × 90;
  30-аас дээш шар, 60-аас дээш улаан
- **Энэ сард цуглуулсан** — АР нэхэмжлэхийн кассын тооцоо (өмнөх сартай харьцуулна)
- **Төлөх огноогоор орох мөнгө** — хэтэрсэн / 7 хоногт / 8–30 / 30-аас хойш (зурвас)
- **Хамгийн их хэтэрсэн 5 харилцагч** → «Акт» (тооцоо нийлсэн акт руу)
- **Сануулгын үр дүн** — сүүлийн 30 хоногт илгээсэн сануулгаас 7 хоногт төлөгдсөн хувь (жишиг)
- **Давтамжтай** — 30 хоногт үүсэх нэхэмжлэхийн тоо, дүн

```
lib/arap/statement.ts / statement-db.ts   акт (ЦЭВЭР / DB), tests/ar-statement.test.ts
lib/arap/collections.ts / collections-db.ts  самбар, tests/ar-collections.test.ts
lib/actions/ar-statement.ts, ar-collections.ts, app/api/arap/statement (PDF)
components/arap/statement-report-view.tsx, collections-panel.tsx
AI: get_counterparty_statement
tests/ar-statement-flow.test.ts (DB)
```

### 5k. Батлагдсан баримтын устгалт — product owner шийдвэр (2026-10-01)

Батлагдсан АР/АП нэхэмжлэх ба кассын баримтыг тайлант үе **НЭЭЛТТЭЙ** үед GL
журналтайгаа (үндсэн + буцаалт + эх) устгаж БОЛНО — гар GL журнал (§2c, зөвхөн
ноорог) өөр. Нөхцөл (`deleteArApDocumentCore`, `deleteCashDocumentCore`):

- `post` эрх; тайлант үе нээлттэй — `assertPeriodOpen` + транзакц дотор
  `assertPeriodOpenInTx` (хаалттай уралдахаас)
- Аудитын мөр ҮЛДЭНЭ (`logAuditEvent` — дугаар, огноо, дүн, өмнөх төлөв)
- УСТГАХГҮЙ (буцаалтаар л): POS-оос үүссэн (`[POS_SOURCED]`), төлөлттэй /
  кредит баримттай / батлагдсан бараа хөдөлгөөнтэй / хаагдсан PO-той /
  хуваарилагдсан зардалтай нэхэмжлэх, батлагдсан кредит/дебит баримт;
  **eBarimt-д бүртгэгдсэн (`sent`) эсвэл илгээгдэж буй (`claimed`) нэхэмжлэх**
  (`[EBARIMT_REGISTERED]` — ТЕГ-д баримт үлдэж НӨАТ чимээгүй зөрнө; кредит
  нэхэмжлэлээр); **QPay-ээр орсон төлбөрийн кассын баримт** (`[QPAY_SETTLEMENT]`
  — `pos_qpay_intents.cash_document_id`; мөнгө баримтгүй үлдэнэ; харилцагчид
  буцаасныг тусдаа зарлагаар)
- Тест `tests/delete-posted-guards.test.ts` (DB)

### 5l. Банкны хуулгын мөрөөс бүртгэх, урьдчилгаа — ХЭРЭГЖСЭН (2026-10-01)

Product owner шийдвэр (2026-10-01): хуулгын мөрөөс авлага/өглөг хаах, өглөг үүсгэж
зардалд бичих, урьдчилж орсон орлого / урьдчилж төлсөн зардал бүртгэх, урьдчилгааг
дараа нь нэхэмжлэхтэй суутгах; MCP-ээр ч бүгдийг.

**Мөрийн бүртгэлийн төрөл** (`ParsedBankStatementRow.rowAction`, `counterpartyId` —
`saveBankStatement`-ийн НЭГ транзакц дотор, тусдаа импортын логик ХОРИОТОЙ):

| Төрөл | Мөр | GL |
|-------|-----|----|
| (хоосон) + `settleInvoiceId` | орлого / зарлага | Dr банк / Cr авлага, эсвэл Dr өглөг / Cr банк (§ХЭРЭГЖСЭН) |
| `advance_received` | орлого | Dr банк / Cr урьдчилж орсон орлого (тохиргооны данс) |
| `prepaid_paid` | зарлага | Dr урьдчилж төлсөн (тохиргооны данс) / Cr банк |
| `create_ap_bill` | зарлага | АП нэхэмжлэх: Dr зардал (+ Dr НӨАТ оролт) / Cr өглөг — батлагдсан, тэр даруй **төлөгдсөн**; мөр: Dr өглөг / Cr банк |

- Гурван төрөлд **бүртгэлтэй харилцагч ЗААВАЛ** (нэрээр таахгүй — `counterpartyId`;
  MCP-д нэр яг / ганц таарц). `create_ap_bill`-д харилцагч өглөгийн төрөлтэй
  (`counterpartyDirectionError`), хяналтын данс = харилцагчийн default өглөг, эс
  бөгөөс системийн default; харьцах (DR) тал = ЗАРДАЛ (өглөг / банк биш).
- **НӨАТ** (`create_ap_bill`): байгууллага НӨАТ төлөгч бол ҮРГЭЛЖ дотроос 10/110
  (`vat_settings.vatRatePercent`, `inputVatAccountNumber` — хатуу дугааргүй).
- Урьдчилгаа зөвхөн MNT данс (суутгал MNT); харьцах тал нь тохиргооны урьдчилгааны
  данстай ЗААВАЛ таарна (вэб «Бүртгэл» сонгоход автоматаар бөглөнө).
- Вэб: хянах хүснэгтэд «Харилцагч» (бүртгэлээс сонгох), «Бүртгэл», «Нэхэмжлэх»
  (нээлттэй нэхэмжлэхийг гараар — дүн таарахгүй хэсэгчилсэн төлбөрт ч) багана.
  Харьцах талыг гараар солиход урьдчилгааны бүртгэл, нэхэмжлэхийн холбоос цуцлагдана.
- **Хуулгын дэлгэцээс ГАРАХГҮЙ** (product owner 2026-10-01): «Харилцагч» сонгогчийн
  «+ Шинэ харилцагч үүсгэх» нь АР/АП-ийн ЯГ ТЭР `CounterpartyDialog`-оор (нэр, харьцсан
  данс мөрөөс; орлого → авлагын, зарлага → өглөгийн харилцагч) үүсгээд мөрөнд холбоно.
  Хадгалаагүй хуулга (`bank_statement_drafts`, хэрэглэгч бүрд НЭГ, `lib/cash/statement-draft.ts`,
  route `/api/cash/statements/draft`) засвар бүрээс 1.5 сек-ийн дараа хадгалагдаж,
  хуудсанд буцаж ороход сэргэнэ; «Хадгалах» эсвэл «Хаях»-аар устна. GL-д ХЭЗЭЭ Ч
  бичихгүй; данс солиход хадгалаагүй хуулгатай бол асууна.

**Урьдчилгааны дансны роль** (`arap_advance_settings`, мөргүй бол default НЭГ удаа):
`customerAdvanceAccountNumber` 31300001, `supplierAdvanceAccountNumber` 18000001 —
ялгаатай, идэвхтэй, admin+ («Банкны хуулга» → «Урьдчилгааны данс», MCP
`update_advance_settings`). POS-ийн `pos_settings.customerAdvanceAccountNumber` ТУСДАА
(POS-ийн урьдчилгааны төлбөр).

**Үлдэгдэл** (`loadAdvanceBalances`, ЦЭВЭР `computeAdvanceBalances`): урьдчилгааны
дансан дээрх харилцагчтай, нэхэмжлэхгүй, батлагдсан кассын баримт (худалдан
авагчид орлого +, буцаан олголт −; нийлүүлэгчид эсрэгээр, MNT дүнгээр) −
`arap_advance_applications`.

**Суутгал** (`applyAdvanceToInvoice`, MCP `apply_advance_to_invoice`): АР — Dr
урьдчилж орсон / Cr авлага; АП — Dr өглөг / Cr урьдчилж төлсөн. `post` эрх, MNT,
огноо ≥ нэхэмжлэхийн огноо, нээлттэй үе; дүн ≤ урьдчилгаа ба нэхэмжлэхийн
үлдэгдэл (`resolveAdvanceApplyAmount`) — транзакц дотор харилцагчаар advisory lock
авч ДАХИН шалгана. Бичилт: журнал + `ar_ap_settlements` (кассгүй, voucherId) +
`arap_advance_applications`. **Буцаалт = `reverseArApOffset(voucherId)`** —
суутгалын мөр хамт устна (тусдаа буцаалтын зам ХОРИОТОЙ).

**Тооцоо нийлсэн акт** (§5i): урьдчилгааны дансан дээрх нэхэмжлэхгүй мөнгө
урьдчилгаа болж орно; суутгалын settlement нь дотоод дахин ангилал тул актаас
ХАСАГДАНА (давхар тооцохгүй).

```
lib/arap/advance-math.ts     ЦЭВЭР (client-safe): тал, тэмдэг, үлдэгдэл, суутгах дүн,
                             хуулгын мөрийн төрөл, НӨАТ 10/110
lib/arap/advances.ts         DB: тохиргоо, үлдэгдэл, суутгалын журналууд
lib/actions/arap-advances.ts getAdvanceSettings, saveAdvanceSettings, listAdvanceBalances,
                             applyAdvanceToInvoice
components/cash/advance-settings-dialog.tsx, components/arap/apply-advance-dialog.tsx
MCP: import_bank_statement (rowAction), apply_advance_to_invoice,
     get_counterparty_advances, update_advance_settings
tests/arap-advances.test.ts (цэвэр), tests/bank-row-actions-flow.test.ts (DB)
```
