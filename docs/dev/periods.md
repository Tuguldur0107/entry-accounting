# Period систем, топбарын периодын шүүлтүүр, snapshot

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (§4). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

### 4. Period систем — ХЭРЭГЖСЭН

Knowledge: `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/02-period-close.md`
Код: `lib/periods/period.ts` (цэвэр логик), `lib/periods/guard.ts`
(`assertPeriodOpen`), `lib/actions/periods.ts`, `app/(dashboard)/settings/periods`

- Период = хуанлийн сар, код нь `YYYY-MM`; `open` → `closed`
- **Бүртгэгдээгүй сар = НЭЭЛТТЭЙ.** Период мөр нь ХААЛТ хийхэд л үүсдэг тул
  хаалт хийж эхлээгүй систем саадгүй ажиллана
- Хаагдсан периодод бичилт хийх хориотой. Хамгаалалт орсон замууд: GL
  create/post/unpost/update, cash post/reverse, FX тэгшитгэл post/reverse,
  AR/AP create/post, АР↔АП суутган тооцоо (offset + буцаалт), банкны
  хуулга импорт, FA элэгдэл post/reverse, өртөг post/reverse, зардлын
  хуваарилалт
- **Close/post race хамгаалалт:** post замууд транзакц дотроо
  `assertPeriodOpenInTx` (shared advisory lock, түлхүүр 5) дууддаг;
  `closePeriod` exclusive lock авч БҮХ дэд дэвтрийн ноорог (GL, өртөг,
  касс, АР/АП, бараа, элэгдэл) тухайн сард үлдсэн эсэхийг шалгаад хаадаг
- **Буцаалт нь ЭХ огноогоор** шинэ журнал бичдэг тул тэр периодыг шалгана
- Ноорог бичилт үлдсэн сарыг хаахгүй (ноорог хожим батлагдаж гацна)
- Шинэ бичилтийн зам нэмэхэд `assertPeriodOpen(userId, date)`-ыг ЗААВАЛ дайруулна
- **Огнооны нэгдсэн дүрэм** (`lib/periods/document-date.ts` ЦЭВЭР, тесттэй —
  SIM ENT-027/028/041/012/067):
  - `assertPeriodOpen*` нь **хуанлид байхгүй огноог** (2025-02-30) татгалзана
    (`assertCalendarDate`) — бичилтийн бүх зам нэг цэгээс хамгаалагдана
  - **Ирээдүйн САРЫН огноо батлагдахгүй** (`assertNotFuturePeriod` — GL
    create(posted)/post, касс, АР/АП, бараа батлах): ноорог хэвээр үлдэнэ;
    AI/MCP post горимд ч ноорог + тайлбар (`futurePeriodDraftNote`)
  - **Шинэ баримтын анхдагч огноо = topbar-ийн сонгосон сар**
    (`currentDocumentDate()`: одоогийн сар → өнөөдөр, өнгөрсөн → сарын сүүлийн
    өдөр, ирээдүй → 1-ний өдөр). Форм/диалог/панелийн анхны утгад л —
    SSR-д рендерлэгддэг input-д БИШ (hydration). `new Date().toISOString()`-оор
    баримтын огноо ӨГӨХИЙГ ХОРИГЛОНО
  - **Кассын нээлт** `cash_accounts.opening_date` (эхний үлдэгдэлтэй бол
    ЗААВАЛ) + `opening_rate` (валютын дансанд, хоосон бол албан ханш);
    нээлтийн журнал ТЭР огноогоор, валютын данс FC × ханшаар (`lib/cash/opening.ts`)

**Системийн хэмжээний периодын шүүлтүүр (topbar):**

- `components/periods/period-filter.tsx` — сарын сонгогч (топбарт монгол нэр
  «2026 · 9-р сар» — `fmtPeriodLabelMn`; дотоод код "JAN-26" `fmtPeriodCode`
  хэвээр) + муж (**Сар / Улирлын эхнээс / Оны эхнээс** = PTD / QTD / YTD —
  `PERIOD_SCOPE_NAMES_MN`) нь сонгогч цонхон ДОТОР. Layout-д НЭГ л удаа суусан.
  Дуу, горим, гарах нь профайл цэсэнд (`components/layout/user-menu.tsx`) —
  топбарын удирдлага ≤ 7 (UI гайдын карт 8)
- Сонголт cookie-д (`ea-period`) хадгалагдаж бүх хуудсанд дагаж явна;
  server хуудас `getPeriodSelection()`-оор уншина (`lib/periods/selection.ts`)
- Мужийн тооцоо: `lib/periods/scope.ts` `scopeRange(code, scope, today)` —
  PTD = зангуу сар, QTD = улирлынх нь эхнээс, YTD = оны эхнээс; дуусах огноо
  нь одоогийн сард ӨНӨӨДРӨӨР таслагдана ("to date")
- **Дүрэм:** URL-ийн ил параметр (`start`/`end`, `from`/`to`, `period`,
  `asOf`) сонголтыг ДАРНА — deep link хэвээр ажиллана. Cookie зөвхөн
  default өгнө
- Шинэ огноо-шүүлттэй хуудас нэмэхдээ: URL параметр → байхгүй бол
  `getPeriodSelection()`-ийн from/to — энэ хэв маягийг дагана
- **Monthly close** гол алхмууд:
  1. Элэгдэл бодох (FA)
  2. FX дахин үнэлгээ (валют)
  3. Accrual бичилт
  4. Period хаах → snapshot үүсгэх
- **Snapshot + delta (урт хугацааны хэмжээ):** хаалт бүрд GL
  (`account_period_balances`, П28) ба КАСС (`cash_account_period_balances`,
  дансны ВАЛЮТААР) хоёуланд хаалтын үлдэгдэл бичигдэж, дахин нээхэд устдаг.
  Уншигчид (`lib/reports/period-balances.ts` `loadBalanceRowsFast` /
  `loadMainBalancesFast`, `lib/cash/period-balances.ts` `loadCashBalancesFast`)
  = сүүлийн хаагдсан үеийн snapshot + түүнээс хойшхи SQL нийлбэр — баримт/
  ваучерыг JS-д ачаалахгүй. Snapshot байхгүй бол бүх түүхийг нийлж ЗӨВ (зөвхөн
  удаан); хаагдсан үе immutable тул хуучирдаггүй. Кассын хуудсууд зөвхөн
  snapshot-оос ХОЙШХИ баримтыг ачаална; задаргаанд «хаагдсан үеийн үлдэгдэл»
  нэг мөр. БАРАА (`inventory_period_balances`, бараа×агуулахын тоо хэмжээ):
  `lib/inventory/period-balances.ts` `loadQtyBalancesFast` / `loadQtyLedgerFast`
  — үлдэгдэл, тооллого, хасах үлдэгдлийн шалгалт (`findNegativeStock(…, initial)`)
  бүгд snapshot-оос replay хийнэ. ӨРТӨГ: `runPeriodicCosting` хаагдсан үеийн
  `cost_period_results`-ыг зангуу болгон (`lib/costing/period-anchor.ts` —
  хаалтын ДАРАА тооцоологдсон, тасралтгүй хаагдсан урьдал) зөвхөн түүнээс
  хойшхи периодыг дахин бичнэ. Хуучин хаагдсан үеүдэд
  `scripts/backfill-period-snapshots.ts` (идемпотент) нөхөж бичнэ — шинэ
  хувилбар deploy хийсний дараа ажиллуулна
- **Дараалсан хаалт/нээлт (snapshot-ын урьдчилсан нөхцөл):** өмнөх сар
  нээлттэй (бүртгэлгүй ч) бөгөөд түүнээс өмнө бичилт байвал хаагдахгүй
  (`previous-open`); зөвхөн хамгийн сүүлийн хаалттай үеийг дахин нээнэ
  (`later-closed`). Бараа хөдөлгөөн батлах/цуцлах/устгах, тооллого мөн
  `assertPeriodOpen`-оор хамгаалагдсан — хаагдсан үеийн snapshot хуучирдаггүй
- **Year-end closing entries:**
  - `Dr 51100000 Орлого → Cr 44000099 Орлогын дүн`
  - `Dr 44000099 → Cr 6/7/8XXXXXXX Зардал`
  - `Dr 44000099 net → Cr 44000001 Хуримтлагдсан ашиг`
- Татварын хуваарь: НӨАТ дараа сарын 10, НДШ дараа сарын 5, ААНОАТ улирлын дараа сарын 20
