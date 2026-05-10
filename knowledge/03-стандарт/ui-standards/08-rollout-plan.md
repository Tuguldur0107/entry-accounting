# 08. Стандартыг нэвтрүүлэх төлөвлөгөө (Rollout Plan)

> **Статус:** 2026-05-03 байдлаар codebase-ийг гүн скан хийсний үр дүнд төлөвлөгөө боловсруулсан.
>
> **Зорилго:** Entry-ийн 19 модулийн **бүх UI**-ийг §01-07 спекүүдтэй 100% нийцтэй болгох (StandardTable, filter components, glass theme, i18n, popups, conventions).

---

## 1. Одоогийн төлөв (audit 2026-05-03)

### 1.1 StandardTable нэвтрэлт

| Module | ✅ Std | ❌ Raw | Compliance |
|--------|------:|------:|:----------:|
| settings | 10 | 0 | **100%** |
| agis | 4 | 2 | 67% |
| fa | 5 | 4 | 56% |
| inv | 10 | 10 | 50% |
| gl | 3 | 4 | 43% |
| ap | 2 | 3 | 40% |
| cost | 2 | 3 | 40% |
| payroll | 2 | 3 | 40% |
| receivables | 2 | 3 | 40% |
| Cash | 2 | 4 | 33% |
| pos | 3 | 6 | 33% |
| agents | 0 | 3 | 0% |
| ar (legacy) | 0 | 1 | 0% |
| Dashboard | 0 | 1 | 0% |
| reports | 0 | 25 | **0%** ← Гол хариулт |
| wallet | 0 | 3 | 0% |
| **Нийт** | **45** | **75** | **37.5%** |

> 75 файл raw `<Table>` ашиглаж байна — Reports модуль (25 файл) ба Inventory (10 файл) хамгийн эрсдэлтэй.

### 1.2 Бусад нийцлийн зөрчил

| Зөрчил | Тоо | Severity | Гол газар |
|--------|----:|:--------:|----------|
| Raw `<Input type="date">` | 87 instances / 48 files | High | reports/, gl/provisions, inv/production, fa/lease |
| `confirm()` / `alert()` (raw) | 25 | **High** | admin/errors, cost/drivers, cost/rules, inv/bom, fa/lease |
| StandardTable `storageKey` дутуу | 53 / 112 instances | Medium | cost/rules, inv/bom, inv/production, fa/lease, receivables/revenue |
| i18n key gap (keys.ts vs ALL_LANGS) | 29 keys | Medium | mn/en/zh/ru-д орчуулга дутуу |
| Hardcoded JSX strings | ~400-500 / 90 pages | Medium | ColDef labels, toast titles, Th headers |
| `<option>` raw labels | ~20+ | Low | gl/chart_of_accounts, settings |
| Tooltip `hasArrow` дутуу / hardcoded label | 11 | Low | agents chat, agis txns |
| Test ChakraProvider дахин init | 1 (тест зөвшөөрөгдсөн) | Low | – |
| `useColorModeValue` `.map()` дотор | **0** | – | (clean ✅) |
| Production-д ChakraProvider дахин init | **0** | – | (clean ✅) |

### 1.3 Эерэг олдвор

- `useColorModeValue` `.map()` дотор анти-паттерн **байхгүй**.
- `settings/` модуль 100% StandardTable — рефренсээр ашиглах боломжтой.
- 4 хэлийн i18n файл синк (бүгд 2816 entries).

---

## 2. Дуусгах шалгуур ("Definition of Done" per page)

Шинэ эсвэл шинэчилсэн жагсаалтын хуудас дараах **8 шалгуурыг** бүгдийг хангасан байх:

- [ ] **#1** `<StandardTable>` ашигласан, raw `<Table>` биш
- [ ] **#2** `storageKey` өгсөн, naming standard дагасан (`<module>_<page>_<table>`)
- [ ] **#3** `colDefs[].isNumeric / filterable / groupable` тохиргоо зөв
- [ ] **#4** `<CalendarRange>` / `<CalendarSingle>` / `<PeriodSelector>` / `<SegmentAccountInput>` — raw inputs ашиглаагүй
- [ ] **#5** Бүх UI string `t('key')`-аар бичигдсэн, `keys.ts` + 4 хэлд орчуулсан
- [ ] **#6** `confirm()/alert()` биш `<AlertDialog>` ашигласан
- [ ] **#7** Loading / Error / Empty 3 төлөв тус бүрд handler өгсөн
- [ ] **#8** `<StatusBadge>`, glass tokens, `useColorModeValue` дээд хэсэгт дуудсан

---

## 3. 6-долоо хоногийн фазалсан төлөвлөгөө

### Phase 0 — Foundation (Week 1) — 5 өдөр

**Зорилго:** Бэлтгэл болон tooling. Дараагийн фаз бүрд блок болж буй техникийн өрийг арилгана.

| # | Даалгавар | Effort | Шалгалт |
|---|-----------|:------:|---------|
| 0.1 | i18n key gap (29 missing) — `keys.ts`-ийн дутуу 29 key-г 4 хэлийн файлд нэмэх | 0.5d | `i18n.test.ts` ногоон |
| 0.2 | ESLint rule бичих — raw `<Table>`, `confirm()/alert()`, `<Input type="date">`, `useColorModeValue` `.map()` дотор зэргийг warn-болгох | 1d | `npm run lint` warn-уудыг үзүүлнэ |
| 0.3 | Codemod бэлдэх (jscodeshift) — `<Input type="date">` → `<CalendarSingle>` autoreplace template | 1d | Dry-run report |
| 0.4 | StandardTable storage key registry бүтээх (`knowledge/03-стандарт/ui-standards/07-table-inventory.md` жагсаалттай 1:1 шалгах script) | 0.5d | grep кодноос duplicate илрүүлнэ |
| 0.5 | `<ConfirmDialog>` reusable component үүсгэх (АлертDialog wrapper, t() integrated) — 25 confirm() сольж болохуйц API-той | 1d | unit test |
| 0.6 | StorybookOpinion / Visual regression baseline снап (Phase 1-2-ын регрессийг хянах) | 1d | Chromatic / Percy кит-апаар |

**Acceptance Phase 0:** ESLint rule идэвхтэй; codemod-ыг pilot 1 файл дээр амжилттай ажиллав; ConfirmDialog компонент published.

---

### Phase 1 — Critical bug-fix wave (Week 2) — 5 өдөр

**Зорилго:** Хэрэглэгчид direct effect-тэй HIGH severity зөрчлийг арилгах.

| # | Даалгавар | Effort | Файл тоо |
|---|-----------|:------:|---------:|
| 1.1 | 25 `confirm()/alert()` → `<ConfirmDialog>` сольж замаар нь i18n-тэй болгох | 2d | 25 файл |
| 1.2 | 53 missing `storageKey` нөхөх (table inventory-ийн нэрийн дагуу) | 1d | 53 файл |
| 1.3 | 29 keys.ts gap — translation тогтоох (Mongolian эх + 3 хэл орчуулга) | 1.5d | 4 хэл |
| 1.4 | Tooltip `hasArrow` standardize + 4 hardcoded label-ийг t() болгох | 0.5d | 11 файл |

**Acceptance Phase 1:**
- `git grep "window.confirm\|window.alert"` 0 case (тест файлаас бусад).
- `<StandardTable>` бүхэн `storageKey` props-тэй (codebase-ийн grep ✅).
- `i18n.test.ts` бүх 4 хэлд key gap үлдээгүй.

---

### Phase 2 — StandardTable migration (Weeks 3-4) — 10 өдөр

**Зорилго:** 75 raw `<Table>` файлыг бүгдийг `<StandardTable>` болгох. Module priority-аар захиалж reference module-ыг сурахчилж явна.

#### Week 3 — High-volume modules (40 файл)

| Module | Файл | Effort | Зөвлөмж |
|--------|------|:------:|---------|
| **reports** (25) | balance-sheet, business-combinations, consolidation, eps, equity-method, general-ledger, income-statement, segments, trial-balance + 16 component | 5d | Хамгийн өндөр concentration. Report-уудад `colDefs`-аар pivot хэлбэртэй болгоно. Каталог §07/14-аар reference. |
| **inv** (10) | bom, counting/{new,view}, dashboard, landed-costs, on-hand, production, transaction/new, transfer/{new,view} | 3d | Form pages-ийн дотор inline grid → editable mode V1.07-д. Одоогийн scope-д read-only conversion. |
| **pos** (6) | page (cashier), dashboard, on-hand, rfid, sales, settings | 1d | RFID legacy — V1.07-д хасах |
| Cash (4) | cash_dashboard, reconciliation, reports, settings | 1d | Reconciliation-ийн 2-pane грид нь Phase 4 V1.07 candidate (cell-mode) |

**Daily checkpoint:** Өдрийн эцэст PR-аас 5-7 файл merge — visual regression тестийн ногоон байх ёстой.

#### Week 4 — Mid/low volume modules (35 файл)

| Module | Файл | Effort | Зөвлөмж |
|--------|------|:------:|---------|
| **fa** (4) | dashboard, lease, reports, settings | 1d | – |
| **gl** (4) | gl_dashboard, journals/{new,view}, provisions | 1d | journals/new — inline lines grid → cell-mode (Phase 4) |
| **agents** (3) | dashboard, MarkdownRenderer, ProposalCanvas | 0.5d | ProposalCanvas custom-аар үлдэх боломжтой (chat artifact) |
| **agis** (2) | transactions/{new, view} | 0.5d | – |
| **ap** (3) | ap_dashboard, InvoiceList/new, components/SupplierTable | 1d | – |
| **receivables** (3) | ar_dashboard, InvoiceList/new, revenue | 1d | revenue page — recurring schedule grid |
| **cost** (3) | drivers, reports, rules | 1d | – |
| **payroll** (3) | dashboard, reports, settings | 1d | runs/view bulk grid V1.07-д cell-mode |
| **wallet** (3) | wallet, topups, transactions | 0.5d | – |
| **ar** (1) + **Dashboard** (1) | CustomerTable, Dashboard/page | 0.5d | – |

**Acceptance Phase 2:**
- `git grep "from '@chakra-ui/react'" -- '*.tsx' | grep -E "Table|Tbody|Thead"` нь зөвхөн `StandardTable.tsx`-д үлдэнэ + form-summary-д үлдэх (data list биш).
- Compliance metric: 37.5% → **100%**.
- Каталог §07-д бүртгэлтэй 70+ хүснэгт бүрэн.

---

### Phase 3 — Filter components (Week 5) — 5 өдөр

**Зорилго:** 87 raw `<Input type="date">` болон бусад custom filter input-уудыг standard-тай болгох.

| # | Даалгавар | Effort | Файл |
|---|-----------|:------:|------|
| 3.1 | Codemod-аар 87 `<Input type="date">` → `<CalendarSingle>` / `<CalendarRange>` сольсон. Manual review-аар `from/to` хосыг range-д хувирган. | 2d | 48 файл |
| 3.2 | Report pages 9 (TB, BS, IS, GL detail, Equity, Segments, Eps, BC, Consol) — `<PeriodSelector>` + `<CalendarRange>` бүрэн нэвтрүүлэх | 1.5d | 9 файл |
| 3.3 | GL/AP report 4 газарт `<SegmentFilter>` нэмэх (одоо алга — segment-аар тайлан хайх боломж дутагдалтай) | 1d | 4 файл |
| 3.4 | URL query state convention хэрэгжүүлэх (`?from=&to=&period=&mode=` URL hashed routing) | 0.5d | 17 list pages |

**Acceptance Phase 3:**
- `git grep '<Input type="date"\|<input type="date"'` 0 case
- `git grep 'from "react-day-picker"'` зөвхөн `CalendarRange.tsx`, `CalendarSingle.tsx`-д үлдэнэ
- 9 report page бүгд `<PeriodSelector>`-той

---

### Phase 4 — i18n cleanup (Week 6) — 5 өдөр

**Зорилго:** ~400-500 hardcoded JSX string-ийг арилгах.

| # | Даалгавар | Effort | Зөрчлийн тоо |
|---|-----------|:------:|:-----------:|
| 4.1 | ColDef labels (171) — бүх `colDefs[].label`-д тохирох `col_<key>` translation бүртгэх | 1.5d | 171 |
| 4.2 | Toast titles (~30) — `toast({ title: t('toast_*') })` болгох | 0.5d | 30 |
| 4.3 | Form labels (FormLabel, placeholder) — i18n-аар бичих | 1d | ~80 |
| 4.4 | Th headers, button labels, error messages — t() болгох | 1.5d | ~150 |
| 4.5 | `<option>` element values — translation key + display label tax | 0.5d | 20+ |

**Tooling:** `eslint-plugin-i18next` нэмэх, hardcoded JSX literal-уудыг warn болгох.

**Acceptance Phase 4:**
- `git grep '[Ѐ-ӿ]'` (Mongolian Cyrillic) JSX-аас зөвхөн `.ts/.tsx` тестүүдээс бусад газар алга
- ESLint warn-ууд 50-аас доош (ишлэлийн "Entry", "₮" гэх мэт ердийн нэр-аас бусад)
- Бүх 4 хэл sync (key count тэгш)

---

### Phase 5 — V1.07 Excel-like features (Optional, Weeks 7-12)

**Зорилго:** `01-tables.md` §10.2-д бичсэн **20 Excel-маягийн зан үйл**-ийг StandardTable-д нэмэх.

#### Phase 5.1 — Foundation (Week 7-8)
- Active cell + range selection state machine (`selectionMode='cell|range'`)
- Keyboard navigation (Arrow / Tab / Enter / PgUp / PgDn / Home / End / Ctrl+Home/End)
- Status bar component (Σ / Avg / Min / Max / Count of selection)
- Banded rows toggle prop

#### Phase 5.2 — Editing (Week 9-10)
- `<CellEditor>` (F2 / dbl-click)
- `editableCols` prop + `onCellEdit` callback
- TSV copy (Ctrl+C) / paste (Ctrl+V)
- Multi-column sort (Shift+click)

#### Phase 5.3 — Polish (Week 11-12)
- Frozen first columns (`freezeCols={N}`)
- Conditional formatting + cell format types
- Find & Replace (Ctrl+F)
- Right-click context menu

> Phase 5 нь optional — Entry-ийн ердийн жагсаалт V1.06 баталгаажилтаар сэтгэл ханамжтай. V1.07-д **бөглөх грид pages** (Payroll runs/view, GL journals/new, Inv counting variance) дээр гол ач холбогдолтой.

---

## 4. Module-by-module mini-roadmap (Phase 1-3 нэгтгэсэн)

### 4.1 reports/ (хамгийн их ажил)
- 25 raw Table → StandardTable: **5 өдөр** (Phase 2 Week 3)
- 18 raw `<Input type="date">` → CalendarRange: 1 өдөр (Phase 3)
- `<PeriodSelector>` + `<SegmentFilter>` 9 хуудсанд: 2 өдөр (Phase 3)
- Hardcoded strings: ~80 (Phase 4)
- **Нийт: ~8 өдөр**

### 4.2 inv/ (form-heavy)
- 10 raw Table: 3 өдөр
- 4 raw date inputs: 0.5 өдөр
- BOM, production, counting form-уудын inline grid (read-only conversion): 1 өдөр
- Hardcoded strings: ~50 (BOM/Production)
- **Нийт: ~4.5 өдөр**

### 4.3 gl/
- 4 raw Table: 1 өдөр
- 5 raw date inputs (provisions, periods, journals/new): 0.5 өдөр
- gl/journals/new dynamic lines → editable inline grid (V1.07-д cell-mode)
- segmentOptions array hardcoded labels (chart_of_accounts): 0.5 өдөр
- **Нийт: ~2 өдөр**

### 4.4 fa/
- 4 raw Table: 1 өдөр
- 5 raw date inputs (lease, reports): 0.5 өдөр
- 3 confirm() (lease): 0.25 өдөр
- **Нийт: ~1.75 өдөр**

### 4.5 payroll/
- 3 raw Table: 1 өдөр
- 2 raw date inputs (runs/new): 0.25 өдөр
- runs/view bulk grid → V1.07 cell-mode (Phase 5)
- **Нийт: ~1.25 өдөр**

### 4.6 ap/, ar/, receivables/, cash/, cost/, agis/, pos/, wallet/, agents/, admin/
- Module бүрд 1-2 өдөр (доош хэлбэрээр Phase 1-3 task-уудыг batch-р)

---

## 5. Total effort summary

| Phase | Week | Effort | Файлын тоо |
|-------|------|:------:|:-----------:|
| 0. Foundation | W1 | 5d | – (tooling) |
| 1. Critical fixes | W2 | 5d | 53 + 25 + 11 = 89 файл touch |
| 2. StandardTable migration | W3-4 | 10d | 75 файл |
| 3. Filter components | W5 | 5d | 48 файл |
| 4. i18n cleanup | W6 | 5d | 90 page |
| **Sum (V1.06.x)** | **6 weeks** | **30d** | **~150 уникаль файл** |
| 5. Excel-like features (V1.07) | W7-12 | 30d | StandardTable internal |

**Хүний нөөц:** 1 senior frontend dev full-time → 6 долоо хоног.
**Эсвэл:** 2 dev paired (один phase-аар хуваарилах) → 3-4 долоо хоног.

---

## 6. Эрсдэл ба түүний бууруулалт

| Эрсдэл | Магадлал | Effect | Mitigation |
|--------|:--------:|:------:|------------|
| Visual regression report-д | Medium | High (CFO-д харагдана) | Phase 0-д snapshot тав; daily Chromatic diff review |
| StorageKey collision | Low | Medium (хэрэглэгчийн filter алга болно) | §07 Inventory-аас auth source; CI-д grep duplicate |
| i18n missed key | Medium | Low (English-р fall back) | `i18n.test.ts` mandatory pre-merge |
| Performance — StandardTable 10K row-той | Medium | Medium (slow render) | Virtualization (V1.07 — react-window) |
| User push-back over UX change | Low | Medium | Phase 1-2-ийн дараа feedback session, opt-out flag-аар preview |
| Confirm dialog-аас аливаа destructive үйлдэл алдагдсан | Low | High | ConfirmDialog rollback товчны smoke test |
| Train test data deletion | Low | High | Test environment-д тус тус run хийнэ; production database-д хэзээ ч rollout-аар буудалгүй |

---

## 7. Ширээн хяналт (tracking matrix)

CSV/Spreadsheet-д хадгалах:

```
Module,RawTables,Std Tables,RawDateInputs,Confirms,MissingStorageKey,HardcodedStrings,Status
reports,25,0,18,0,15,80,not started
inv,10,10,4,5,8,50,not started
pos,6,3,2,0,3,20,not started
...
```

Жижиг scaffolding script (`scripts/audit-standards-compliance.mjs`) нь дараах метрикүүдийг дахин хэмжинэ:
- Raw `<Table>` count per module
- Missing `storageKey` count
- `<Input type="date">` count
- `confirm()/alert()` count
- ColDef.label hardcoded ratio

CI-д weekly run хийж, dashboard-д үзүүлбэл progress visible байна.

---

## 8. Acceptance criteria — Rollout completion

V1.06.x complete гэж зарлаж болох нөхцөл:

- [ ] **#1** `<StandardTable>` нэвтрэлт ≥ 99% (test/legacy ChakraTable-аас бусад)
- [ ] **#2** `confirm()/alert()` 0 case
- [ ] **#3** `<Input type="date">` 0 case (`CalendarRange/CalendarSingle` 100%)
- [ ] **#4** Бүх `<StandardTable>` `storageKey`-той (`scripts/audit-...` 0 violation)
- [ ] **#5** i18n compliance ≥ 95% (key gap < 30, hardcoded JSX string < 50 ESLint warning)
- [ ] **#6** §07 каталог-д бүртгэлгүй хүснэгт алга (грид inventory ↔ codebase 1:1)
- [ ] **#7** Visual regression baseline-аас зөрсөн өөрчлөлт зөвхөн зорилготой (CFO/PM approve)
- [ ] **#8** PR template-д `Standards checklist`-ийг compulsory болгосон (`.github/pull_request_template.md`)

---

## 9. Дараагийн алхам

1. Энэ төлөвлөгөөг engineering team review (1 өдөр).
2. Phase 0-ийн tooling задрал жижиг task issue-аар backlog-д орсон.
3. PR template-д "Standards checklist (DoD)" нэмэх — Phase 0.5d-д орох.
4. Weekly sync (Friday) progress review — `audit-standards-compliance.mjs` тогооц.
5. Phase бүр дуусахад retro: "Юу удааширсан? — дараагийн phase-д юу хийх вэ?"

---

## 10. Хавсралт — Каталог-д бүх 75 raw Table файлын жагсаалт

(Phase 2-ын task-уудад 1:1 шилжихэд бэлэн.)

### reports (25)
- `app/modules/reports/balance-sheet/page.tsx`
- `app/modules/reports/business-combinations/page.tsx`
- `app/modules/reports/consolidation/page.tsx`
- `app/modules/reports/eps/page.tsx`
- `app/modules/reports/equity-method/page.tsx`
- `app/modules/reports/general-ledger/page.tsx`
- `app/modules/reports/income-statement/page.tsx`
- `app/modules/reports/segments/page.tsx`
- `app/modules/reports/trial-balance/page.tsx`
- `components/reports/ApBalanceTable.tsx`
- `components/reports/ApInvoicePaymentsTable.tsx`
- `components/reports/ApIssuedInvoicesTable.tsx`
- `components/reports/ApWhtReportTable.tsx`
- `components/reports/ArAgingEclTable.tsx`
- `components/reports/ArBalanceTable.tsx`
- `components/reports/ArInvoicePaymentsTable.tsx`
- `components/reports/ArIssuedInvoicesTable.tsx`
- `components/reports/CashFlowIndirect.tsx`
- `components/reports/CashFlowStatement.tsx`
- `components/reports/FairValueTable.tsx`
- `components/reports/HeldForSaleTable.tsx`
- `components/reports/ImpairmentTable.tsx`
- `components/reports/NrvCheckTable.tsx`
- `components/reports/TaxDepreciationTable.tsx`
- `components/reports/VatReportTable.tsx`

### inv (10)
- `app/modules/inv/bom/page.tsx`
- `app/modules/inv/counting/new/page.tsx`
- `app/modules/inv/counting/view/[id]/page.tsx`
- `app/modules/inv/dashboard/page.tsx`
- `app/modules/inv/landed-costs/page.tsx`
- `app/modules/inv/on-hand/page.tsx`
- `app/modules/inv/production/page.tsx`
- `app/modules/inv/transaction/new/page.tsx`
- `app/modules/inv/transfer/new/page.tsx`
- `app/modules/inv/transfer/view/[id]/page.tsx`

### pos (6)
- `app/modules/pos/page.tsx`
- `app/modules/pos/dashboard/page.tsx`
- `app/modules/pos/on-hand/page.tsx`
- `app/modules/pos/rfid/page.tsx` *(legacy V1.07-д хасах)*
- `app/modules/pos/sales/page.tsx`
- `app/modules/pos/settings/page.tsx`

### Cash (4)
- `app/modules/Cash/cash_dashboard/page.tsx`
- `app/modules/Cash/reconciliation/page.tsx`
- `app/modules/Cash/reports/page.tsx`
- `app/modules/Cash/settings/page.tsx`

### fa (4)
- `app/modules/fa/dashboard/page.tsx`
- `app/modules/fa/lease/page.tsx`
- `app/modules/fa/reports/page.tsx`
- `app/modules/fa/settings/page.tsx`

### gl (4)
- `app/modules/gl/gl_dashboard/page.tsx`
- `app/modules/gl/journals/new/page.tsx`
- `app/modules/gl/journals/view/[id]/page.tsx`
- `app/modules/gl/provisions/page.tsx`

### agents (3)
- `app/modules/agents/dashboard/page.tsx`
- `components/agents/chat/MarkdownRenderer.tsx`
- `components/agents/chat/ProposalCanvas.tsx`

### ap (3)
- `app/modules/ap/ap_dashboard/page.tsx`
- `app/modules/ap/InvoiceList/new/page.tsx`
- `components/ap/SupplierTable.tsx`

### receivables (3)
- `app/modules/receivables/ar_dashboard/page.tsx`
- `app/modules/receivables/InvoiceList/new/page.tsx`
- `app/modules/receivables/revenue/page.tsx`

### cost (3)
- `app/modules/cost/drivers/page.tsx`
- `app/modules/cost/reports/page.tsx`
- `app/modules/cost/rules/page.tsx`

### payroll (3)
- `app/modules/payroll/dashboard/page.tsx`
- `app/modules/payroll/reports/page.tsx`
- `app/modules/payroll/settings/page.tsx`

### wallet (3)
- `app/modules/wallet/page.tsx`
- `app/modules/wallet/topups/page.tsx`
- `app/modules/wallet/transactions/page.tsx`

### agis (2)
- `app/modules/agis/transactions/new/page.tsx`
- `app/modules/agis/transactions/view/[id]/page.tsx`

### Бусад (2)
- `components/ar/CustomerTable.tsx`
- `app/modules/Dashboard/page.tsx`

---

> **Эзэн:** Frontend lead (TBD).
> **Sponsor:** CTO.
> **Review cadence:** Weekly Friday sync, monthly executive update.
> **Rollback plan:** Phase бүр дараа feature flag-аар page-level toggle (`USE_LEGACY_TABLE=true` env override) — hot-fix боломжтой.
