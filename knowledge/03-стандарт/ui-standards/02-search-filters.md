# 02. Хайх ба шүүлтүүрийн стандартууд

> **Эх код:** `frontend/web/src/components/common/`
>
> Entry-д хайх / шүүх 6 төрлийн стандарт компонент байна. Шинэ дэлгэц зурахдаа тэдгээрийн нэгийг сонгож ашиглана. Custom хайлтын input хэвлэх хориотой.

---

## 1. Компонентуудын ерөнхий жагсаалт

| # | Компонент | Зорилго | Файл |
|---|-----------|---------|------|
| 1 | Global search | StandardTable доторх free-text хайлт | `StandardTable.tsx` |
| 2 | Column filter popover | Excel-маягийн multi-select per-column | `StandardTable.tsx` дотор `<ColumnFilterDropdown>` |
| 3 | `<CalendarRange>` | Огнооны хязгаар (from → to) | `CalendarRange.tsx` |
| 4 | `<CalendarSingle>` | Нэг огноо | `CalendarSingle.tsx` |
| 5 | `<PeriodSelector>` | PTD/YTD/QTD + жил + период | `PeriodSelector.tsx` |
| 6 | `<SegmentAccountInput>` | 10-сегментийн дансны код picker | `SegmentAccountInput.tsx` |
| 7 | `<SegmentFilter>` | 10 сегмент тус бүрд from/to range | `SegmentFilter.tsx` |
| 8 | `<SegmentFilterPopover>` | SegmentFilter-ийн popover wrapper | `SegmentFilterPopover.tsx` |

---

## 2. Global search (StandardTable дотор)

**Layout:** Toolbar баруун талд `<Input size="sm" w="200px">` — placeholder `t('tbl_search')`.

**Зан үйл:**
- Бүх `colDefs[].key`-д `String(row[key]).toLowerCase().includes(s)` шалгана.
- `onChange`-д шууд (debounce ❌) ажиллана. Page → 1 reset.
- URL state-д хадгалагдахгүй (зөвхөн runtime).

**Хэзээ ашиглах:** Жагсаалт хуудас, free-text шалгах боломжтой ямар ч хүснэгтэд.

---

## 3. Column filter popover

**Layout:** Header-доор тусдаа `<Tr>` мөр гарна (зөвхөн `filterable: true` багана-д). `<HStack>`: text input + dropdown ChevronDown товч.

**Text input:** `colFilters[key]` — contain match, real-time.

**Dropdown (Excel-style):**
- Popover content `w="240px"`, glass styling: `bg = useColorModeValue('white', 'gray.700')`.
- Дотор: `<Input>` (search) + `All / Clear` link товч + `<VStack maxH="200px">` checkboxes.
- Unique values нь `data`-аас auto-collect, `localeCompare(numeric: true)` sort.
- "OK (N)" товч → apply + close. Selection.size === 0 бол filter remove.

**State:** `filterSelections: Record<string, Set<string>>` — empty Set = бүгд харагдана.

---

## 4. `<CalendarRange>` — огнооны хязгаар

**Props:**

```ts
type Props = {
  range: DateRange | undefined  // { from?: Date, to?: Date }
  onChange: (range: DateRange | undefined) => void
}
```

**Layout:** `<HStack>` — `<Input w="130px">` + `→` + `<Input w="130px">`.

**Format:** `yyyy-MM-dd` (date-fns). Хоосон утгыг зөвшөөрнө.

**Validation:** invalid date → `borderColor: red.400`. `onBlur` эсвэл `Enter` дарж commit.

**Glass tokens:**
| Property | Light | Dark |
|----------|-------|------|
| `bg` | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.06)` |
| `borderColor` | `rgba(148,163,184,0.35)` | `rgba(255,255,255,0.14)` |
| `backdrop-filter` | `blur(14px) saturate(160%)` | (same) |

**Хэрэглээ:** Filter bar, report parameter section.

---

## 5. `<CalendarSingle>` — нэг огноо

**Layout:** ганц `<Input w="130px">` + Calendar icon товч → popover `<DayPicker>` (react-day-picker).

**Props:** `value: Date | undefined`, `onChange: (Date | undefined) => void`.

**Glass tokens:** CalendarRange-той ижил.

**Хэрэглээ:** Form талбар (invoice_date, due_date), as-of-date report.

---

## 6. `<PeriodSelector>` — PTD/YTD/QTD + период

**Зорилго:** Санхүүгийн тайлан / dashboard-д "Энэ сар, тэр квартал, оноос YTD" гэсэн санхүүгийн period mode-ыг ганц компонентоор хариуцна.

**Props:**

```ts
interface PeriodSelectorProps {
  year: number
  onYearChange: (y: number) => void
  periodNum: number          // 1..12 (period_num)
  onPeriodChange: (p: number) => void
  periods: GLPeriod[]        // useGLPeriods() hook-аас
  mode: BalanceMode          // 'PTD' | 'YTD' | 'QTD'
  onModeChange: (m: BalanceMode) => void
  periodLabel?: string       // тэмдэг "MAR-26"
  compact?: boolean          // spacing хуруу
}
```

**Layout:** `<HStack>` — `[Mode▾]` + `[Year]` + `[Period▾]` + `(optional Period badge)`.

| Field | Width | Type |
|-------|------:|------|
| Mode | 90px | Select: PTD / YTD / QTD |
| Year | 80px | Input number |
| Period | 120px | Select (period_num → period_name) |
| Badge | auto | Chakra `<Badge colorScheme="blue">` |

**Mode семантик:**

| Mode | Утга | Жишээ |
|------|------|-------|
| PTD | Period-to-date — зөвхөн сонгосон сар | "2026-04 балланс" |
| YTD | Year-to-date — оны эхнээс сонгосон сар хүртэл | "2026-01..2026-04 нийлбэр" |
| QTD | Quarter-to-date — улирлын эхнээс | "2026-04..2026-04 хэрэв Q2 эхэлсэн" |

**Backend-тэй харилцах:**
- `mode + year + periodNum`-ийг API query param-аар дамжуулна.
- Backend нь `gl_period_balances` (PTD), `gl_year_balances` (YTD), `gl_quarter_balances` (QTD) хүснэгтээс уншна.

**Glass tokens:** CalendarRange-тэй ижил `bg`/`borderColor`/`backdrop-filter`.

**Хэзээ ашиглах:** Trial Balance, Balance Sheet, Income Statement, GL детал тайлан, Cash Flow report — period-aware ямар ч report.

---

## 7. `<SegmentAccountInput>` — 10-сегмент данс picker

**Зорилго:** Entry-ийн 10-сегмент дансны код (37 тэмдэгт) бичих/сонгоход зориулсан inline picker. Сегмент тус бүр өөрийн lookup table-тэй холбогдоно.

**Props:**

```ts
interface SegmentAccountInputProps {
  defaultValue: string         // "001.000000.11210000.00.0000.000.0000.0000.10.0"
  onCodeChange: (newCode: string) => void
  isDisabled?: boolean
  module?: string              // 'gl' | 'ar' | 'ap' | 'fa' | 'cost' | 'cash'
}
```

**Module филтер:** `module="ar"` бол зөвхөн `segments` хүснэгтэд `is_ar=true` гэж тэмдэглэсэн сегментүүд харагдана. Бусад сегмент анхдагч утга (ихэнхдээ '0...')-аар үлдэнэ.

**Layout — inline ComboBox per segment:**

```
┌─[s1: 001 ▾]─[s2: 000000 ▾]─[s3: 11210000 ▾]─[s4: 00 ▾]─...─[s10: 0]─┐
                                       ↓
┌─ Popover ─────────────────────────┐
│ 🔍 [search code/name...]          │
│ 11210000  Bank — MNT current     │ ← клик хийсэн зэргээр сонгоно
│ 11210001  Bank — USD current     │
│ ... (max 50 row, virtualized)    │
└────────────────────────────────────┘
```

**Сегмент ASCII:**
- s1 (Company) — 3 char
- s2 (Cost Center) — 6 char
- s3 (Main Account) — 8 char ← гол данс
- s4 (Product/Service) — 2 char
- s5 (Project) — 4 char
- s6 (ICT) — 3 char
- s7 (RPT — нэгдсэн тайлангийн код) — 4 char
- s8 (Cash Flow) — 4 char
- s9 (Module) — 2 char
- s10 (Future) — 1 char

> Дэлгэрэнгүй: `knowledge/03-стандарт/segment-strategy.md` ба `knowledge/03-стандарт/account-structure.md`.

**Modal mode:** Том сегмент (>200 row) бол inline combo-той зэрэгцэн "..." товчаар full Modal үүснэ — багана ихтэй table харах боломжтой.

**API endpoints:**
- `GET /api/segments/definition` — нийт 10 сегментийн metadata
- `GET /api/segments/:key/options?module=ar&q=...` — autocomplete options
- `GET /api/segments/:key/default` — default placeholder utga

---

## 8. `<SegmentFilter>` — 10 сегмент range шүүлтүүр

**Зорилго:** Тайлан хайхад "С1=001..010, С3=11000000..19999999" гэх мэт **бүх 10 сегментэд from/to range** оруулах compact panel.

**Props:**

```ts
type Props = {
  onChange: (filters: Segment[]) => void
}

type Segment = {
  segment: number
  name: string
  from: string
  to: string
  length: number
}
```

**Layout — glass card panel:**

```
┌─ glass panel ───────────────────────────────────────────────┐
│ Сегмент     Нэр              From          To               │
│ ──────────────────────────────────────────────────────────  │
│ 1           Company         [001    ]    [999    ]          │
│ 2           Cost Center     [000000 ]    [999999 ]          │
│ 3           Main Account    [00000000]   [99999999]         │
│ ... (10 rows)                                               │
│                                                             │
│ [Reset]  [Apply]                                            │
└────────────────────────────────────────────────────────────┘
```

**Validation:** Numeric only (regex `\D` хасна), `length`-ийн дотор автомат `slice`. `from > to` бол warning.

**Glass tokens:**
- Panel: `backdrop-filter: blur(10px)`, border `1px solid rgba(255,255,255,0.15) (dark) / #ccc (light)`, `border-radius: 12px`, `padding: 16px`.
- Input: light `rgba(0,0,0,0.05)`, dark `rgba(255,255,255,0.15)`.

**Wrapper:** `<SegmentFilterPopover>` — toolbar товч → Popover-ийн дотор `<SegmentFilter>` суулгана.

**Хэзээ ашиглах:** Trial Balance, GL detail, Consolidation report — segment-level фильтр шаардсан тайлан.

---

## 9. Хайх / шүүлтүүрийн хэв маяг (style guide)

| Property | Утга |
|----------|------|
| Input/Select height | `32px` (sm) — Entry-ийн toolbar default |
| Spacing | `<HStack spacing={2}>` (compact: `1`) |
| Glass background light | `rgba(255,255,255,0.55)` |
| Glass background dark | `rgba(255,255,255,0.06)` |
| Glass border light | `rgba(148,163,184,0.35)` |
| Glass border dark | `rgba(255,255,255,0.14)` |
| `backdrop-filter` | `blur(14px) saturate(160%)` |
| Border radius | `md` (Chakra default) |
| Invalid border color | `red.400` |

---

## 10. URL state convention

Жагсаалт хуудсууд шүүлтүүрийн төлөвийг **URL query-д** хадгална (back-button friendly):

| Шүүлтүүр | Query param | Жишээ |
|----------|-------------|-------|
| Огноо range | `from`, `to` | `?from=2026-01-01&to=2026-04-30` |
| Foreign key (single) | `<entity>_id` | `?customer_id=abc123` |
| Multi-select status | `status` | `?status=draft,posted` |
| Module/source | `module` | `?module=AR,CASH` |
| Period mode | `period`, `mode` | `?period=4&mode=YTD` |
| Free text | `q` | `?q=invoice123` |

> Дэлгэц анхны mount үед URL-аас уншиж filter state-ийг сэргээнэ. Filter өөрчлөгдсөн үед `router.replace(...)` гэж URL шинэчилнэ (history stack-д хуурамч entry бичихгүй).

---

## 11. Шалгалт

- [ ] Custom date input ашиглаагүй — `<CalendarRange>` / `<CalendarSingle>` дуудаж байгаа эсэх
- [ ] Custom data filter input биш `<StandardTable>`-ийн built-in column filter ашигласан эсэх
- [ ] Account picker нь `<SegmentAccountInput>` ашигласан, hardcoded text input биш эсэх
- [ ] Period-зориулсан тайлан нь `<PeriodSelector>` ашигласан эсэх
- [ ] Filter URL-д persist хийгдэж байгаа эсэх (refresh-хад филтер арилахгүй)
- [ ] Glass tokens light/dark хоёулаа ажиллаж байгаа эсэх
