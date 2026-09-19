# Entry Accounting — CLAUDE.md

## Төслийн тойм

Монгол нягтлан бодох бүртгэлийн вэб программ. Одоогийн байдал болон төлөвлөгдсөн feature-үүд:

| Feature | Одоо | Төлөвлөгдсөн |
|---------|------|--------------|
| Ерөнхий журнал (GL) | ✅ | — |
| Draft → Post журнал | ✅ | — |
| Мөнгөн хөрөнгө (Cash) | ✅ | — |
| Авлага / Өглөг (AR/AP) | ✅ | — |
| Бараа материал (Inventory) | ✅ | — |
| Өртөг (Costing) | ✅ | — |
| Хангамж (Procurement — PO, хүлээн авалт, landed cost) | ✅ | хангамжийн тайлан, урьдчилгаа/LC, receipt type |
| Үндсэн хөрөнгө (FA) | ✅ | — |
| Period систем | ✅ | — |
| AI туслах (expert accountant) | ✅ | — |
| НӨАТ модуль | ✅ | — |
| Цалингийн модуль (Payroll) | ✅ | — |
| Сар хаалтын wizard | ✅ | — |
| Аудитын мөр (audit log) | ✅ | — |
| Банкны хуулгын автомат тулгалт | ✅ | — |
| `custom/` өргөтгөлийн давхарга (fork) | ✅ | seed script, манифест |
| REST API v1 (гадаад интеграци) | ✅ | — |
| Fork нэвтрүүлэлт: version + upstream sync | ✅ | — |
| POS (борлуулалтын цэг) — кассын дэлгэц, борлуулах үнэ, борлуулалт→АР→касс→бараа→өртөг, хөнгөлөлт, ээлж, тайлан | ✅ | eBarimt 3.0 API, QPay API, камер barcode (Фаз 3) |
| Мэдэгдлийн систем (in-app хонх, и-мэйл, Telegram, custom суваг, тохиргоо, AI tools) | ✅ фаз 0–2 | SSE realtime, web push (фаз 3) |

## Файлын бүтэц

```
entry-accounting/
├── app/
│   ├── (auth)/login|register     # Нэвтрэх / бүртгүүлэх
│   ├── (dashboard)/
│   │   ├── layout.tsx            # Topbar + auth guard
│   │   ├── gl/
│   │   │   ├── journal/          # Журналын жагсаалт
│   │   │   ├── accounts/         # Дансны тохиргоо
│   │   │   └── reports/          # GL тайлан
│   │   ├── cash/rates/           # Валютын ханшийн түүх (татах + харах)
│   │   ├── procurement/          # Хангамж: самбар · orders · receipts · costs
│   │   └── inventory/pos, sales  # POS: кассын дэлгэц · борлуулалт/ээлж/тохиргоо
│   └── api/
│       ├── auth/[...nextauth]/   # NextAuth handler
│       └── attachments/          # Хавсралт: POST upload, GET [id] татах
├── components/gl/                # GL client components
├── components/procurement/       # Хангамжийн client components
├── components/pos/               # POS: checkout, payment-dialog, receipt, sales-workspace, sales-report-view
├── components/attachments/       # Хавсралтын жагсаалт (нийтлэг, ui-kit-ээр)
├── lib/
│   ├── auth.ts                   # NextAuth config
│   ├── actions/gl.ts             # Server Actions
│   ├── actions/auth.ts           # Register action
│   ├── actions/procurement.ts    # PO / хүлээн авалтын Server Actions
│   ├── actions/attachments.ts    # Хавсралт унших / устгах
│   ├── actions/exchange-rates.ts # Ханш татах / түүх унших Server Actions
│   ├── cash/exchange-rates.ts    # Ханш татагч + СУУРЬ ханш (getOfficialRateForDate)
│   ├── cash/rate-store.ts        # Ханшийн ТҮҮХ: өдрөөр upsert / унших (store-first)
│   ├── procurement/              # Цэвэр логик: constants, close-lines, po-math,
│   │                             #   types, load-data
│   ├── pos/                      # POS: constants, types, discounts, sale-math, payments,
│   │                             #   load-data, reports (§5c)
│   ├── actions/pos.ts            # POS Server Actions (createPosSale атомик, буцаалт, ээлж)
│   ├── attachments/constants.ts  # Хэмжээний хязгаар, төрлийн шошго
│   ├── notifications/            # Мэдэгдэл: catalog · rules (аудит гүүр) · attention
│   │                             #   (нүүр + scheduler НЭГ эх) · emit · scheduler · ticker
│   ├── db/schema.ts              # Drizzle schema
│   ├── db/index.ts               # DB connection
│   └── store/gl-store.ts         # Zustand UI state
├── custom/                       # ХАРИЛЦАГЧИЙН өргөтгөл (fork) — core энд бичихгүй
├── docs/deployment/              # Fork нэвтрүүлэлт, API, master data загвар
├── knowledge/                    # Мэргэжлийн мэдлэгийн сан
├── .env.local                    # DATABASE_URL, AUTH_SECRET
└── drizzle.config.ts
```

## Технологи (одоогийн)

- **Next.js 16** App Router + TypeScript
- **PostgreSQL** on Railway — Drizzle ORM
- **NextAuth v5** (Credentials + JWT)
- **Tailwind CSS** + shadcn/ui (Base UI)
- **AG Grid Community v35** — бүх хүснэгтийн UI, `DataGrid` wrapper-ээр ([Хүснэгтийн стандарт](#хүснэгтийн-стандарт-ag-grid-community))
- **Zustand** — UI state, grid undo/redo store (`lib/store/grid-store.ts`)
- Server Actions — mutations (createVoucher, deleteVoucher, createAccount…)

---

## ⚠️ UI стандартын зөрчил

`knowledge/03-стандарт/ui-standards/` файлууд нь хуучин **Chakra UI** spec.
Энэ төсөл shadcn/ui (Base UI) + AG Grid Community ашигладаг тул:

| Сэдэв | Knowledge файл | Энэ төсөлд |
|-------|----------------|-----------|
| Хүснэгт | `<StandardTable>` (Chakra) | AG Grid (`DataGridDynamic`) — нэгдсэн стандарт |
| Modal | `<Modal>` (Chakra) | shadcn `Dialog` |
| Дизайн | Dark mode + glassmorphism | Light + dark, `--ea-*` CSS токенууд |
| i18n | `t('key')`, 4 хэл | Зөвхөн монгол, hardcoded |

Нягтлан бодох логик, дансны код, IFRS/татварын дүрэм бүгд хамаарна.

---

## Гол дүрэм

- **Server Component by default:** Data fetch нь page.tsx дотор, mutation нь `lib/actions/` Server Action-аар
- **Client Component:** `"use client"` зөвхөн state/event handler шаардагдах үед
- **Монгол хэл:** UI текст бүгд монголоор
- **Нэмэх модулиуд:** periods/, vat/, payroll/ — тус бүрийн үед `app/(dashboard)/` доор нэмнэ

---

## Нягтлан бодох стандарт

### 1. Журналын баланс (journal-balance guardrail)

```
abs(ΣДебет − ΣКредит) ≤ 0.01   → тэнцсэн
ΣДебет = 0                       → хоосон, хориотой
Мөр бүрд дебет ЭСВЭЛ кредит    → хоёулаа зэрэг байж болохгүй
Мөр бүрийн дүн ≥ 0
```

Тэнцээгүй бол "Хадгалах" товч идэвхгүй — **одоогийн кодонд хэрэгжсэн**.

### 2. Draft → Post журнал — ХЭРЭГЖСЭН

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/journal-entry.md`

```
Draft үүсгэх → хэрэглэгч шалгана → Post дарах → хадгалагдана
  ↑ засвал draft руу буцна
```

- Draft статустай журнал нь period close-д ороогүй байна
- Post хийхэд journal_balance guardrail заавал давна
- `adjustment_type`: `regular` | `prior_period` | `closing` | `reversing` | `fx_reval` | `accrual`

### 2a. Журналын бичилтийн дугаар — ХЭРЭГЖСЭН

Журнал нь БҮХ модулиас үүсдэг тул дугаар нь эх модулиа ил хэлнэ:

```
<МОДУЛЬ>-<YY>-<NNNNNN>     GL-26-000001 · CM-26-000042 · FX-26-000003
```

- **Жил бүр 1-ээс** эхэлнэ (сангийн жилийн дотор тасралтгүй); `NNNNNN` нь 6
  оронгоор 0-дуулсан, байгууллага дотор давхардахгүй (partial unique index —
  дугааргүй мөр хэдэн ч байж болно)
- **Модулийн кодууд** (`JOURNAL_MODULE_CODES`, ӨӨРЧЛӨХИЙГ ХОРИГЛОНО — бичигдсэн
  дугаар нь баримтын мөнхийн танигдахуун): GL · CM · FX · AR · AP · INV ·
  COST · FA · PROC · PAY · VAT
- **БУЦААЛТ эх журналынхаа модулийг ӨВЛӨНӨ** (`moduleOfVoucherNo`) — кассын
  баримтын буцаалт "CM-", элэгдлийн буцаалт "FA-" болж хос нь нэг модульд үлдэнэ
- **Тоолуур АТОМИК**: `document_counters` мөрийг
  `on conflict do update set value = value + n returning value`-ээр нэмэгдүүлнэ.
  `select max(...) + 1` ХОРИОТОЙ — зэрэгцээ транзакц ижил дугаар авна.
  Дугаарлалт нь журналаа бичиж буй ТРАНЗАКЦ ДОТОР явагддаг тул бичилт унавал
  тоолуур ч буцаж, цоорхой үүсэхгүй
- **Олон журналыг нэг дор** бичихэд (банкны хуулга) `nextVoucherNos` — scope
  бүрд НЭГ л хүсэлтээр блок нөөцөлнө (500 мөрт 500 биш)
- **Багана нэмэгдэхээс ӨМНӨХ бичилтүүд НӨХӨЖ дугаарлагдсан** —
  `scripts/backfill-voucher-numbers.mjs` (идемпотент, preDeploy дууддаг).
  Эх модулийг ТАЙЛБАРЫН ТЕКСТЭЭР ТААХГҮЙ: дэд дэвтрийн холбоосоор
  (`cash_documents.voucher_id`, `ar_ap_documents.voucher_id`,
  `fa_depreciation_entries.voucher_id`, `cost_entries`, `goods_receipts`,
  `purchase_orders.close_voucher_id`, `payroll_runs`, `bank_statement_lines`,
  `fixed_assets.disposal_voucher_id` …) → журналын мөрийн дэд дэвтрийн түлхүүр
  → externalRef угтвар → буцаалтын эх журнал → үлдсэн нь "gl".
  Дугаар нь ОГНООНЫ дарааллаар, аль хэдийн олгогдсоныг ХӨНДӨХГҮЙ
  (scope бүрийн max-аас үргэлжилнэ). Шийдвэрийн цэвэр логик:
  `scripts/lib/voucher-number-plan.mjs` (`tests/voucher-backfill.test.ts`)
- AI/MCP-ийн журналын tools дугаараар ЧУ олдоно (`resolveVoucherRef`:
  эхлээд documentNo, дараа нь ID угтвар)

```
lib/gl/voucher-no.ts   ЦЭВЭР (тесттэй): voucherNoScope, formatVoucherNo,
                       parseVoucherNo, moduleOfVoucherNo + DB давхарга
                       nextVoucherNo / nextVoucherNos
tests/voucher-no.test.ts  Жилийн хил, модуль тус бүрийн тоолуур, багц нөөцлөлт
```

**Шинэ бичилтийн зам нэмэхэд** `journalVouchers`-д insert хийх бүрд
`documentNo: await nextVoucherNo(tx, orgId, "<модуль>", <огноо>)` ЗААВАЛ өгнө.

### 3. Дансны бүлгийн бүтэц (8 оронтой код)

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/01-gl-posting-matrix.md`

| Бүлэг | Код | Жишээ |
|-------|-----|-------|
| Эргэлтийн хөрөнгө | 1XXXXXXX | `11210000` Касс, `11000001` Банк |
| Эргэлтийн бус хөрөнгө | 2XXXXXXX | `21010000` Үндсэн хөрөнгө |
| Өр төлбөр | 3XXXXXXX | `31000001` AP, `31410000` НӨАТ өглөг |
| Эздийн өмч | 4XXXXXXX | `41100000` Эздийн өмч, `44000001` Хуримтлагдсан ашиг |
| Орлого | 5XXXXXXX | `51100000` Борлуулалтын орлого |
| COGS | 6XXXXXXX | `61100000` COGS |
| Үйл ажиллагааны зардал | 7XXXXXXX | `72100000` Цалингийн зардал |
| Санхүүгийн зардал | 8XXXXXXX | `87100001` Хүүгийн зардал |

### 3a. Сегментийн утгын стандарт жагсаалт + компанийн автомат сегмент

Тохиргоо → Ерөнхий журнал (`/settings/gl`) → "Сегментийн утгуудын жагсаалт".

- **Стандарт утга татах** (S2, S4, S5, S7, S8, S9, S10): жишиг лавлахыг
  `lib/constants/segment-defaults.ts`-ээс ачаална (S3 дансны "Стандарт данс
  нэмэх"-тэй ИЖИЛ хэв маяг) — байгаа КОДЫГ ХӨНДӨХГҮЙ, зөвхөн дутууг нэмнэ.
  Сегментийн тохиргооны табд "Бүх сегментийн стандарт утга татах" нэг товч
- **S1 (Компани) ба S6 (Группын дотоод) нь АВТОМАТ** — `organizations`
  бүртгэлээс бүрдэнэ, хоёулаа ЯГ ИЖИЛ код, ИЖИЛ нэртэй:
  - "Группын компаниуд" = тухайн байгууллагын эзэмшигч (owner) нь бусад
    ямар байгууллагыг ЭЗЭМШИЖ байна — үүссэн дарааллаар
  - Код нэг компанид НЭГ удаа хуваарилагдаж (101, 102…) ХЭЗЭЭ Ч
    өөрчлөгдөхгүй — журналд бичигдсэн posting код хоцрохгүй. Нэр солигдвол
    утгын НЭР дагаж шинэчлэгдэнэ (`segment_values.linkedOrganizationId` холбоос)
  - Хэрэглэгч гараар бичсэн ижил нэртэй утга байвал ӨВЛӨГДӨНӨ (давхардахгүй);
    бүртгэлээс гарсан компанийн утга УСТГАГДАХГҮЙ (түүхэн бичилт)
  - Ажиллах цэгүүд: `/settings/gl` хуудас нээх бүрд (идемпотент, өөрчлөлтгүй
    бол DB-д бичихгүй), компани үүсгэх/нэр солих, компанийн мэдээлэл хадгалах
- **S6 posting-ийн автомат default болохгүй** (`canAutoDefaultSegment`,
  `lib/gl/posting-code.ts`): жагсаалт нь S1-тэй ижил тул ганц утгатай үед
  өөрийгөө эсрэг тал болгон бичих эрсдэлтэй — segment-strategy §7.6.6 (s6 ≠ s1)

```
lib/constants/segment-defaults.ts  Стандарт утгын лавлах (ЦЭВЭР) — S2/S4/S5/
                                   S7/S8 (IAS 7)/S9 (модулийн тэмдэг)/S10
lib/gl/company-segments.ts         planCompanySegmentValues — ЦЭВЭР (тесттэй):
                                   код хуваарилалт, өвлөлт, нэрийн шинэчлэл
lib/gl/segment-sync.ts             DB давхарга ("use server" БИШ): компанийн
                                   sync + стандарт утга нэмэх
lib/actions/gl.ts                  syncSegmentDefaults / syncAllSegmentDefaults
tests/company-segments.test.ts     Идемпотент, нэр солих, давхардал, кодын урт
```

### 4. Period систем — ХЭРЭГЖСЭН

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/02-period-close.md`
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

**Системийн хэмжээний периодын шүүлтүүр (topbar):**

- `components/periods/period-filter.tsx` — сарын сонгогч ("JAN-26" формат,
  `fmtPeriodCode`) + **PTD / QTD / YTD** горим. Layout-д НЭГ л удаа суусан
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

### 5. Өртгийн бүртгэл (Costing) — ХЭРЭГЖСЭН

**Баримт бичиг: `docs/cost/` — өртгийн логик хөндөхийн ӨМНӨ заавал уншина.**
`README.md` (change-control хүснэгт = батлагдсан шийдвэрүүд) →
`01-functional-specification.md` → `02-journal-posting-rules.md` →
`03-report-specifications.md` → `04-implementation-status.md` → `CLAUDE.md`.

Батлагдсан шийдвэрүүд (README change-control 0.2–0.3):

| Асуудал | Шийдэл |
|---------|--------|
| Өртгийн арга | **Зөвхөн** хугацааны жигнэсэн дундаж (Periodic Weighted Average). FIFO/LIFO/perpetual moving average/standard cost хориотой |
| Хамрах хүрээ (OD-001) | Бараа × агуулах × компани |
| Период (OD-002) | GL-ийн `accounting_periods` — хуанлийн сар |
| Нарийвчлал (OD-003) | Дундаж, дүнг `numeric(28,10)`-аар бүтнээр; бөөрөнхийлөлт зөвхөн харуулах/GL-д бичихэд |
| Зардлын хуваарь (OD-017) | 3 суурь, баримт бүрд сонгоно: үнийн дүнгээр / тоо хэмжээгээр / гараар |
| Өртөг бодох цаг (OD-019) | Худалдан авалт — батлагдмагц шууд. Зарлага/тохируулга/буцаалт — **сар хаахад** сарын дундажаар |
| Үнэгүй орлого | Тооллогын илүүдэл, буцаж ирсэн бараа нь сарын дунджаар үнэлэгдэнэ. Дундаж нь эхний үлдэгдэл + ӨРТӨГТЭЙ орлогоос л бодогдоно |

Хатуу дүрмүүд:

- **Дансны дугаар кодод хатуу бичихийг хориглоно** — `costing_account_settings`
  (клиринг, тооллогын илүүдэл/дутагдал, NRV) ба `costing_item_settings`
  (барааны нөөц/COGS данс)-аас уншина
- **Зарлагын төрөл** (`inventory_issue_types`) дебет чиглэлийг шийднэ; посting
  profile нь `fixed` (тогтмол данс) эсвэл `item_cogs` (барааны COGS данс)
- **Өртгийн бүрэлдэхүүн** (`cost_components`) нь хэрэглэгчийн лавлах — код
  дотор хаалттай жагсаалт байхыг хориглоно
- **Үнэ ХЭЗЭЭ Ч зохиохгүй.** Өртөггүй орлого, 0 боломжит үлдэгдэл, сөрөг
  үлдэгдэл → тухайн бараа-агуулах-сар ЗОГСОЖ, шалтгаан нь UI-д харагдана
- **Нэг л үнэлгээний суурь:** нөөцийн үнэлгээ, NRV-ийн харьцуулалт, өртгийн
  хяналтын тайлан гурвуулаа `cost_period_results`-ээс уншина
  (`lib/costing/valuation.ts`). GL-ээс өртөг бодохыг хориглоно
- **Нээлттэй шийдвэрийг кодод, migration-д, enum default-д, fallback данс
  эсвэл UI default-д НУУХГҮЙ** — product owner-оос асууна

**UI бүтэц (5 нав цэс):** Хяналтын самбар · Өртгийн бичилт · **Зардлын
хуваарилалт** (`/costing/allocations` — 2 таб: PO-ийн зардлын worklist /
чөлөөт хуваарилалт) · **Тайлан** (`/costing/reports` — 4 таб: Өртгийн
хяналт / Үнэлгээ·NRV / Гүйлгээний дэлгэрэнгүй+GL тулгалт / Бүрэлдэхүүн) ·
Тохиргоо. Таб бүр ӨӨРИЙН route хэвээр (өгөгдөл нь зөвхөн тэр хуудсанд
ачаалагдана) — `components/costing/costing-section-tabs.tsx` нь layout-д
суугаад `PageTabs`-ээр шилжүүлнэ; таб бүрийн `<h1>` ХАСАГДСАН (таб нэрлэдэг).
Хуучин `/costing/{control,detail,components,unallocated}` redirect хийнэ.
GL тулгалт ЗӨВХӨН "Гүйлгээний дэлгэрэнгүй" табд (үнэлгээний хуудсан дээрх
хоёр дахь хэрэгжилт давхардал байсан тул хасагдсан).

Гол файлууд:

```
lib/costing/
├── periodic.ts          Цэвэр PWA хөдөлгөгч (тесттэй) — C1/Орлого/Зарлага/C2
├── period-run.ts        Хөдөлгөөн → хөдөлгөгч → cost_period_results
├── period-close.ts      Сарын өртөг тооцох (зарлагыг дундажаар үнэлнэ)
├── allocation.ts        Нэмэлт зардлын хуваарь (3 суурь, тесттэй)
├── valuation.ts         C2-оос нөөцийн үнэлгээ / NRV суурь
├── master-data.ts       Зарлагын төрөл, бүрэлдэхүүн, дансны рольууд
├── transaction-detail.ts Гүйлгээний дэлгэрэнгүй + GL тулгалт
├── clearing-objects.ts  ЦЭВЭР (тесттэй): GL-ийн клирингийн мөрийг бизнес
│                        объектод оноох дүрэм — ачаалагч хайлтын Map-ууд
│                        өгнө. БУЦААЛТ нь эх журналынхаа (reversalOfVoucherId)
│                        объектыг өвлөнө; АП-ийн мөрөөс үүссэн хөдөлгөөн
│                        (movement.sourceType="arap_line") тэр БАРИМТЫН
│                        объектод буудаг; хөдөлгөөнгүй үлдсэн өртгийн бичилт
│                        барааны нэрээр объект болно. Эдгээргүйгээр тэгширсэн
│                        хос хоёр объект болж "нээлттэй" гэж худал заадаг байв
├── clearing-reconciliation.ts  Клирингийн тулгалт — объект бүрийн
│                        Opening+Increase−Cleared=Ending; дансны нэгтгэл нь
│                        ТЭГШИРСЭН объектыг ч тооцно (данс 0.00 гэдгийг ил
│                        харуулна); unknownGross = Σ|үлдэгдэл| (цэвэр 0 байхад
│                        "асуудалгүй" мэт уншигдахаас сэргийлнэ)
├── component-analysis.ts Бүрэлдэхүүний задаргаа
└── costing.ts           Орлогын капитализаци + "үнэ хүлээж байгаа" жагсаалт
```

### 5a. Хангамж (Procurement — PO + landed cost) — ХЭРЭГЖСЭН

**Баримт бичиг: `docs/procurement/` — хангамжийн код хөндөхийн ӨМНӨ заавал
уншина.** `00-proposal.md` (дизайн §3–§5, БАТЛАГДСАН 2026-09-11) →
`01-implementation-contract.md` (функцийн нэр/параметр — зөрөхийг хориглоно).
Батлагдсан шийдвэрүүд `docs/cost/README.md` change-control **0.6**, норматив
шаардлага `docs/cost/01-functional-specification.md` §11
**FR-PROC-006 … FR-PROC-012**.

Худалдан авалтыг НЭГ объект (PO) болгож, хоёр түр дансаар хаалтыг хянана.
Өртгийн PWA хөдөлгөгч (`periodic.ts`, `period-run.ts`, `period-close.ts`)
ӨӨРЧЛӨГДӨӨГҮЙ — хангамж нь зөвхөн Inbound-ыг бүрдүүлнэ.

**Урсгал** (бичилт бүрийн Business Object = PO):

```
① PO үүсгэх (ноорог) → Батлах (open)        GL бичилт ҮГҮЙ (захиалга нь гүйлгээ биш)
② Хүлээн авалт (GR) — PO панелиас; нэхэмжлэхээс ӨМНӨ ч ДАРАА ч, хэсэгчилсэн
   Батлах → po_receipt орлого (confirmed) + АВТОМАТ receipt_capitalize
   дүн = тоо × PO нэгж үнэ × ХҮЛЭЭН АВСАН ӨДРИЙН Монголбанкны ханш
③ Нийлүүлэгчийн нэхэмжлэх (PO-той) — нэхэмжлэхийн өдрийн МБ ханш
   хөдөлгөөн ҮҮСГЭХГҮЙ (орлого ②-оос); хаагдсан PO → [PO_CLOSED]
④ Нэмэлт зардал (гааль, тээвэр, брокер…) — мөр бүрд бүрэлдэхүүн
   гаалийн татвар КАПИТАЛЖИНА; импортын НӨАТ капиталжихгүй → НӨАТ авлага
⑤ Хуваарилалт — "Хуваарилагдаагүй зардал" worklist; суурь 3, default СОНГОГДОХГҮЙ
   (PO-ГҮЙ зардлыг Өртөг → Зардлын хуваарилалт → Чөлөөт табаас хуваарилна:
    эх нэхэмжлэхийн мөрийг СОНГОЛТООР холбоно — холбовол клирингийн тулгалтад
    Dr/Cr нэг объектод тэгширч, Σ нь мөрийн үлдэгдлээс хэтрэхгүй)
⑥ PO хаах — нөхцөл биелсэн үед түр дансуудыг тэгшитгэнэ, зөрүү → ханшийн олз/гарз
⑦ Төлбөр — арилжааны банкны ханш (одоогийн касс логик, өөрчлөлтгүй)
⑧ Сар хаалт — тэр сард хүлээн авалттай НЭЭЛТТЭЙ PO байвал ХОРИГЛОНО
```

**PO-гүй жижиг худалдан авалт** — одоогийн зам хэвээр: АП бараатай мөр →
орлого → нэхэмжлэхийн дүнгээр капитализаци (нэг түр дансаар).

**GL бичилт** (дугаар кодод байхгүй — тохиргооны РОЛЬ):

```
② Хүлээн авалт батлах   Dr Барааны нөөц  (costing_item_settings)
                        Cr Бараа мат. түр данс (clearingAccountNumber)
③④ PO-той нэхэмжлэх     Dr Өглөгийн түр данс (apClearingAccountNumber)
                        Cr Өглөг (АР/АП-ийн одоогийн логик)
   импортын НӨАТ        Dr НӨАТ авлага (бүрэлдэхүүнгүй мөр, данс ИЛ)
⑤ Хуваарилалт          Dr Барааны нөөц / Cr Бараа мат. түр данс  (landed_cost)
⑥ PO хаалт             Dr Бараа мат. түр данс / Cr Өглөгийн түр данс
                        зөрүү → Dr Ханшийн гарз ЭСВЭЛ Cr Ханшийн олз
                        (fxLoss/fxGainAccountNumber) → хоёр түр данс PO-гоор 0
```

Гол файлууд:

```
lib/procurement/
├── constants.ts      PO_BUSINESS_OBJECT / PO_SOURCE_TYPE / PROCUREMENT_MODULE_KEY
│                     — литералын ЦОРЫН ГАНЦ эх сурвалж
├── close-lines.ts    buildPoCloseLines — ЦЭВЭР (тесттэй) хаалтын мөрүүд,
│                     ханшийн олз/гарз; чиглэл буруу бол ШИДНЭ (нөхөж бичихгүй)
├── po-math.ts        remainingToReceive / remainingToInvoice / poCloseBlockers
│                     — хаалтын нөхцөл, шалтгаан нь МОНГОЛ текстээр
├── types.ts          PurchaseOrderView / …Detail / GoodsReceiptView г.м. (plain)
└── load-data.ts      loadPurchaseOrders / …Detail / loadGoodsReceipts /
                      loadUnallocatedCostLines / loadProcurementDashboard

lib/actions/procurement.ts   PO CRUD + approve/cancel/close/reopen, GR
                             create/update/confirm/reverse/delete,
                             createApInvoiceFromPo, панелийн getter-ууд,
                             fetchOfficialRate, getLandedCostSummary
lib/cash/exchange-rates.ts   pickOfficialRate (цэвэр) + getOfficialRateForDate
                             — Монголбанкны албан ханш огноогоор (СУУРЬ ханш)
lib/costing/posting-helpers.ts  costing.ts-ээс ЗӨӨСӨН нийтлэг туслахууд
                                (itemAccountsFor, costingPostingCodeBuilder…)
```

Хатуу дүрмүүд:

- **Дансны дугаар кодод хатуу бичихийг хориглоно** — `clearingAccountNumber`
  (бараа мат. түр данс), `apClearingAccountNumber` (өглөгийн түр данс, default
  31000099), `fxGain/fxLossAccountNumber`, барааны нөөц/COGS нь
  `costing_item_settings`-ээс (JPR-006)
- **Бараа ХҮЛЭЭН АВСАН ӨДРИЙН албан ханшаар үнэлэгдэнэ** — нэхэмжлэх өөр
  ханштай байсан ч өмнөх капитализаци хөндөгдөхгүй; зөрүү нь PO хаалтад
  ханшийн олз/гарз болж ГАРНА (өртөгт шингэхгүй)
- **Ханш ХЭЗЭЭ Ч зохиогдохгүй** — `getOfficialRateForDate` олдохгүй бол
  ШИДНЭ, хэрэглэгч гараар оруулна
- **`po_receipt` хөдөлгөөнийг бараа материалын модулиас засах/устгах/цуцлах
  ХОРИОТОЙ** — зөвхөн Хангамж → Хүлээн авалт дээрээс буцаана. `/costing`-ийн
  гар үнэ оруулах жагсаалтад ч, `runCosting`-ийн receiptCosts-д ч ОРОХГҮЙ
  (аль хэдийн үнэлэгдсэн)
- **Бүх бичилт `businessObjectType: "purchase_order"` + `businessObjectId`-тай**
  байна (бичих мөчид, lineage-аас гаргаж авахгүй) — хоёр түр данс PO
  объектоороо тэгширнэ (FR-PROC-004)
- **Хуваарилалтын "үнийн дүнгээр" суурийн жин = PO мөрийн нийт үнэ** (D6 = (а)):
  өмнө хуваарилсан `landed_cost` жинд ОРОХГҮЙ → дарааллаас хамаарахгүй.
  Суурь урьдчилан СОНГОГДОХГҮЙ (OD-017), `manual`-д Σ таарахгүй бол хадгалахгүй
- **PO хаалтын нөхцөл** (`poCloseBlockers`): Σ хүлээн авсан = захиалсан, Σ
  нэхэмжилсэн тоо = захиалсан, Σ нэхэмжилсэн дүн (PO валют) = мөрийн дүн, бүх
  нэмэлт зардал хуваарилагдсан. Зөрүүг АВТОМАТААР нөхөхийг хориглоно — UI-д
  улаанаар харагдана
- **Сар хаалт:** хүлээн авалттай нээлттэй PO байвал `closePeriod` код
  `open-purchase-orders`-оор татгалзана; ноорог хүлээн авалт бусад ноорогтой
  адил хаалтыг хориглоно (OD-011)
- Бичилтийн зам бүрд `assertPeriodOpen(orgId, date)` + транзакц дотор
  `assertPeriodOpenInTx` ПЕРВЫЙ; эрх `requireModuleAction("proc", …)`; статус
  шилжилт бүрд `logAuditEvent`
- **Хавсралт** нь нийтлэг `document_attachments` (entityType `purchase_order`,
  дараа бусад модульд ч); унших/татах зам ЗААВАЛ org шалгалттай (ID нь эрх
  олгохгүй); хаагдсан PO-д нэмж болно, устгахгүй
- **UI:** модулийн түлхүүр `proc` (`lib/constants/app-modules.ts`), нав бүлэг
  `procurement` (`components/layout/modules.ts` — самбар / Захиалга / Хүлээн
  авалт / Тайлан; "Хуваарилагдаагүй зардал" нь Өртөг модулийн Зардлын
  хуваарилалт табд `/costing/allocations` — хуучин `/procurement/costs` ба
  `/costing/unallocated` redirect хийнэ), панель `purchase-order` ба
  `goods-receipt`
  (`panel-registry.tsx`). Хүснэгт `DataGridDynamic`, статус `StatusBadge`,
  шүүлтүүр `FilterChips` / `PageTabs`, хоосон `EmptyState`, icon `Icon` /
  `IconAction`, батлах диалог `useConfirm` — шинэ component/icon бичихийг
  ХОРИГЛОНО; жагсаалт дээр давхар даралт → панель

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
- **Хасах үлдэгдэл ЗӨВШӨӨРНӨ** (`pos_settings.allowNegativeStock`, D9) — баримт,
  самбар, сар хаалтын checklist-д мэдэгдэл; хөдөлгөгч тэр бараа×сарыг зогсоодог
  тул `closePeriod` `unvalued-movements` хоригоор (сарын тооцоололд "calculated"
  биш scope-той батлагдсан зарлага/буцаалт/тохируулга) засагдтал хаагдахгүй;
  мөн `open-pos-shifts` (нээлттэй ээлж)
- **НӨАТ `vat_settings.isVatPayer`-ээс** (D4): төлөгч → барааны `salesPrice` НӨАТ
  ОРСОН, мөр бүр `vatMode`-оор задарна; төлөгч биш → НӨАТ мөр огт үгүй
- **Хөнгөлөлтийн хөдөлгөгч** (`lib/pos/discounts.ts`, 9 төрөл, тесттэй): төлөх
  дүнд шууд нөлөөлнө, НӨАТ хөнгөлөлтийн ДАРААХ дүнгээс; `approvalReasons`
  хоосон биш → `pos:post` эрх (`[APPROVAL_REQUIRED]`); GL default цэвэр орлого,
  `discountPosting=contra` бол GL-д Cr орлого бүтэн + Dr хөнгөлөлт (АР мөр цэвэр)
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
├── load-data.ts        ensurePosSettings (ratified-seed), view ачаалагч, loadCheckoutData
└── reports.ts          loadSalesReport + ЦЭВЭР нэгтгэл (aggregateBy/summarize/aggregatePayments, тесттэй)
lib/costing/provisional-cost.ts  явцын дундаж + trueUpDelta (ЦЭВЭР, тесттэй) + loadProvisionalUnitCosts
lib/costing/period-close.ts      cogs_true_up залруулга (posted урьдчилсан бичилтэд)
lib/actions/pos.ts               createPosSale (атомик) / returnPosSale / ээлж / бэлгийн карт /
                                 тохиргоо / төлбөрийн хэлбэр / хөнгөлөлтийн дүрэм / quotePosSale
app/(dashboard)/inventory/pos    Кассын дэлгэц (сканнер = гар, F9 төлбөр, баримт хэвлэх)
app/(dashboard)/inventory/sales  Борлуулалт · Ээлж · Бэлгийн карт·кредит · Тохиргоо (табууд)
app/(dashboard)/inventory/reports?tab=sales  Борлуулалтын тайлан (6 таб, COGS cost_period_results-ээс)
components/pos/                  pos-checkout-view (кассын дэлгэц), payment-dialog, receipt-preview
                                 (80мм хэвлэлт, usePosPrint), sales-workspace (4 таб) → sales-list-view /
                                 shifts-view + shift-dialogs (нээх, хаах, Z-тайлан) / gift-cards-view /
                                 pos-settings-view (+ discount-rule-dialog, хөнгөлөлтийн симуляци),
                                 sales-report-view (/inventory/reports, 6 таб)
components/panel/pos-sale-panel  Борлуулалтын панель (буцаалт: мөр/дүн, буцаан олголт эсвэл
                                 дэлгүүрийн кредит; дахин хэвлэх; eBarimt; АР/журнал/хавсралт)
tests/pos-*.test.ts, tests/provisional-cost.test.ts
```

### 5b. Валютын ханшийн түүх (Монголбанк) — ХЭРЭГЖСЭН

Хэрэглэгч **эхний үлдэгдэл, өмнөх хугацааны бичилт** оруулахад ӨМНӨХ ҮЕИЙН
ханш хэрэгтэй болдог тул Монголбанкны ханш нь "өнөөдрийн татагдац" биш —
`exchange_rates` хүснэгтэд **ӨДРӨӨР** хадгалагдаж, дурын хуучин огноогоор
уншигдана. Хүснэгт нь **НИЙТИЙН лавлах**: `organizationId` БАЙХГҮЙ (ханш нь
нийтийн баримт), давхардлыг **unique INDEX** `(source, currency, date)`
хамгаална (`uniqueIndex`, constraint БИШ — drizzle-kit 0.31.x-ийн #5955 алдаа:
`unique()` constraint-ыг push дараагийн удаа танихгүй, бөглөөтэй хүснэгтэд
truncate асуулт тавьж preDeploy унагадаг).

**Монголбанкны албан ханш = системийн СУУРЬ ханш** — хүлээн авалт, нэхэмжлэх,
PO хаалт, FX тэгшитгэл бүгд албан ханшаар үнэлэгдэнэ (§5a, docs/procurement
§3.5). Арилжааны банкны ханш ЗӨВХӨН төлбөрт.

**Унших дараалал — STORE-FIRST** (`getOfficialRateForDate(currency, date)`):

```
(а) ЯГ тэр өдрийн хадгалагдсан ханш → шууд буцаана (сүлжээ хөндөхгүй)
(б) байхгүй бол Монголбанкнаас татна → ХАДГАЛНА → буцаана
(в) эх сурвалж унасан бол ≤10 хоногийн дотоод хадгалсан ханшаар нөхнө
(г) бас олдохгүй бол ШИДНЭ — ханш ЗОХИОХГҮЙ, хэрэглэгч гараар оруулна
```

- (а) нь **ЯГ таарсан огноо** шаарддаг: агуулах тэр огноог хүртэл дүүрээгүй
  байхад "≤ огнооны сүүлийнх" нь МБ-ийн бодит ханшнаас ЗӨРӨХ боломжтой
  (МБ амралтын өдөр ч мөр нийтэлдэг)
- **Амралтын / баярын өдөр:** `loadStoredRate` (ба цэвэр
  `pickLatestOnOrBefore`) нь огноо **≤ asOf** мөрүүдийн ХАМГИЙН СҮҮЛИЙНХ-ийг
  авна = өмнөх ажлын өдрийн ханш. Хүссэн огноо бүх мөрөөс өмнө бол `null`
- `MNT` → ханш 1 (сүлжээ хөндөхгүй); валютын код гажиг бол ШИДНЭ

**Түүх татах:** `POST mongolbank.mn/mn/currency-rates/data?startDate=&endDate=`
нь мужийн **ӨДӨР ТУТМЫН** мөрүүдийг буцаана (нэг жил ≈ 365 мөр × ~50 валют;
амралтын өдөр өмнөх ханшаар давтагдана). `fetchMongolbankHistory(from, to,
currencies?)` нь мужийг **365 хоногоор хуваан ДАРААЛАН** татна (МБ-ыг зэрэг
хүсэлтээр цохихгүй), огноо буруу / муж урвуу бол ШИДНЭ. Цэвэр
`parseMongolbankHistory` нь мөр бүрийн бүх хүчинтэй валютыг quote болгоно;
огноогүй / гажиг мөрийг чимээгүй алгасна — ханш ЗОХИОХГҮЙ.

Гол файлууд:

```
lib/cash/exchange-rates.ts   Татагч + parser (цэвэр, тесттэй) +
                             getOfficialRateForDate (СУУРЬ ханш, store-first).
                             `@/lib/db`-г import ХИЙХИЙГ ХОРИГЛОНО — client
                             component ч эндээс төрөл / rateForBasis уншдаг тул
                             postgres драйвер browser bundle-д орно
lib/cash/rate-store.ts       ТҮҮХИЙН давхарга (ЭНГИЙН модуль, "use server" БИШ —
                             action, cron, script гурвуул шууд дуудна):
                             saveExchangeRates (upsert), loadStoredRate (огноогоор),
                             loadStoredRates (муж), storedRateCoverage (хамрах
                             хүрээ), pickLatestOnOrBefore (ЦЭВЭР, тесттэй).
                             Import хийгдэх мөчдөө registerExchangeRateStore-оор
                             ӨӨРИЙГӨӨ бүртгэнэ (globalThis) — server талын дурын
                             модуль үүнийг import хийсэн даруйд ханшийн хайлт
                             ХАДГАЛСАНААС эхэлдэг болно
lib/actions/exchange-rates.ts  Ханшийн Server Actions: муж + валютаар татаж
                             хадгалах, хадгалагдсан түүх / хамрах хүрээ унших
                             (Core + ActionResult wrapper, эрх нь cash модуль)
app/(dashboard)/cash/rates   "Валютын ханш" хуудас: муж/валют сонгож татах,
                             хамрах хүрээ, хадгалагдсан мөрүүд (DataGridDynamic)
app/api/cash/exchange-rates/route.ts  ШУУД (live) 3 эх сурвалжийн (МБ / ХХБ /
                             Голомт) тухайн өдрийн ханш — тулгалтын
                             workspace-ийн quote хүснэгтэд; түүх БИЧИХГҮЙ
tests/rate-store.test.ts     Амралтын өдөр, гажиг огноо, сар/жилийн хил
tests/exchange-rates.test.ts parseMongolbank{Rates,History}, pickOfficialRate
```

Хатуу дүрмүүд:

- **ХАНШ ХЭЗЭЭ Ч ЗОХИОГДОХГҮЙ** — олдохгүй бол ШИДНЭ, хэрэглэгч гараар
  оруулна. Интерполяци, дундажлах, "сүүлд мэдэгдэж байсан ханшаар" чимээгүй
  нөхөх ХОРИОТОЙ; (в) нөхөлт нь 10 хоногоор хязгаарлагдсан ба `stored: true`
  гэж ИЛ тэмдэглэгдэнэ
- **Ханшийн уншилт бүр `getOfficialRateForDate`-аар** — модуль дотроо МБ-ыг
  `fetch`-ээр дуудахыг хориглоно (тэгвэл хадгалалт ба амралтын өдрийн дүрэм
  алдагдана)
- **upsert нь ХООСОН БИШ утгаар л дардаг** (`coalesce(excluded.…, одоогийн)`) —
  албан ханш татсан нь арилжааны банкны buy/sell баганыг УСТГАХГҮЙ
- **Нэг INSERT дотор ижил (source, currency, date) давхардвал урьдчилж
  нэгтгэнэ** (Postgres "cannot affect row a second time"); 500 мөрөөр chunk
- **`date` нь ханшийн ӨӨРИЙН огноо** (эх сурвалжийн `RATE_DATE`) — татсан
  хугацаа нь `fetchedAt`. Хоёуланг андуурахгүй
- Хүснэгт нийтийн лавлах тул **rate-store дотор эрхийн шалгалт БАЙХГҮЙ** —
  дуудагч server action `requireModuleAction` дайруулна
- Хадгалалт унасан ч ханшийн уншилт ЗОГСОХГҮЙ (агуулах нь кэш, эх сурвалж биш)

**FX тэгшитгэл — хэрэглэгчийн сонгосон огнооны ханшаар:**

- Хэрэглэгч тулгалтын workspace-д
  (`components/cash/cash-reconciliation-workspace.tsx`) **огноогоо ГАРААР**
  сонгоно → тэр огнооны quote-ууд гарч ирнэ → сонгосон quote нь мөрийн
  хаалтын ханш + ханшийн баримт болно; ханш сонгоогүй мөр батлагдахгүй
  ("хаалтын ханш оруулна"), гараар өгсөн ханшид шалтгаан ЗААВАЛ
- `postCashFxRevaluation` (lib/actions/cash.ts) нь `valuationDate`,
  `closingRate` дээр ханшийн баримтыг (`rateSource`, `rateBasis`, `sourceDate`,
  `sourceUrl`, `fetchedAt`, `manualOverrideReason`) хамт хадгална —
  тэгшитгэл бүр ямар огнооны ямар ханшаар бодогдсоныг дараа нь баталгаажуулна
- Ирээдүйн огноонд тэгшитгэл хийхгүй (Улаанбаатарын өнөөдрөөр); огноо
  `assertPeriodOpen` дайрна; журнал нь ТЭР огноогоор бичигдэнэ
- Тооцоо цэвэр: `calculateFxRevaluation(foreignBalance, closingRate,
  carryingAmount)` (lib/cash/reconciliation.ts) — зөрүү нь ханшийн олз/гарз
- AI `run_fx_revaluation` нь гар ханш өгөөгүй үед тэгшитгэлийн огнооны албан
  ханшийг татна; олдохгүй бол `rate` параметр шаардана (зохиохгүй)

### 6. НӨАТ (VAT) — 10% — ХЭРЭГЖСЭН

Knowledge: `knowledge/01-онол-хууль-стандарт/tax/vat.md`, `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md`

```
Exclusive: Авлага = Нийт, Орлого = Нийт/1.1, НӨАТ өглөг = Нийт × 10/110
Тооцоо: payableVat = outputVat − inputVat
```

GL posting:
```
Борлуулалт: Dr 13110000 Авлага / Cr 51100000 Орлого + Cr 31410000 НӨАТ өглөг
Худалдан авалт: Dr Зардал + Dr 13620000 НӨАТ авсан / Cr 31000001 AP
Тооцоо: Dr 31410000 / Cr 13620000 / Cr 11000001 Банк (зөрүү)
```

Дараа сарын **10-нд** тайлан + төлбөр. Хоцорвол 0.1%/хоног.

Хэрэгжилт:

```
lib/vat/return.ts        Цэвэр логик (тесттэй): splitVat, applyInclusiveVatToLines,
                         computeVatReturn (сарын эргэлт: гаралт Cr−Dr, оролт Dr−Cr)
lib/vat/settings.ts      vat_settings loader (ratified-seed: 31410000/13620000, 10%)
lib/actions/vat.ts       getVatReturnData, createVatSettlementDraft (НООРОГ,
                         externalRef `vat-settlement:YYYY-MM` — сард нэг л удаа),
                         getVatLineDefaults (панелийн товчинд)
app/(dashboard)/vat/     Сарын тайлангийн хуудас (URL `period` парам cookie-г дарна)
```

- **Дансууд `vat_settings`-ээс** — кодод хатуу дугаар байхгүй; тохиргоо
  байхгүй бол default-аар мөр үүсдэг (ил, засварлагдахуйц)
- **АР/АП интеграци:** панелийн "НӨАТ 10% нэмэх" товч (exclusive, НӨАТ мөр
  нэмнэ/шинэчилнэ); AI `create_arap_invoice`-ийн `vatMode`
  (`exclusive`/`inclusive` — inclusive нь мөрүүдийг /1.1 болгож largest-line
  absorb бөөрөнхийллөөр НӨАТ ялгана). АР → 31410000 Cr, АП → 13620000 Dr
- **Тооцооны журнал** ЗААВАЛ ноорог (§9); буцаан авах үед оролтын үлдэгдэл
  дараа сард шилжинэ (гаралтын дүнгээр л offset хийнэ)

### 7. Цалин (Payroll) — Gross → Net — ХЭРЭГЖСЭН

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/`

Хэрэгжилт:

```
lib/payroll/calc.ts      Цэвэр тооцоолол (тесттэй, worked-example.md-тэй тулгасан):
                         НДШ cap (доод цалин × үржүүлэгч), ХАОАТ effective date-ээр
                         (2025 flat 10% / 2026 шатлал 10-15-20% + хөнгөлөлт),
                         buildPayrollJournalLines (Dr=Cr тэнцвэртэй)
lib/payroll/additions.ts Нэмэгдэл/олговрын ЦЭВЭР тооцоолол (тесттэй): илүү цаг
                         1.5× / амралтын өдөр 1.5× / баярын өдөр 2.0× / шөнө
                         +20% (ХЗ 103·106·107·108), өмнөх N сарын дундаж
                         (previousPeriodCodes, averageMonthlyEarnings),
                         ээлжийн амралт (ХЗ 109), ХЧТА тэтгэмж
lib/payroll/settings.ts  payroll_settings loader (данс, доод цалин, cap, татваргүй
                         босго, коэффициент, сарын ажлын өдөр, дундажийн сар)
lib/payroll/settings-input.ts  Тохиргооны ЦЭВЭР шалгалт (тесттэй): хуваагч 0
                         болохгүй, коэффициент ХУУЛИЙН доод хэмжээнээс доошгүй
lib/actions/payroll.ts   Ажилтан CRUD, calculatePayrollRun (мөр бүр дахин бодогдоно,
                         засвар хадгалагдана), createPayrollVoucher (НООРОГ,
                         externalRef `payroll:YYYY-MM` — сард нэг),
                         loadPayrollSettingsView / savePayrollCalculationSettings /
                         savePayrollAccountSettings
app/(dashboard)/payroll/ Цалин бодолт + Ажилтнууд + Тайлан + Тохиргоо
```

- **Дансууд `payroll_settings`-ээс** (default: доорх §7 схем) — кодод хатуу
  дугаар байхгүй; доод цалин/cap/татваргүй босго мөн тохиргооноос
- **Тохиргооны хуудас `/payroll/settings`** (Цалин → Тохиргоо, 2 таб):
  «Тооцоолол» — доод цалин, НДШ cap үржүүлэгч, татваргүй босго, сарын
  стандарт цаг, ажлын өдрийн норм, дундажийн сарын тоо, нэмэгдлийн 4
  коэффициент; «GL данс» — §7-ийн 7 роль + ХЧТА-ийн данс (сонголтоор).
  Шалгалт нь ЦЭВЭР (`validatePayrollSettings`): цагийн хөлс / өдрийн
  дунджийн ХУВААГЧ 0 болох, коэффициент хуулийн доод хэмжээнээс ДООШ орохыг
  ХОРИГЛОНО (дээгүүр тогтоож болно). Өөрчлөлт нь ДАРААГИЙН бодолтоос
  эхэлж үйлчилнэ — бодогдсон сарууд хадгалагдсан дүнгээрээ үлдэнэ
- **2026 татваргүй босго (800,000₮)** — `monthlyTaxFree` тохиргоо, default 0
  (хуулийн баталгаажуулалтын дараа хэрэглэгч идэвхжүүлнэ — 2026-updates.md)
- **GL журнал ЗААВАЛ ноорог** (§9: payroll post нягтланчийн баталгаажуулалт
  шаарддаг) — сарын эцсийн огноогоор, бусад суутгалтай бол 6 мөр

**Нэмэгдэл, олговрууд — АВТОМАТ бодолт + гар засвар (нэг дүрэм):**

Хэрэглэгч ЦАГ / ХОНОГ-оо л оруулна, дүн нь `lib/payroll/additions.ts`-ээр
АВТОМАТААР бодогдоно. Дүнг гараар дарж бичвэл тухайн мөрд «гар» тэмдэг
(`*Manual` багана) асаж, ДАРААГИЙН бодолт тэр дүнг **ХЭЗЭЭ Ч дарж бичихгүй**
(хэрэглэгчийн засвар давамгайлна). Тэмдгийг арилгах хоёр зам: (а) харгалзах
цаг/хоногийг өөрчлөх, (б) мөрийн ⟲ «Дахин автомат бодуулах» товч.

| Нэмэгдэл | Орц | Томьёо (default) |
|----------|-----|------------------|
| Илүү цаг | `overtimeHours` | цагийн хөлс × **1.5** × цаг (ХЗ 103) |
| Амралтын өдөр | `restDayHours` | цагийн хөлс × **1.5** × цаг (ХЗ 107) |
| Баярын өдөр | `holidayHours` | цагийн хөлс × **2.0** × цаг (ХЗ 108) |
| Шөнийн ажил | `nightHours` | цагийн хөлс × **0.2** × цаг — зөвхөн НЭМЭГДЭЛ (ХЗ 106) |
| Ээлжийн амралт | `vacationDays` | өдрийн дундаж × хоног (ХЗ 109) |
| ХЧТА тэтгэмж | `sickDays` | өдрийн дундаж × хоног × ажилтны тэтгэмжийн % |

- **Дундаж цалин** = өмнөх `averageEarningsMonths` (default 12) сарын БОДИТ
  олголтын дундаж; өдрийн дундаж = сарын дундаж / `monthlyWorkDays`
  (default 22). Түүхгүй ажилтанд үндсэн цалин суурь болж, `averageMonthsUsed`
  = 0 гэж ИЛ тэмдэглэгдэнэ — дүн зохиогдохгүй
- **Коэффициент бүр `payroll_settings`-ээс** (`overtimeMultiplier`,
  `restDayMultiplier`, `holidayMultiplier`, `nightBonusRate`) — байгууллага
  хуулиас ДЭЭГҮҮР тогтоож болно, кодод хатуу тоо байхгүй
- **ХЧТА-ийн хувь ЗОХИОГДОХГҮЙ:** `employees.sickBenefitPercent` хоосон бол
  тэтгэмж автоматаар бодогдохгүй (`computeSickBenefit` → null) — хэрэглэгч
  хувийг ажилтны картад оруулах эсвэл дүнг гараар бичнэ
- **ХЧТА тэтгэмж нь НДШ, ХАОАТ-ын сууринд ОРОХГҮЙ** (ХАОАТ хууль 24) — нийт
  олголтод нэмэгдэхгүй, зөвхөн ГАРТ ОЛГОХ дүнд нэмэгдэж GL-д тусдаа дебет
  мөр болно (`sickBenefitAccountNumber`, тохируулаагүй бол цалингийн зардал)

**НДШ хувь:**

| | Ажилтан | Ажил олгогч |
|--|---------|-------------|
| Тэтгэвэр | 8.5% | 8.5% |
| Тэтгэмж | 0.8% | 1.0% |
| Ажилгүйдэл | 0.2% | 0.2% |
| ЭМД | 2.0% | 2.0% |
| ҮОМШӨ | — | 0.8–3.0% |
| **Нийт** | **11.5% (тогтмол)** | **12.5–14.7%** |

Ажил олгогчийн хувь нь ажилтан бүрд **АО-НДШ % нэг нэгдсэн тоо**
(`employees.employerSiPercent`, суурь 11.7 + ҮОМШӨ) — кодод ҮОМШӨ тусдаа
задардаггүй. Салбарын жишиг: оффис 12.5 (default), барилга 13.2, уул уурхай
14.2–14.7.

**НДШ дээд хязгаар:** Доод цалин × 10 (2025: 792,000 × 10 = 7,920,000₮)

```js
siCap = minimumWage × 10
cappedBase = Math.min(totalEarnings, siCap)
employeeSI = cappedBase × 11.5%
employerSI = cappedBase × employerSiPercent   // АО-НДШ % (ҮОМШӨ багтсан)
taxableIncome = totalEarnings − employeeSI
netSalary = totalEarnings − employeeSI − pit − otherDeductions + sickBenefit
```

Нийт олголт (`totalEarnings`) = үндсэн олголт (цалин × ажилласан/ажиллавал
зохих цаг) + ээлжийн амралт + илүү цагийн нэмэгдэл + бусад нэмэгдэл.
ХЧТА тэтгэмж энд ОРОХГҮЙ (татвар, шимтгэлгүй).

**GL posting (7 мөр):**
```
Dr 72100000 Цалингийн зардал       — нийт олголт
Dr 72100002 НДШ зардал (ажил олгогч)
  Cr 31420000 НДШ өглөг            — ажилтан + ажил олгогч НДШ
  Cr 31430000 ХАОАТ өглөг
  Cr 31500001 Цалингийн өглөг      — гарт олгох цалин
```

Тайлагнал: НДШ дараа сарын **5-нд**, ХАОАТ дараа сарын **10-нд**.

### 8. Domain separation (guardrail)

- **IFRS treatment ≠ Татварын treatment** — ялгааг тодорхой тусгана
- **Цалингийн ХАОАТ ≠ Бизнесийн WHT** — андуурахгүй
- **Элэгдэл:** IAS 16 (дансны) vs татварын хуулийн хувь зөрүү → IAS 12 DTA/DTL

### 9. Human-in-the-loop (draft-first policy)

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/guardrails/human-in-the-loop.md`

- AI agent бичилт default-оор **ноорог** үүсгэнэ — хэрэглэгч баталгаажуулна
- Хэрэглэгч чатнаас "Шууд бичих" горим ИЛ сонгосон үед л тэнцсэн, ≤10M₮
  бичилт шууд батлагдана (`AI_POST_LIMIT_MNT`, lib/ai/tools.ts)
- Том дүн (>10M₮), period хаалт, payroll post → нягтланч баталгаажуулалт
  шаарддаг — post горимд ч ноорог үлдэнэ

### 9a. AI туслах — tool-use agent

AI чат, MCP, REST API гурвуул НЭГ tool давхаргаар (lib/ai/tools.ts, 114 core tool + custom/)
системийн бүх модульд ажиллана. Бүлгүүд:

| Бүлэг | Tools | Горим |
|-------|-------|-------|
| Үүсгэх | create_journal_voucher, create_arap_invoice, create_cash_transaction (applyTo-гоор нэхэмжлэхэд холбоно), create_inventory_movement, create_fixed_asset, pay_arap_document | ноорог (post горимд ≤10M шууд) |
| Засах/устгах | update_{journal_voucher,inventory_movement}, delete_{journal_voucher,cash_document,arap_document,inventory_movement,fixed_asset}, delete_counterparty (баримтгүй үед л), delete_inventory_item (хөдөлгөөн/АР-АП мөр/PO мөр/өртгийн бичилтгүй үед л), activate_fixed_asset, record_inventory_count | засах зөвхөн ноорог; устгах — ноорог аль ч горимд, батлагдсан зөвхөн post горим + ≤10M |
| Батлах/буцаах | post_{journal_voucher,cash_document,arap_document,fa_depreciation,cost_entries}, confirm_inventory_movement, reverse_{journal_voucher,cash_document,fa_depreciation}, settle_arap_offset (АР↔АП суутган тооцоо — MNT, нэг харилцагч), close_period, reopen_period | ЗӨВХӨН post горим + ≤10M (assertPostMode/assertPostLimit) |
| Мастер дата | create_{gl_account,counterparty,inventory_item,warehouse,cash_account}, update_{counterparty,inventory_item} | аль ч горимд |
| Сар хаалтын тооцоо | run_fa_depreciation, run_monthly_costing | ноорог үүсгэдэг тул аль ч горимд |
| Унших | list_* (9), get_journal_voucher, get_trial_balance, get_stock_balances, get_counterparty_balance (aging-тэй) | — |
| Тайлан | get_income_statement, get_balance_sheet, get_cash_flow, get_account_ledger — вэбийн тайлантай НЭГ цэвэр функц (lib/reports/) ашиглана; create_year_end_closing (жилийн хаалтын 3 ноорог, нэг жилд нэг л удаа) | тайлан унших аль ч горимд; хаалт ноорог үүсгэнэ |
| Batch | create_{counterparties,arap_invoices,cash_transactions,journal_vouchers}_batch, master data: create_{gl_accounts,inventory_items,employees,fixed_assets}_batch (max 100, partial success — Cowork анхны импорт), post_{arap_documents,cash_documents,journal_vouchers}_batch | create нь аль ч горимд, post нь post горимд |
| Тулгалт+урсгал | reconcile_modules (касс/АРАП/бараа/клиринг vs GL, шалтгаан+засвар зөвлөнө), get_workflow_guide (7 урсгалын зөв дараалал) | — |
| Нэвтрүүлэлт | get_onboarding_guide (section: overview/checklist/rules/phases/status) — `docs/deployment/onboarding.md`-ийн §2/§3/§4-ийг үгчлэн + байгууллагын шат (0–5) ба дараагийн алхам (`lib/onboarding/`); MCP `instructions` анх холбогдоход үүнийг заана | унших, аль ч горимд |
| НӨАТ | get_vat_return (сарын тайлан), create_vat_settlement (тооцооны ноорог, сард 1) | тайлан аль ч горимд; тооцоо ноорог үүсгэнэ |
| Сар хаалт | get_month_end_checklist (7 алхмын статус — вэб: Системийн хяналт → Сар хаалт `/close`) | аль ч горимд |
| Цалин | create_employee, run_payroll (бодолт+нэгтгэл), get_payroll_summary, create_payroll_voucher (GL ноорог, сард 1) | бүгд ноорог үүсгэдэг тул аль ч горимд |
| Хангамж | create/update/list/get_purchase_order, create_goods_receipt, create_ap_invoice_from_po, create_cost_allocation, get_landed_cost_summary — мөн `create_arap_invoice`-ийн `purchaseOrder` / мөрийн `purchaseOrderLineId`, `unitPrice`, `costComponentCode` өргөтгөл | үүсгэх/унших аль ч горимд; approve/close/cancel_purchase_order, confirm/reverse_goods_receipt, reverse_cost_allocation нь ЗӨВХӨН post горим + ≤10M |
| Мэдэгдэл | list_notifications (inbox — уншаагүй/бүгд), mark_notifications_read (ids угтвар эсвэл all) — §9d; system prompt-ийн dynamic context-д уншаагүй тоо + хамгийн ойрын татварын хугацаа | аль ч горимд (журнал үүсгэхгүй) |
| Ханш | sync_exchange_rates (муж + валютаар Монголбанкны ТҮҮХ татаж `exchange_rates`-д хадгална), get_exchange_rate (тухайн огнооны албан ханш — хадгалсан → татна → ШИДНЭ) | аль ч горимд (нийтийн лавлах, журнал үүсгэхгүй) |
| POS | get_pos_status, open_pos_shift, list_pos_sales, get_pos_sale, get_pos_sales_report (бараа/өдөр/кассчин/хэлбэр/харилцагч/дүрмээр, ахиуц) | аль ч горимд; create_pos_sale (нэг транзакц — АР+касс+зарлага+урьдчилсан COGS), return_pos_sale, close_pos_shift нь ЗӨВХӨН post горим + ≤10M (ноорог байхгүй — бодит мөнгөн үйлдэл) |

ID-тэй tools бүгд бүтэн эсвэл 6+ тэмдэгтийн угтвар ID хүлээнэ;
нэхэмжлэх documentNo болон externalRef-ээр ч олдоно. Lookup нь сүүлийн
500–1000 баримтын цонхонд хайдаг — хуучин баримтыг бүтэн ID-гаар өгнө.

**Idempotency (externalRef):** create_{journal_voucher,arap_invoice,
cash_transaction} нь externalRef (eBarimt ДДТД, банкны гүйлгээний ID) авдаг —
ижил ref-тэй хоёр дахь дуудлага ШИНЭ баримт үүсгэхгүй, байгааг нь буцаана
(`dedup`, batch-д "алгассан"). DB талд (user_id, external_ref) partial unique
index гурван хүснэгтэд бий. Давхардлыг create_counterparty нэр
(case-insensitive) + ТТД-гээр мөн шалгаж [CONFLICT] буцаана.

**Алдааны кодууд:** tool-ийн алдаа `[CODE] текст` форматтай —
COUNTERPARTY_NOT_FOUND (ойролцоо нэрс санал болгоно), COUNTERPARTY_AMBIGUOUS,
ACCOUNT_NOT_FOUND, CONFLICT, AMOUNT_LIMIT_EXCEEDED, DIRECT_MODE_REQUIRED г.м.

```
lib/ai/
├── models.ts          Provider-aware registry (anthropic: fable/opus/sonnet/haiku,
│                      openai: gpt-5.1/gpt-5/gpt-5-mini) + AiWriteMode
├── tools.ts           Tool JSON schema + executor-ууд — одоо байгаа server
│                      action-уудыг дуудна (шалгалт нэг газар); actionMarker
├── action-markers.ts  CLIENT-safe: [[EA_ACTION:{json}]] задлагч
├── openai.ts          OpenAI chat.completions adapter (fetch+SSE, function calling)
├── system-prompt.ts   Tool дүрэм + UI навигацийн зам ("энд дараад тэнд дарна")
└── crypto.ts          Түлхүүрүүд AES-256-GCM шифртэй (Anthropic + OpenAI)

app/api/ai/chat/route.ts   Agent давталт (MAX_TOOL_ROUNDS=8): Anthropic tool-use
                           stream эсвэл OpenAI adapter; action → маркер стримд
components/ai/ai-chat-view.tsx  Модель сонгогч (provider бүлэгтэй), Ноорог/Шууд
                           бичих toggle, ActionCard (панель нээнэ)
```

Хатуу дүрмүүд:

- Tool executor алдаа ШИДЭХГҮЙ — модельд монгол текстээр буцаана
- Данс normalize нь paste/Excel-тэй ИЖИЛ (`normalizePastedAccount`)
- Харилцагч/бараа/данс НЭРЭЭР олдохгүй эсвэл олон таарвал алдаа + жагсаалт
  буцаана — модель таамаглахгүй, лавлах tool эсвэл хэрэглэгчээс асуана
- Үүссэн объект `[[EA_ACTION:{json}]]` маркераар контентод хадгалагдана —
  түүхээс дахин ачаалахад ч картууд харагдана
- Модель/горимын сонголт `ai_settings`-д хадгалагдана; provider нь
  сонгосон моделиос тодорхойлогдоно; OpenAI-д PDF хавсралт дэмжигдэхгүй

### 9b. MCP server — гадны Claude клиентэд нээх

Цөм: `lib/mcp/server.ts` (streamable HTTP, stateless JSON-RPC POST) —
хоёр route хуваалцана:

```
/api/mcp           Bearer header (Claude Code CLI):
                   claude mcp add --transport http --scope user \
                     entry-accounting https://<domain>/api/mcp \
                     --header "Authorization: Bearer <token>"
/api/mcp/<token>   Token нь URL-д (fallback зам)
```

**OAuth 2.1 (custom connector-ийн үндсэн зам):** claude.ai / Cowork-ийн
"Connect" товч стандарт урсгалаар холбогдоно — цөм нь `lib/oauth/server.ts`:

```
/.well-known/oauth-authorization-server   RFC 8414 metadata (path-aware)
/.well-known/oauth-protected-resource     RFC 9728 (401-ийн WWW-Authenticate заадаг)
/api/oauth/register                       RFC 7591 DCR (public client, нууцгүй)
/oauth/authorize                          Consent хуудас (standalone, login redirect
                                          callbackUrl-тэй), PKCE S256 ЗААВАЛ
/api/oauth/token                          code + refresh grant (rotation)
```

- Бүх нууц (code/access/refresh) sha256 hash-аар `oauth_*` хүснэгтүүдэд;
  code нэг удаагийн, access 7 хоног, refresh rotation-тэй
- MCP-ийн `resolveApiToken` `eak_` (PAT) болон `eoat_` (OAuth) хоёуланг танина
- proxy matcher `.well-known`-ийг алгасдаг; login redirect callbackUrl дамжуулдаг

- **Нэвтрэлт:** Personal Access Token (`eak_...`, Тохиргоо → AI туслах →
  MCP холболт). DB-д зөвхөн sha256 hash (`api_tokens`); үүсгэхэд НЭГ л
  удаа бүтнээрээ харагдана; хэрэглэгч бүр дээд тал нь 5 token
- **Tools = чатын agent-тай ИЖИЛ давхарга** (`lib/ai/tools.ts`) — тусдаа
  логик ХОРИОТОЙ; шинэ tool нэмбэл хоёр замд зэрэг очно
- **Impersonation:** `runAsUser(userId, fn)` (lib/auth.ts, AsyncLocalStorage)
  — server action доторх `auth()` token-ий эзний session мэт хариулна.
  Cookie-той ердийн замд огт нөлөөгүй
- Бичилтийн горим нь чатын toggle-тэй НЭГ тохиргоо (`ai_settings.write_mode`)
- proxy.ts-ийн matcher `/api`-г алгасдаг тул энэ зам login redirect-д орохгүй

### 9c. Fork нэвтрүүлэлт, custom/ өргөтгөл, REST API

Баримт: `docs/deployment/README.md` (playbook), `docs/deployment/api-integration.md`,
`custom/README.md`, `custom/CLAUDE.md`.

- **Харилцагч = GitHub fork.** Core шинэчлэлт `upstream-sync.yml` PR-аар
  (`vX.Y.Z` tag → `release.yml` GitHub Release). Хувилбарын эх сурвалж
  `package.json` → `lib/version.ts`; `/api/health` → `{version, sha}`;
  `/settings/system` хуудас; MCP `serverInfo.version`; REST `X-Entry-Version`
- **custom/ гэрээ:** харилцагч ЗӨВХӨН `custom/`-д бичнэ, core `custom/`-д
  ХЭЗЭЭ Ч бичихгүй. Entrypoint `custom/index.ts` → `mergeCustomizations(...)`;
  interface `lib/custom/types.ts`; loader `lib/custom/loader.ts` (шалгалт
  `lib/custom/validate.ts`, тесттэй). Core нь custom/-ийн тодорхой багцын
  нэр/зам hardcode хийхгүй
- **Tool нийлбэр:** `AI_TOOLS` = core; `allAiTools()` = core + custom — чат,
  OpenAI adapter, MCP, REST БҮГД `allAiTools()` ашиглана. `executeAiTool`
  default → custom tool. Шинэ consumer нэмбэл `allAiTools()`
- **Мэдэгдлийн суваг** (фаз 2): `EntryCustomization.notificationChannels[]` —
  `NotificationChannel { key, label, deliver(ctx) }` (§9d); core Telegram-тай
  нэг sweep-ээр хүргэгдэнэ, тохиргооны матрицад автоматаар багана болно
- **Hook цэгүүд** (guardrail-ийн ДАРАА, транзакц дотор): `postVoucherCore` /
  `createVoucherCore(posted)` → `beforeJournalPost` (шидвэл rollback),
  commit + subledger sync дараа `afterJournalPost` (алдаа залгина);
  `closePeriod` → `beforePeriodClose` (`hook-rejected` код + reason). Hook
  байгаа хоригийг сулруулж ЧАДАХГҮЙ
- **Theme:** `app/globals.css` нь `ui-kit/tokens.css`-ийн ДАРАА
  `custom/theme.css` import хийнэ
- **REST API v1:** `lib/api/v1.ts` — `GET /api/v1/tools`, `POST
  /api/v1/tools/<name>`; MCP-тэй ижил `resolveApiToken` + `writeModeOf` +
  `runAsOrg` + rate limit; `[CODE]` алдаа → 422 `{ok:false, code, error}`.
  Тусдаа логик ХОРИОТОЙ — tool давхаргаар л
- **Deployment-ийн лиценз:** production нэвтрэлт `ENTRY_LICENSE` (Console-оос
  олгосон гарын үсэгтэй, appUrl-даа уягдсан token) шаардана — offline шалгалт
  `lib/licensing/license.ts`, олгогч `scripts/issue-license.mjs` (нууц түлхүүр
  repo-д байхгүй); `next dev`-д шалгалтгүй. Дэлгэрэнгүй docs/deployment/README.md
- **Харилцагчийн repo үүсгэх:** `.github/workflows/provision-customer.yml`
  (workflow_dispatch; Entry Console — тусдаа `entry-console` repo — үүнийг
  dispatch хийнэ). Харилцагч = topic `entry-customer`-тэй `entry-<slug>` repo;
  тохиргоо repo variables (`ENTRY_DISPLAY_NAME`, `ENTRY_APP_URL`). Template
  repo ХОРИОТОЙ (түүхгүй → sync merge хийгдэхгүй)
- **Cowork master data импорт:** `.claude/skills/master-data-import/SKILL.md`
  (repo-д tracked — `.gitignore` `.claude/*` + `!.claude/skills/`), загвар
  `docs/deployment/master-data/*.csv`. Дараалал: данс → харилцагч → бараа/
  агуулах → касс → ажилтан → ҮХ → АР/АП нээлт → бараа нээлт → нээлтийн журнал
  (НЭГ ноорог, `externalRef: opening-balance:<огноо>`) → тулгалт

### 9d. Мэдэгдлийн систем (Notifications) — фаз 0–2 ХЭРЭГЖСЭН

Баримт: `docs/notifications/00-proposal.md` (D1–D7 батлагдсан 2026-09-19).
Шинэ модуль биш — байгаа дохиог (аудит, нүүрний «Анхаарах», татварын
хуанли, лиценз/token) хэрэглэгчид ХҮРГЭДЭГ давхарга.

```
lib/notifications/
├── catalog.ts        Төрөл → категори, severity, шошго, default суваг (ЦЭВЭР)
├── types.ts          NotificationDraft, NotificationAudience (client-safe)
├── rules.ts          АУДИТ → мэдэгдлийн гүүрийн дүрэм (ЦЭВЭР, тесттэй)
├── attention.ts      «Анхаарах» дохионууд — НҮҮР + SCHEDULER НЭГ ЭХ (ЦЭВЭР, тесттэй)
├── recipients.ts     Гишүүд × audience → userId[] (эрхээр, actor хасна; тесттэй)
├── preferences.ts    channels JSON тайлбар (ЦЭВЭР, тесттэй)
├── emit.ts           Бичих цэг — dedupe upsert, mutedUntil/in-app шүүлт; ШИДЭХГҮЙ
├── bridge.ts         notifyFromAudit — logAuditEvent-ийн хажууд, entity-owner шийднэ
├── load-attention.ts Scheduler-ийн оролт (SQL count/min — П28)
├── scheduler.ts      runDailyNotifications — org × өдөр нэг удаа (notification_runs)
├── ticker.ts         In-process default scheduler (instrumentation.ts, 15 мин):
│                     өдрийн дүрмүүд (08:00 УБ-аас) + tick бүрд и-мэйлийн хүргэлт
├── email-plan.ts     И-мэйлийн хүргэлтийн ЦЭВЭР төлөвлөгч: instant / digest (цаг,
│                     өдөрт нэг) / off (тесттэй)
├── email-delivery.ts Resend-ээр хүргэнэ — emailedAt, digest булаалт
│                     (notification_runs job="digest", periodKey="<өдөр>:<userId>");
│                     илгээгч = нэхэмжлэхийн илгээгчтэй ИЖИЛ эрэмбэ (resolveInvoiceSender)
├── channel-delivery.ts Нэмэлт сувгууд (Telegram + custom/) — notification_deliveries
│                     (мэдэгдэл × суваг нэг мөр: deliveredAt / error / "skipped:…")
├── channels/telegram.ts Core Telegram суваг (TELEGRAM_BOT_TOKEN; webhook ШААРДАХГҮЙ —
│                     холболт getUpdates-аар: /start <код> → «Холболт шалгах»)
└── open-entity.ts    CLIENT: entityType → панель / href dispatcher

lib/custom/types.ts NotificationChannel { key, label, defaultEnabled?, deliver(ctx) →
                    "sent"|"skipped" } — EntryCustomization.notificationChannels[]
                    (validate: key ^[a-z][a-z0-9_]{1,31}$, core in_app/email/telegram-тэй
                    давхцахгүй; loader customNotificationChannels)
lib/actions/telegram-link.ts        start / verify / unlink (өөрийн тохиргоо)
lib/email/notification-template.ts  ЦЭВЭР загвар (тесттэй): subject-д ДҮН БАЙХГҮЙ
                                    (stripAmounts хамгаалалт), text + HTML
lib/actions/notifications.ts        list / unread count / markRead / markAllRead
lib/actions/notification-preferences.ts  get / save (upsert user×org)
app/api/cron/notifications/route.ts Bearer CRON_SECRET; ?job=daily|email|all; ?date=
scripts/run-notifications.ts        Гараар ажиллуулах (дүрэм + и-мэйл)
components/layout/notification-bell.tsx   Топбарын хонх (60 сек polling)
app/(dashboard)/notifications             Inbox (DataGridDynamic, FilterChips)
app/(dashboard)/settings/notifications    Тохиргоо: категори × (хонх Switch, и-мэйл
                                          select off/instant/digest), digest цаг, түр дуугүй
tests/notification-{rules,attention,recipients,email}.test.ts
```

Хатуу дүрмүүд:

- **Call site-д `emit` ГАР дуудахгүй.** Шинэ бичилтийн зам `logAuditEvent`
  дуудаж байвал мэдэгдэл автоматаар гүүрээр гарна — мэдэгдэл болгох эсэхийг
  ЗӨВХӨН `rules.ts`-д (entityType × action → төрөл, audience) нэмнэ
- **Анхаарлын/хугацааны дүрэм ЗӨВХӨН `attention.ts`-д** — нүүрний «Анхаарах»
  блок (`dashboardAlerts`) ба өдөр тутмын scheduler (`dailyNotificationDrafts`)
  хоёул нэг `attentionSignals`-аас; «хугацаа хэтэрсэн», «хуучирсан ноорог»
  (7 хоног), татварын шат (7/3/1/0), лиценз (30/7/1/0)-ийн тодорхойлолтыг
  хоёр газар давтахыг хориглоно
- **Мэдэгдэл ХЭЗЭЭ Ч шидэхгүй** (`emit`, `bridge`) — бичилт унахаас мэдэгдэл
  алдагдах нь дээр; tx дотор дуудагдвал ижил executor-оор бичигдэж хамт
  commit/rollback болно
- **dedupeKey ЗААВАЛ** — дүрмийн «байгалийн үе» (`tax:vat:2026-09:3`,
  `overdue:ar:2026-W41`, `close-due:2026-09`); unique INDEX
  `(organizationId, userId, dedupeKey)` — constraint биш (#5955)
- **Actor өөртөө мэдэгдэхгүй**; хүлээн авагч нь модульд ≥ түвшний эрхтэй
  гишүүд л (`selectRecipients` ↔ `lib/permissions.ts`); `doc.posted` зөвхөн
  ноорог үүсгэсэн хүнд (D4); `period.closed/reopened` бүх гишүүнд (D5)
- **Scheduler request scope-гүй:** `cookies()`, `revalidatePath()`,
  `getActiveOrg()` дуудахгүй — org параметрээр; «өнөөдөр» Улаанбаатараар.
  Идемпотент булаалт `notification_runs` (job, periodKey, org) unique —
  cron route, ticker, script гурвуул зэрэг дуудсан ч НЭГ л ажиллана
- **Хадгалалт:** уншсан 90, уншаагүй 180 хоног (D6) — өдрийн ажил цэвэрлэнэ
- **И-мэйл (D1):** default — хугацаа/аюулгүй байдал/хаалт instant, бусад
  digest (каталогийн `email`); хэрэглэгч категори бүрд off/instant/digest
  сонгоно. `emailedAt IS NULL` мөрүүд (3 хоногийн цонх) tick бүрд шалгагдана;
  instant ≤15 мин, digest хэрэглэгчийн `digestHour`-т өдөрт нэг. Гарчигт дүн
  бичихгүй; RESEND_API_KEY байхгүй бол суваг чимээгүй идэвхгүй (in-app хэвээр)
- **Фаз 2 дүрмүүд:** `doc.large_amount` (D2 — босго
  `company_settings.largeAmountAlertMnt`, default 10M₮; post/create_posted-д
  гүүр дүнг tx executor-оор уншина — commit-оос өмнөх мөр харагдана; эзэн/админд),
  `ai.drafts_created` (`executeAiTool` → `notifyAiDraft`: AI/MCP/REST-ээс ноорог
  үүсвэл модулийн ≥post гишүүдэд, actor хасна), `invoice.viewed` (нэхэмжлэхийн
  нээлттэй хуудас — аудитын үйл явдал биш тул шууд emit, ЦОРЫН ГАНЦ үл хамаарах),
  `bank.unmatched` (импортоос 3 хоног), `fx.reval_due` (сарын сүүлийн 3 хоног),
  `fx.rate_missing` (ажлын өдөр, МБ ханш алга), `stock.negative` (долоо хоног тутам)
- **Нэмэлт суваг:** tick бүрд `deliverPendingChannels` — суваг × мэдэгдэл нэг л удаа;
  тохиргоо категори бүрд `channels: { telegram: bool, <custom>: bool }`
  (`isChannelEnabled`, default = сувгийн `defaultEnabled`); Telegram холбоогүй
  хэрэглэгчид "skipped"
- Env: `CRON_SECRET` (cron route нээнэ, байхгүй бол 503; `?job=daily|email|channels|all`),
  `NOTIFICATIONS_TICKER=off` (in-process ticker унтраана), `RESEND_API_KEY` +
  `RESEND_FROM_EMAIL` (и-мэйл суваг), `TELEGRAM_BOT_TOKEN` (Telegram суваг)
- Фаз 3 (SSE realtime, web push/PWA, approval workflow) — саналын §8

### 10. Effective date (татвар/цалины тооцоололд)

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/guardrails/effective-date.md`

- Татварын хувь, НДШ, ХАОАТ bracket-ийг **огноогоор** lookup хийнэ
- Хамаарах огноогүй тооцоолол хийхгүй — хэрэглэгчээс асууна

---

## UI стандарт

### Дизайн токен — эх сурвалж

```
ui-kit/tokens.css          ← ЦОРЫН ГАНЦ ЭХ СУРВАЛЖ (:root = light, .dark = dark)
   ├─→ app/globals.css     @import — бүтэн систем эндээс авна
   └─→ ui-kit/preview.html статик preview (dev server хэрэггүй, WCAG контраст тооцно)
```

Өнгө/сүүдэр/радиус өөрчлөх бол **зөвхөн `ui-kit/tokens.css`**. Component дотор
hex/rgba бичихийг хориглоно. Заавар: [ui-kit/README.md](ui-kit/README.md).
Амьд component gallery: `/settings/ui-kit`.

### Өнгө аяс

```css
body: var(--ea-bg) | card: var(--ea-surface) | border: var(--ea-border)
primary: var(--ea-primary) | danger: var(--ea-danger) | success: var(--ea-success)
text: var(--ea-text-1) | secondary: var(--ea-text-3)
```

**Семантик өнгө — текст vs дэвсгэр:**

| Хэрэглээ | Токен | Шалтгаан |
|----------|-------|----------|
| ТЕКСТ (амжилт/аюул/анхааруулга) | `--ea-success-fg` / `--ea-danger-fg` / `--ea-warning-fg` | Суурь өнгө цайвар surface дээр 2.5–3.8:1 — AA давахгүй |
| Дэвсгэр, хүрээ, дүрс, chart | `--ea-success` / `--ea-danger` / `--ea-warning` | Дүүргэлтэд контраст шаардлага бага |

**Dark mode:** суурь нь тас хар (`--ea-bg: #000`), цэнхэр нь **зөвхөн accent**
(товч, линк, focus, сонгосон мөр). Цэнхэрийн ханалт 62% — тас хар дээр неон
гэрэлтэхээс сэргийлнэ. Контраст 8.17:1 (AAA).

### Таб ба шүүлтүүрийн chip

`components/ui/tabs.tsx` — хуудас доторх таб/шүүлтүүрийн **ЦОРЫН ГАНЦ**
хэрэгжилт; өөрийн tab markup бичихийг хориглоно:

- `<PageTabs size="sm|md" trailing={...} />` — доогуур зураастай хэсгийн таб
  (option бүр `disabled` дэмжинэ)
- `<FilterChips />` — дугуй статус шүүлтүүр (`count` тоолуур, `tone="warning"`)

Хэрэглэгдэж буй газрууд: AI тохиргоо, касс/бараа жагсаалт, дансны тохиргоо
(2 түвшин), өртгийн тохиргоо. Амьд жишээ: `/settings/ui-kit`.

### Popup / Modal

```
Overlay: rgba(0,0,0,0.4)
Content: #fff, border-radius 8px, box-shadow
Header: гарчиг + × товч | Footer: [Болих] [Хадгалах]
Хаах: × товч / Болих / overlay дарах / Esc
```

### Destructive үйлдэл

```
Устгах → confirm диалог: [Болих] [Устгах]
Ашиглагдсан данс устгах → анхааруулна
```

---

## Хүснэгтийн стандарт (AG Grid Community)

Бүх хүснэгтийн UI **AG Grid Community v35**-д суурилдаг. `<table>`, shadcn `<Table>`,
эсвэл custom CSS grid-ээр шинээр хүснэгт бичихийг хориглоно.

### Эх сурвалж файлууд

```
components/datagrid/
├── DataGrid.tsx          Wrapper (theme, keyboard, clipboard, undo/redo defaults)
├── DataGridDynamic.tsx   dynamic(ssr:false) — БҮХ callsite энийг import
├── ComboFilter.tsx       Багана шүүх combo фильтер
└── datagrid.css          Grid стайл

components/account/       Дансны нэгдсэн component-ууд (бүх модульд)
├── account-segment-picker.tsx  Идэвхтэй сегмент бүрд searchable dropdown
└── account-input.tsx           Гараар бичих + ⌄ товчоор сегмент picker popover

components/journal/
└── journal-lines-grid.tsx      Журналын мөрийн хүснэгт (Данс/Дт/Кт/Тайлбар) —
                                GL journal entry ашиглана, Cash/VAT/Payroll-д reuse

lib/grid/                 Туслах модулиуд (wrapper биш)
├── types.ts              ColumnTypeId, EaColDef, RowMeta, BatchPatch, HistoryEntry
├── registerGrid.ts       AG Grid module registry (DataGrid-аас л дуудна)
├── theme.ts              themeQuartz.withParams({...}) → --ea-* CSS vars
├── validators.ts         required, nonNegativeNumber, debitXorCredit, segmentCodeShape, accountExists, dateISO
├── formatters.ts         fmtMnt, parseMntInput, moneyValueFormatter, accountValueFormatter
├── columnTypes.ts        ColumnTypeId → Partial<ColDef> ЦОРЫН ГАНЦ бүртгэл
├── segments.ts           buildSegCode, parseSegParts, fmtAccountDisplay, normalizePastedAccount
├── clipboard.ts          processClipboardData (TSV + сегмент-аатай account column танина)
└── editors/
    ├── SegSelect.tsx                Portal-mounted searchable dropdown
    ├── AccountSegmentEditor.tsx     Inline данс editor: гараар бичих + ⌄ сегмент panel
    │                                (AG Grid v32+: onValueChange-ээр commit, портал нь
    │                                ag-custom-component-popup class-тай байх ЁСТОЙ)
    ├── DebitCreditEditor.tsx        Number editor + Dr⊕Cr mutex
    └── SwitchCellRenderer.tsx       shadcn Switch нүднэнд

lib/store/grid-store.ts   Zustand factory: createGridStore<TData>(surfaceId, initial, capacity=100)
                          — patch-based undo/redo, buildBatch() → Server Action
```

### Column type registry

`lib/grid/columnTypes.ts` бол **шинэ column kind тодорхойлох цорын ганц газар**.
Surface-үүд compose хийдэг бөгөөд багана тус бүрд `valueParser` / `valueFormatter` /
alignment / editor зэргийг дахин зарлахгүй. Дэмжих kinds:

| `eaType` | Хэрэглээ |
|----------|---------|
| `text` | Текст редактор |
| `readonly-text` | Текст харагдах |
| `number-money` | MNT тоо, баруун зэрэгцүүлэлт, locale-tolerant parse |
| `readonly-money` | Тооцоо харагдах |
| `debit` / `credit` | DebitCreditEditor + mutex |
| `account-segment` | AccountSegmentEditor (popup) + valueFormatter |
| `date` | `YYYY-MM-DD` text editor |
| `switch` | SwitchCellRenderer (callback dispatch) |
| `select` | agSelectCellEditor |

### Keyboard / mouse contract

| Товч | Үйлдэл |
|------|--------|
| Нэг даралт | Нүдний мужийн ЗАНГУУ (Excel-маягийн сонголт эхэлнэ) |
| Shift+даралт | Зангуунаас тэгш өнцөгт муж сонгоно |
| Давхар даралт | Мөрийн дэлгэрэнгүй панель / edit mode (жагсаалтын grid бүрд) |
| Arrow keys | Нүд хооронд |
| Tab / Shift+Tab | Дараагийн / өмнөх editable нүд |
| Enter / Shift+Enter | Commit + доош / дээш |
| F2 | Edit mode эхлүүлэх |
| Esc | Edit-ийг буцаах / мужийн сонголтыг арилгах |
| Ctrl/Cmd+C / V / X | Copy (сонгосон муж → TSV) / Paste / Cut |
| Ctrl/Cmd+Z / Y | Undo / Redo |
| Delete | Сонгосон нүднүүдийг цэвэрлэх |

**Мужийн сонголт + copy (DataGrid built-in, бүх grid-д):** AG Grid
Community-д range selection байхгүй тул `DataGrid.tsx` дээр custom
хэрэгжсэн — нэг даралт зангуу, Shift+даралт муж, `ea-range-cell` класс
(багана бүрийн `cellClassRules`-д wrapper автоматаар шингээдэг),
Ctrl/Cmd+C нь мужийг TSV болгож clipboard-д тавина (тоон утга raw, бусад нь
formatted) — MS Excel-д шууд paste хийгдэнэ. Нэг агшинд нэг л grid-д
сонголт идэвхтэй. Мөрийн сонголт (batch үйлдэл) зөвхөн checkbox-оор —
`enableClickSelection` default false. **Дэлгэрэнгүй панель нээх нь ДАВХАР
даралт** — шинэ жагсаалтын grid нэмэхдээ `onCellDoubleClicked` /
`onRowDoubleClicked` хэрэглэнэ, нэг даралтад panel нээхийг хориглоно.

### Paste contract

- TSV / CSV — Excel, Sheets-ээс шууд хуулна
- Number нүднүүд `parseMntInput`-ээр `₮`, зай, таслал, цэгийг танина
- Account-segment баганад 10-part dotted ЭСВЭЛ active-only N-part код хүлээж авна
  (`normalizePastedAccount` нь идэвхгүй position-уудыг `SEG_DEFAULTS`-ээр padded)
- Алдаатай нүд улаан-border invalid тэмдэглэгдэнэ, paste-ийг REJECT хийхгүй

### Mutation contract

```
cell edit  →  DataGrid onCellValueChanged  →  setRows / store.applyPatches
add row    →  api.applyTransaction({ add }) + store.addRow({ isNew: true })
delete row →  store.removeRow(id)
save       →  store.buildBatch() → { create, update, delete: string[] } → Server Action
```

**Client-ээс DB-руу шууд хандахгүй.** Mutation болгон Server Action дайраад явна.

### Сегмент дүрэм (заавал биелүүлэх)

- Editor бүр **бүтэн 10-part dotted код** буцаана (`buildSegCode`-р).
- **Бүх сегмент бөглөгдөнө:** бичигдээгүй (идэвхгүй ЭСВЭЛ идэвхтэй ч
  сонгоогүй) сегмент **оронгийн тоогоор "0"** утга авна — `SEG_DEFAULTS` нь
  SEGMENT_DEFS-ийн length-ээс автоматаар гарна (S1="000", S2="000000"…).
  Онцгой: S3 үндсэн данс default-гүй (заавал сонгоно), S9="GL".
- Идэвхгүй байсан сегментийг идэвхжүүлэхэд хуучин дата "0…0" утгатайгаа
  шууд харагдана — migration хэрэггүй (parseSegParts хуучин хоосон хэсгийг
  ч default-аар уншина; DB-ийн хуучин код 2026-08-д нэг удаа 0-жүүлэгдсэн).
- Picker бүрд "Ерөнхий (default)" 0-сонголт автоматаар нэмэгдэнэ
  (`withSegDefaultOption`, S3-д үгүй).
- Read/display: `fmtAccountDisplay(code, activeSegIds)` идэвхтэй хэсгийг л
  үзүүлнэ; данс (S3) сонгогдоогүй бол бүхэлдээ хоосон.
- Paste/Excel/AI/MCP бүгд `normalizePastedAccount`-оор normalize хийнэ —
  хуучин форматын (хоосон хэсэгтэй) код мөн 0-жиж орж ирнэ.

### SSR

AG Grid module init үед `document` хэрэгтэй. Бүх surface `DataGridDynamic`-ийг
(`next/dynamic` `ssr:false`) ашиглана. Page-ууд Server Component хэвээр үлдэж
`rowData`-г prop-оор дамжуулна.

### Surface inventory

| Surface | Файл | Хэлбэр |
|---------|------|--------|
| Journal entry (бичих/засах) | [components/gl/journal-entry-form.tsx](components/gl/journal-entry-form.tsx) | `JournalLinesGrid` reuse — inline данс editor + Dr⊕Cr mutex + undo/redo |
| Journal lines grid (shared) | [components/journal/journal-lines-grid.tsx](components/journal/journal-lines-grid.tsx) | Дахин ашиглагдах мөрийн хүснэгт — pinned totals, clipboard, min-мөр хамгаалалт |
| Journal list | [components/gl/journal-list.tsx](components/gl/journal-list.tsx) | Read-only, dynamic row height, pagination. Мөр = `JournalListRow` (`lib/gl/journal-list-data.ts`): ваучер + эх баримтын (касс / АР/АП) харилцагч, валют, ханш + үүсгэсэн хэрэглэгч; Дт/Кт MNT ба валютаар (MNT ÷ ханш — лавлагаа, MNT баримтад хоосон), Дансны нэр багана. "Журналын нэр" = `description` |
| Мөнгөн гүйлгээний жагсаалт | [components/cash/cash-documents-view.tsx](components/cash/cash-documents-view.tsx) | Veritech "Харилцахын баримт"-тай ижил багана: Дансны код (мөнгөн дансны GL) · Валют · **Дебит дүн / Кредит дүн** (MNT — орлого Дт, зарлага Кт, шилжүүлэг хоёулаа) · Ханш · Дебит/Кредит /валют/ · Харилцагчийн код (`counterparties.code`) · Харилцагчийн нэр · Харилцах GL данс · Журналын дугаар · МГ код / МГ нэр (S8). Дт/Кт задаргаа ЦЭВЭР `lib/cash/list-columns.ts` (тесттэй) |
| Cash баримтын панель | [components/panel/cash-doc-panel.tsx](components/panel/cash-doc-panel.tsx) | `JournalLinesGrid` reuse (readOnly) — сегмент panel, харилцагч (код · нэр), МГ код · нэр, журналын дугаар, холбогдсон нэхэмжлэхийн линк, Батлах/Буцаах/Устгах |
| Accounts config | [components/gl/accounts-table.tsx](components/gl/accounts-table.tsx) | Inline switches, batch save, group headers |
| GL trial balance | [components/gl/gl-balance-view.tsx](components/gl/gl-balance-view.tsx) | Multi-header colGroup + pinned totals |
| Balance sheet / IS / Cash flow | [components/gl/report-grid.tsx](components/gl/report-grid.tsx) | Section / group / subtotal / total мөртэй flat row model |
| Өртгийн хяналт (C1/Орлого/Зарлага/C2) | [components/costing/cost-control-report.tsx](components/costing/cost-control-report.tsx) | **ТОГТМОЛ** 2 түвшний colGroup толгой (docs/cost §2.2) — дахин зохиогдохгүй; нэгж өртгийн багана нийлбэргүй |
| Гүйлгээний дэлгэрэнгүй + GL тулгалт | [components/costing/transaction-detail-report.tsx](components/costing/transaction-detail-report.tsx) | colGroup + `columnGroupShow: "open"` — задарч нэмэлт багана гаргана |
| Бүрэлдэхүүний задаргаа | [components/costing/component-analysis-report.tsx](components/costing/component-analysis-report.tsx) | Бараа × бүрэлдэхүүн, нэгжид нөлөө, хуваарилалтын лавлагаа |
| Зардлын хуваарилалт · чөлөөт (таб) | [components/costing/cost-allocation-view.tsx](components/costing/cost-allocation-view.tsx) | Сонголтын хүснэгт + хадгалахын өмнөх урьдчилсан хуваарь |
| Өртгийн модулийн хэсгийн таб | [components/costing/costing-section-tabs.tsx](components/costing/costing-section-tabs.tsx) | Олон route-ыг НЭГ нав цэс дор — `PageTabs`, огнооны параметрийг дагуулна, layout-д Suspense-тэй |
| Нягтлан бодох период | [components/periods/periods-view.tsx](components/periods/periods-view.tsx) | Хаах / дахин нээх, сар бүрийн бичилтийн тоо |
| Хангамжийн самбар | [components/procurement/procurement-dashboard.tsx](components/procurement/procurement-dashboard.tsx) | Түр дансдын үлдэгдэл, ноорог/нээлттэй/хаах боломжтой PO тоолол, сүүлийн захиалгууд |
| Худалдан авалтын захиалга | [components/procurement/purchase-orders-view.tsx](components/procurement/purchase-orders-view.tsx) | `FilterChips` статус шүүлтүүр + хүлээн авсан/нэхэмжилсэн % багана; давхар даралт → PO панель |
| Хүлээн авалт (GR) | [components/procurement/goods-receipts-view.tsx](components/procurement/goods-receipts-view.tsx) | Огноо/агуулах/МБ ханш/дүн; давхар даралт → хүлээн авалтын панель |
| Зардлын хуваарилалт · PO-ийн зардал (таб) | [components/costing/unallocated-costs-view.tsx](components/costing/unallocated-costs-view.tsx) | Нэхэмжлэхийн мөр × бүрэлдэхүүн worklist — хуваарилсан / үлдэгдэл MNT |
| Хангамжийн тайлан | [components/procurement/procurement-report-view.tsx](components/procurement/procurement-report-view.tsx) | Захиалгаар / Нийлүүлэгчээр таб — гүйцэтгэлийн дүн, валют бүрийн pinned нийт |
| Нийлүүлэгчийн карт | [components/procurement/supplier-card.tsx](components/procurement/supplier-card.tsx) | Харилцагчийн бүртгэлээс уншина (PO-д хадгалахгүй) + нээлттэй өглөг, өмнөх захиалга |
| АР/АП мөрийн хүснэгт (shared) | [components/arap/arap-lines-grid.tsx](components/arap/arap-lines-grid.tsx) | `arap-doc-panel.tsx`-ээс ЗӨӨСӨН — `mode` prop (`arap` / `po_invoice` / `goods_receipt`), Нэгж үнэ + Бүрэлдэхүүн багана |
| Харилцагчийн сонгогч (shared) | [components/arap/counterparty-select.tsx](components/arap/counterparty-select.tsx) | АП ба PO панель хоёулаа ҮҮНИЙГ хэрэглэнэ — давхардсан сонгогч бичихгүй |
| Хавсралтын жагсаалт (нийтлэг) | [components/attachments/attachment-list.tsx](components/attachments/attachment-list.tsx) | Зөвхөн ui-kit (`Button`, `IconAction`, `StatusBadge`, `EmptyState`, `useConfirm`) — шинэ icon бичихгүй |
| POS кассын дэлгэц | [components/pos/pos-checkout-view.tsx](components/pos/pos-checkout-view.tsx) | Сагсны grid (Тоо/Үнэ/Хөнг %/Хөнг ₮ editable, хасах үлдэгдэл улбар шар), баркод/хайлт, `quotePosSale` debounce 250мс, F9/F2/F6/Esc, түр хадгалалт localStorage |
| POS төлбөрийн диалог | [components/pos/payment-dialog.tsx](components/pos/payment-dialog.tsx) | Хэлбэрийн товчнууд, мөр бүрд дүн/лавлагаа/бэлгийн карт/кредит, хурдан бэлэн, Төлсөн/Үлдэгдэл/Хариулт (`roundToCashUnit`) — server `planPayments` эрх мэдэлтэй |
| POS борлуулалтын жагсаалт | [components/pos/sales-list-view.tsx](components/pos/sales-list-view.tsx) | `FilterChips` статус + Борлуулалт/Буцаалт, огнооны муж (URL → cookie), давхар даралт → `pos-sale` панель |
| POS ээлж / Z-тайлан | [components/pos/shifts-view.tsx](components/pos/shifts-view.tsx) | Ээлжийн grid, нээх/хаах диалог (`shift-dialogs.tsx`), тоолсон vs системийн бэлэн, зөрүү |
| POS тохиргоо | [components/pos/pos-settings-view.tsx](components/pos/pos-settings-view.tsx) | 3 дэд таб: дансны роль/хязгаар · төлбөрийн хэлбэр grid · хөнгөлөлтийн дүрэм grid (`discount-rule-dialog.tsx`) + симуляци |
| Борлуулалтын тайлан | [components/pos/sales-report-view.tsx](components/pos/sales-report-view.tsx) | 6 таб (хураангуй/бараа/өдөр/кассчин/хэлбэр/харилцагч+дүрэм) — COGS суурь `final`/`provisional` ил, pinned нийт |
| POS борлуулалтын панель | [components/panel/pos-sale-panel.tsx](components/panel/pos-sale-panel.tsx) | Read-only мөрийн grid (хөнгөлөлт, НӨАТ, буцаасан, урьдчилсан COGS), төлбөр/буцаалт/холбоос, Буцаалт диалог, Дахин хэвлэх |

---

## Excel импорт/экспортын стандарт

Excel-тэй харилцах БҮХ зам нэг стандартаар явна — шинэ импорт/экспорт нэмэхдээ
өөр parser/dialog зохиохгүй, доорх хэсгүүдийг compose хийнэ.

### Эх сурвалж файлууд

```
lib/excel/
├── import-spec.ts   Цэвэр логик (тесттэй): ImportSpec<T>, parseMatrix,
│                    parseAmountCell (₮/зай/таслал), parseDateCell (round-trip)
├── specs.ts         Спек үйлдвэрүүд: journalLinesSpec, arapLinesSpec,
│                    journalVouchersSpec + groupVoucherRows
└── core.ts          Client тал (exceljs dynamic import): readWorkbookMatrix,
                     downloadWorkbook, downloadTemplate(spec)

components/excel/excel-import-dialog.tsx   Нийтлэг диалог (аль ч спекээр)
lib/actions/journal-import.ts              Багц журнал → НООРОГ (server шалгалттай)
```

### Хатуу дүрмүүд

- **Багана НЭРЭЭР танигдана** (байрлалаар БИШ) — том/жижиг үсэг, зай, `*`
  хамаарахгүй; илүүдэл багана үл тоомсорлоно; заавал багана дутвал
  headerError болж юу ч орохгүй
- **Мөр бүр тусдаа шалгагдана**, алдаа нь Excel-ийн мөрийн ДУГААРТАЙГАА
  урьдчилан харах хүснэгтэд гарна. **Зөвхөн зөв мөрүүд орно** — алдаатай мөр
  хэзээ ч чимээгүй орохгүй
- **Загвар файл спекээсээ үүснэ** (`downloadTemplate`) — толгой, жишээ мөр,
  "Заавар" хуудас parser-аас зөрөх боломжгүй
- **Дансны нүд paste-тай ИЖИЛ normalize** — `normalizePastedAccount` (бүтэн
  10-part, active-only N-part, эсвэл ганц 8 оронтой код); идэвхтэй данс мөн
  эсэхийг спек + server хоёулаа шалгана
- **Багц журнал НООРОГ болж үүснэ** (human-in-the-loop §9); server action
  данс/период/мөрийн тоог ДАХИН шалгаж баримт бүрд тусдаа амжилт/алдаа буцаана
- **Экспорт нь импортын загвартай ижил баганатай** (журналын экспорт →
  багц импортын толгой + Статус) — round-trip ажиллана
- Client-ээс DB-руу шууд хандахгүй — импортын бичилт Server Action-аар

### Одоогийн integration-ууд

| Газар | Импорт | Экспорт |
|-------|--------|---------|
| Журнал бичих форм (footer) | Мөрүүд (`journalLinesSpec`) | — |
| Журналын жагсаалт (toolbar) | Багц журнал (`journalVouchersSpec` → draft) | Шүүгдсэн журнал мөрөөрөө |
| АР/АП баримтын панель (мөрийн footer) | Мөрүүд + бараа/агуулах кодоор (`arapLinesSpec`) | — |
| АР/АП баримтын жагсаалт | — | Шүүгдсэн баримтууд |
| Ажилтнууд (toolbar) | Ажилтан (`employeesSpec` — РД таарвал шинэчилнэ) | Жагсаалт загвартай ижил баганаар + загвар татах |

---

## DB өгөгдлийн бүтэц (Drizzle / PostgreSQL)

Бүх хүснэгт `userId`-аар хамгаалагдсан (нэг хэрэглэгч = нэг компани).
Дэлгэрэнгүйг `lib/db/schema.ts`-ээс уншина — доор нь зөвхөн бүлэглэл.

```
Цөм        users, chart_of_accounts, segment_configs, segment_values,
           module_configs, accounting_periods
             segment_values.linkedOrganizationId — S1/S6-ийн утга аль
               байгууллагаас автоматаар бүрдсэн бэ (§3a); null = гараар оруулсан
GL         journal_vouchers, journal_lines, document_counters
             journal_vouchers.documentNo — ЖУРНАЛЫН БИЧИЛТИЙН ДУГААР
               "<МОДУЛЬ>-<YY>-<NNNNNN>" (§2a); хуучин бичилтэд NULL
             document_counters (organization_id, scope) — дугаарын АТОМИК
               тоолуур; scope = "GL-26" г.м.
             journal_lines.costEntryId / inventoryMovementId — дэд дэвтрийн
             эх сурвалж (Source → Movement → Cost → GL мөр → Журнал)
             journal_lines.businessObjectType / businessObjectId — клирингийн
             түлхүүр (PO), бичих МӨЧИД тавигдана
Cash       cash_accounts, cash_documents, bank_statements,
           bank_statement_lines, cash_fx_revaluations
             cash_documents.counterpartyId — харилцагчийн БҮРТГЭЛИЙН холбоос
               (задаргаа: код/РД + нэр); `counterparty` текст нь нэр (бүртгэлгүй
               харилцагчид ч бичигдэнэ). Холбох дараалал `resolveCashCounterparty`
               (lib/actions/cash.ts): ил ID → нэхэмжлэхийн харилцагч → чөлөөт
               нэрээр ЯГ таарсан бүртгэл (`matchCounterpartyByName`, олон
               таарвал холбохгүй — ХОЛБООС ЗОХИОХГҮЙ). Банкны хуулга импорт мөн
               ижил дүрмээр холбоно. Харилцагч устгагдвал set null, нэр үлдэнэ
             cash_documents.cashFlowCode — МГ код (S8); МГ нэр нь segment_values(8)-ээс
               уншигдана, баримтад хадгалагдахгүй (нэр солигдвол дагана)
             cash_account_period_balances — хаалтын үлдэгдэл (дансны валютаар),
               период хаахад бичигдэж дахин нээхэд устдаг (snapshot + delta), exchange_rates
             exchange_rates — НИЙТИЙН лавлах: organizationId БАЙХГҮЙ (ханш нь
               нийтийн баримт), unique INDEX (source, currency, date) —
               constraint биш, drizzle-kit #5955-ийн улмаас (§5b); source
               mongolbank|tdb|golomt, date = ханшийн ӨӨРИЙН огноо (RATE_DATE),
               fetchedAt = хэзээ татсан (§5b)
             fx_revaluations.closingRate / rateSource / rateBasis / sourceDate /
               manualOverrideReason — тэгшитгэлийн ханшийн баримт
AR/AP      counterparties, ar_ap_documents, ar_ap_document_lines,
           ar_ap_settlements
             documents.purchaseOrderId — PO-той нэхэмжлэх (→ өглөгийн түр данс)
             lines.purchaseOrderLineId / unitPrice / costComponentId
               (CHECK: itemId ба costComponentId зэрэг байж болохгүй)
             counterparties.code — ХАРИЛЦАГЧИЙН КОД: РД/ТТД-ээс ТУСДАА, org дотор
               давтагдашгүй (partial unique index, хоосон = давхардал биш),
               `normalizeCounterpartyCode` (ТОМ үсэг, ≤32) — автомат дугаарлалт
               ХИЙХГҮЙ (гараар / импортоор оноогдоно). Кассын "Харилцагчийн код"
               багана, AI list/create/update_counterparty, master data CSV (`code`)
             counterparties.contactPerson / bankName / bankAccountNo
Хангамж    purchase_orders, purchase_order_lines, goods_receipts,
           goods_receipt_lines
             orders.status draft|open|closed|cancelled; closeVoucherId —
               түр дансдыг тэгшитгэсэн хаалтын журнал
             receipts.exchangeRate / rateSource / rateDate — хүлээн авсан
               өдрийн Монголбанкны албан ханш (барааны өртөг ҮҮГЭЭР)
             receipt_lines.movementId — үүсгэсэн орлогын хөдөлгөөн
Хавсралт   document_attachments — polymorphic (entityType: `purchase_order`,
           `goods_receipt`, `journal`, `cash`, `arap`, `inventory`, `fa` —
           аудитын entityType-тай ижил; whitelist
           lib/attachments/constants.ts ATTACHMENT_ENTITY_MODULE_KEYS),
           файл base64-аар, FK байхгүй тул устгалтыг модулийн delete зам
           deleteAttachmentsFor-оор ӨӨРӨӨ хийнэ; унших зам ЗААВАЛ org +
           модулийн эрхийн шалгалттай (арап нь ar/ap аль нэг эрхээр)
Inventory  inventory_items, warehouses, inventory_movements
             items.salesPrice — борлуулах үнэ (MNT, нэгжид, null = тогтоогоогүй):
               АР нэхэмжлэхэд бараа сонгоход нэгж үнэ автоматаар (байхгүй бол
               сүүлийн АР мөрийн unitPrice); өртөгтэй ХОЛБООГҮЙ, үнэ зохиохгүй
             movements.issueTypeId — зарлагын дебет чиглэл
             movements.sourceType `po_receipt` — хүлээн авалтын мөрөөс үүссэн
POS        pos_settings (рольын данс, walkInCounterpartyId, issueTypeId,
           provisionalCogs, allowNegativeStock, хөнгөлөлтийн хязгаар, бөөрөнхийлөл),
           pos_payment_methods (kind × cashAccountId), pos_discount_rules,
           pos_shifts, pos_sales, pos_sale_lines (arApLineId / movementId /
           provisionalCostEntryId), pos_sale_discounts, pos_payments,
           pos_gift_cards, pos_store_credits; inventory_categories,
           item_price_history; inventory_items.salesPrice/barcode/vatMode…;
           counterparties.customerGroup/creditLimit; vat_settings.isVatPayer;
           ar_ap_documents / cash_documents .sourceType ("pos") + sourceId;
           cost_entries.trueUpOfEntryId, valuationSource "provisional_avg",
           entryType "cogs_true_up" (ТЭМДЭГТЭЙ дүн)
Costing    cost_components, inventory_issue_types, costing_account_settings,
           costing_item_settings, cost_allocations, cost_allocation_lines,
           costing_runs, cost_entries, cost_period_results
             account_settings.apClearingAccountNumber — өглөгийн түр дансны
               шинэ роль (default 31000099)
             cost_entries.sourceLineId + businessObjectType/Id;
               valuationSource `po_receipt` | `ap_line`
             cost_allocations.sourceLineId / purchaseOrderId — нэхэмжлэхийн
               мөрөөс хийсэн хуваарилалт (Σ ≤ мөрийн MNT дүн)
FA         fixed_assets, fa_depreciation_entries
VAT        vat_settings
Payroll    employees, payroll_settings, payroll_runs, payroll_run_lines
Audit      audit_events — статус шилжилт бүрд lib/audit.ts logAuditEvent
           (бизнесийн урсгалыг хэзээ ч унагахгүй); /settings/audit хуудас
Мэдэгдэл   notifications (хүлээн авагч × org, dedupeKey unique INDEX,
           readAt, emailedAt), notification_preferences (user × org, channels
           JSON, mutedUntil, telegramChatId/LinkCode), notification_runs (job ×
           periodKey × org unique — scheduler/digest булаалт),
           notification_deliveries (мэдэгдэл × суваг unique) — §9d;
           company_settings.largeAmountAlertMnt (D2 босго)
AI         ai_messages, ai_attachments, ai_settings
Тайлан     report_line_mappings
```

Migration: `npx drizzle-kit generate` → `npx drizzle-kit push`

⚠️ `drizzle-kit push` нь одоо байгаа DB-тэй diff хийдэг. Урьд нь шууд SQL-ээр
хэрэгжүүлсэн хүснэгтүүд бий тул generate-ийн гаргасан файл бүхэлдээ
ажиллуулбал "already exists" гэж унана — шинэ DDL-ийг л хэрэглэнэ.

⚠️ **`db:push` нь `--force`-той (deploy-ийн preDeploy энийг дууддаг).** Энгийн
`drizzle-kit push` нь unique constraint нэмэх, багана хасах зэрэг "data loss"
өөрчлөлт дээр ИНТЕРАКТИВ асуулт тавьдаг — Railway-ийн non-TTY preDeploy дээр
crash хийж, схемийн БҮХ өөрчлөлт DB-д ОГТ ОРОХГҮЙ үлддэг (дараа нь код шинэ
баганыг асуухад "column does not exist" 500 алдаа өгнө). `--force` бүх
өөрчлөлтийг автоматаар зөвшөөрнө — **гэхдээ хүснэгт truncate хийж болзошгүй**
(одоо байгаа мөр дээр unique constraint нэмэх г.м.). Railway нөөцлөлт
(DAILY/WEEKLY) идэвхтэй байх ЁСТОЙ. Бодит production өгөгдөлтэй GA-д
`drizzle-kit generate` + `migrate` (батлагдсан migration файл) руу шилжинэ —
push нь dev/pilot-д зориулагдсан.

⚠️ **Схемд `unique()` constraint бичихийг ХОРИГЛОНО — зөвхөн
`uniqueIndex("…_ux")`.** drizzle-kit 0.31.x нь DB-д БАЙГАА unique constraint-ыг
танихгүй тул push бүрд "нэмэх үү, truncate хийх үү?" гэж дахин асууж non-TTY
preDeploy-г унагаана (#5955 — composite ба баганы түвшний аль алинд). Unique
INDEX нь `pg_indexes`-ээс зөв танигдаж, ижил баталгаа өгнө.

⚠️ **`public` схемд өргөтгөлийн view байвал push мөн унана** — схемд
зарлагдаагүй view бүрийг DROP хийх гэж оролдоод
`cannot drop view pg_stat_statements_info because extension … requires it`
гэж таслагдана. Тиймээс `scripts/apply-pending-ddl.mjs` нь
`pg_stat_statements`-ийг `extensions` схем рүү зөөж (search_path-д нэмнэ),
үлдсэн public view-үүдийг логт ил бичдэг.

## Анхдагч дансны мэдээлэл

| Дугаар | Нэр |
|--------|-----|
| 11210000 | Касс |
| 11000001 | Харилцах данс |
| 51100000 | Борлуулалтын орлого |
| 61100000 | Үндсэн үйл ажиллагааны зардал |

---

## Knowledge Base — хэзээ, юу уншихыг

**Нягтлан бодох логик нэмэхийн өмнө холбогдох файлыг заавал уншина. Татварын хувь, account code, IFRS дүрмийг дур мэдэн таахгүй.**

| Нөхцөл | Унших файл |
|--------|-----------|
| **Өртгийн логик (ЗААВАЛ)** | `docs/cost/README.md` → `01`…`04` → `docs/cost/CLAUDE.md` |
| **Хангамж / PO (ЗААВАЛ)** | `docs/procurement/00-proposal.md` → `01-implementation-contract.md`; батлагдсан шийдвэр `docs/cost/README.md` 0.6, норматив §11 FR-PROC-006…012 |
| **POS (ЗААВАЛ)** | `docs/pos/00-proposal.md` → `01-implementation-contract.md`; батлагдсан шийдвэр `docs/cost/README.md` 0.8 |
| Account код, GL posting template | `knowledge/02-нягтлан-бодох-мэргэжлийн/01-gl-posting-matrix.md` |
| Period close workflow | `knowledge/02-нягтлан-бодох-мэргэжлийн/02-period-close.md` |
| Журнал бичих workflow | `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/journal-entry.md` |
| НӨАТ тайлан workflow | `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md` |
| Цалингийн workflow | `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/payroll-run.md` |
| Цалин, НДШ тооцоолол | `knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/` |
| IFRS стандарт | `knowledge/01-онол-хууль-стандарт/ifrs/_index.md` → тухайн файл |
| Татварын хууль | `knowledge/01-онол-хууль-стандарт/tax/_index.md` → тухайн файл |
| 2026 татварын шинэчлэлт | `knowledge/01-онол-хууль-стандарт/tax/2026-updates.md` |
| Дансны нэгдсэн жагсаалт | `knowledge/03-стандарт/chart-of-accounts.md` |
| Тайлангийн mapping (BS / IS / CF) | `knowledge/03-стандарт/reports/01-line-mapping.md` |
