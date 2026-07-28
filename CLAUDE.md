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
| Үндсэн хөрөнгө (FA) | ✅ | — |
| Period систем | ✅ | — |
| AI туслах (expert accountant) | ✅ | — |
| НӨАТ модуль | ❌ | ✅ |
| Цалингийн модуль (Payroll) | ❌ | ✅ |

## Файлын бүтэц

```
entry-accounting/
├── app/
│   ├── (auth)/login|register     # Нэвтрэх / бүртгүүлэх
│   ├── (dashboard)/
│   │   ├── layout.tsx            # Topbar + auth guard
│   │   └── gl/
│   │       ├── journal/          # Журналын жагсаалт
│   │       ├── accounts/         # Дансны тохиргоо
│   │       └── reports/          # GL тайлан
│   └── api/auth/[...nextauth]/   # NextAuth handler
├── components/gl/                # GL client components
├── lib/
│   ├── auth.ts                   # NextAuth config
│   ├── actions/gl.ts             # Server Actions
│   ├── actions/auth.ts           # Register action
│   ├── db/schema.ts              # Drizzle schema
│   ├── db/index.ts               # DB connection
│   └── store/gl-store.ts         # Zustand UI state
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

### 4. Period систем — ХЭРЭГЖСЭН

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/02-period-close.md`
Код: `lib/periods/period.ts` (цэвэр логик), `lib/periods/guard.ts`
(`assertPeriodOpen`), `lib/actions/periods.ts`, `app/(dashboard)/settings/periods`

- Период = хуанлийн сар, код нь `YYYY-MM`; `open` → `closed`
- **Бүртгэгдээгүй сар = НЭЭЛТТЭЙ.** Период мөр нь ХААЛТ хийхэд л үүсдэг тул
  хаалт хийж эхлээгүй систем саадгүй ажиллана
- Хаагдсан периодод бичилт хийх хориотой. Хамгаалалт орсон замууд: GL
  create/post/unpost/update, cash post/reverse, AR/AP post, FA элэгдэл
  post/reverse, өртөг post/reverse, зардлын хуваарилалт
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
├── component-analysis.ts Бүрэлдэхүүний задаргаа
└── costing.ts           Орлогын капитализаци + "үнэ хүлээж байгаа" жагсаалт
```

### 6. НӨАТ (VAT) — 10%

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

### 7. Цалин (Payroll) — Gross → Net

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/`

**НДШ хувь:**

| | Ажилтан | Ажил олгогч |
|--|---------|-------------|
| Тэтгэвэр | 8.5% | 8.5% |
| Тэтгэмж | 0.8% | 1.0% |
| Ажилгүйдэл | 0.2% | 0.2% |
| ЭМД | 2.0% | 2.0% |
| ҮОМШӨ | — | 0.8–3.0% |
| **Нийт** | **11.5%** | **12.5–14.5%** |

**НДШ дээд хязгаар:** Доод цалин × 10 (2025: 792,000 × 10 = 7,920,000₮)

```js
siCap = minimumWage × 10
cappedBase = Math.min(totalEarnings, siCap)
employeeSI = cappedBase × 11.5%
employerSI = cappedBase × (12.5% + accidentRate)
taxableIncome = totalEarnings − employeeSI
netSalary = totalEarnings − employeeSI − pit − otherDeductions
```

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

- AI agent бичилт **шууд хадгалахгүй** — draft үүсгэнэ, хэрэглэгч баталгаажуулна
- Том дүн (>10M₮), period хаалт, payroll post → нягтланч баталгаажуулалт шаарддаг

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

### Keyboard contract

| Товч | Үйлдэл |
|------|--------|
| Arrow keys | Нүд хооронд |
| Tab / Shift+Tab | Дараагийн / өмнөх editable нүд |
| Enter / Shift+Enter | Commit + доош / дээш |
| F2 | Edit mode эхлүүлэх |
| Esc | Edit-ийг буцаах |
| Ctrl/Cmd+C / V / X | Copy / Paste / Cut |
| Ctrl/Cmd+Z / Y | Undo / Redo |
| Delete | Сонгосон нүднүүдийг цэвэрлэх |

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
- Идэвхгүй сегмент `SEG_DEFAULTS` дунд `0`-р padded.
- Read/display: `fmtAccountDisplay(code, activeSegIds)` идэвхтэй хэсгийг л үзүүлнэ.
- Paste-д partial код ирэх боломжтой — `normalizePastedAccount`-оор normalize хийнэ.

### SSR

AG Grid module init үед `document` хэрэгтэй. Бүх surface `DataGridDynamic`-ийг
(`next/dynamic` `ssr:false`) ашиглана. Page-ууд Server Component хэвээр үлдэж
`rowData`-г prop-оор дамжуулна.

### Surface inventory

| Surface | Файл | Хэлбэр |
|---------|------|--------|
| Journal entry (бичих/засах) | [components/gl/journal-entry-form.tsx](components/gl/journal-entry-form.tsx) | `JournalLinesGrid` reuse — inline данс editor + Dr⊕Cr mutex + undo/redo |
| Journal lines grid (shared) | [components/journal/journal-lines-grid.tsx](components/journal/journal-lines-grid.tsx) | Дахин ашиглагдах мөрийн хүснэгт — pinned totals, clipboard, min-мөр хамгаалалт |
| Journal list | [components/gl/journal-list.tsx](components/gl/journal-list.tsx) | Read-only, dynamic row height, pagination |
| Accounts config | [components/gl/accounts-table.tsx](components/gl/accounts-table.tsx) | Inline switches, batch save, group headers |
| GL trial balance | [components/gl/gl-balance-view.tsx](components/gl/gl-balance-view.tsx) | Multi-header colGroup + pinned totals |
| Balance sheet / IS / Cash flow | [components/gl/report-grid.tsx](components/gl/report-grid.tsx) | Section / group / subtotal / total мөртэй flat row model |
| Өртгийн хяналт (C1/Орлого/Зарлага/C2) | [components/costing/cost-control-report.tsx](components/costing/cost-control-report.tsx) | **ТОГТМОЛ** 2 түвшний colGroup толгой (docs/cost §2.2) — дахин зохиогдохгүй; нэгж өртгийн багана нийлбэргүй |
| Гүйлгээний дэлгэрэнгүй + GL тулгалт | [components/costing/transaction-detail-report.tsx](components/costing/transaction-detail-report.tsx) | colGroup + `columnGroupShow: "open"` — задарч нэмэлт багана гаргана |
| Бүрэлдэхүүний задаргаа | [components/costing/component-analysis-report.tsx](components/costing/component-analysis-report.tsx) | Бараа × бүрэлдэхүүн, нэгжид нөлөө, хуваарилалтын лавлагаа |
| Зардлын хуваарилалт | [components/costing/cost-allocation-view.tsx](components/costing/cost-allocation-view.tsx) | Сонголтын хүснэгт + хадгалахын өмнөх урьдчилсан хуваарь |
| Нягтлан бодох период | [components/periods/periods-view.tsx](components/periods/periods-view.tsx) | Хаах / дахин нээх, сар бүрийн бичилтийн тоо |

---

## DB өгөгдлийн бүтэц (Drizzle / PostgreSQL)

Бүх хүснэгт `userId`-аар хамгаалагдсан (нэг хэрэглэгч = нэг компани).
Дэлгэрэнгүйг `lib/db/schema.ts`-ээс уншина — доор нь зөвхөн бүлэглэл.

```
Цөм        users, chart_of_accounts, segment_configs, segment_values,
           module_configs, accounting_periods
GL         journal_vouchers, journal_lines
             journal_lines.costEntryId / inventoryMovementId — дэд дэвтрийн
             эх сурвалж (Source → Movement → Cost → GL мөр → Журнал)
Cash       cash_accounts, cash_documents, bank_statements,
           bank_statement_lines, cash_fx_revaluations
AR/AP      counterparties, ar_ap_documents, ar_ap_document_lines,
           ar_ap_settlements
Inventory  inventory_items, warehouses, inventory_movements
             movements.issueTypeId — зарлагын дебет чиглэл
Costing    cost_components, inventory_issue_types, costing_account_settings,
           costing_item_settings, cost_allocations, cost_allocation_lines,
           costing_runs, cost_entries, cost_period_results
FA         fixed_assets, fa_depreciation_entries
AI         ai_messages, ai_attachments, ai_settings
Тайлан     report_line_mappings
```

Migration: `npx drizzle-kit generate` → `npx drizzle-kit push`

⚠️ `drizzle-kit push` нь одоо байгаа DB-тэй diff хийдэг. Урьд нь шууд SQL-ээр
хэрэгжүүлсэн хүснэгтүүд бий тул generate-ийн гаргасан файл бүхэлдээ
ажиллуулбал "already exists" гэж унана — шинэ DDL-ийг л хэрэглэнэ.

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
