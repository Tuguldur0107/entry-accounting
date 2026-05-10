# 01. Хүснэгтийн стандарт — `<StandardTable>`

> **Эх код:** `frontend/web/src/components/common/StandardTable.tsx`
>
> Entry-ийн **бүх жагсаалтад** энэ нэг компонент ашиглана. Custom хүснэгт зурах хориотой — багана, шүүлтүүр, нийлбэр, Excel export бүгд энэ доторх стандарт зан үйлд тулгуурлана.

---

## 1. Зорилго ба scope

`<StandardTable>` нь дараах функцыг **нэг дор** хариуцна:

| Функц | Тайлбар |
|-------|---------|
| Багана харах/нуух | Toolbar дахь `Columns` menu-ээс per-row checkbox |
| Багана өргөн засах | Header-ийн баруун ирмэгээс drag |
| Багана persistence | `${storageKey}_col_widths`, `${storageKey}_col_visible` localStorage-д |
| Sort | Header click — асc → desc → none toggle |
| Group-by | Toolbar `Group` menu — `groupable: true` багануудаас сонгоно |
| Group subtotal + grand total | Numeric багана бүрд `_count` + sum |
| Column filter | Header-ийн доорх Excel-маягийн multi-select popover (search + чек) |
| Global search | Toolbar-д `<Input>` — бүх багананд text contain match |
| Pagination | `PAGE_SIZE = 50`, group-byтэй үед pagination идэвхгүй |
| Row select | Optional — `selectable + selectedIds + onSelectionChange` |
| Excel export | `excelColumns + excelFilename` өгсөн бол `<ExcelExportButton>` нэмнэ |
| i18n | `t('col_<key>')` орчуулга key байвал ашиглана; үгүй бол `colDef.label` |

---

## 2. API — `ColDef` ба `StandardTableProps`

### 2.1 `ColDef`

| Талбар | Type | Утга |
|--------|------|------|
| `key` | string | Багана identifier (`row[key]`-ээс утга авна) |
| `label` | string | Header text (i18n key байхгүй үед) |
| `defaultWidth` | number | Px-ээр анхдагч өргөн (auto-fit-д ашиглана) |
| `isNumeric?` | boolean | true → баруун тийш зэрэгцүүлэх + numeric formatter (`fmt`) |
| `filterable?` | boolean | Header-доор column filter гарна |
| `groupable?` | boolean | Toolbar-ын Group menu-д орно |
| `defaultVisible?` | boolean | false → анхдагчаар нуугдсан |

### 2.2 `StandardTableProps`

| Талбар | Type | Шаардлагатай | Тайлбар |
|--------|------|:-----------:|---------|
| `colDefs` | `ColDef[]` | ✓ | Багана тодорхойлолт |
| `data` | `any[]` | ✓ | Эх мөр массив |
| `storageKey` | string | ✓ | localStorage prefix (per-page давхардахгүй байх) |
| `renderCell` | `(key, row, fmt) => ReactNode` | – | Custom cell render — `undefined` буцаавал default |
| `getRowBg` | `(row) => string \| undefined` | – | Per-row background (e.g. overdue-улаан) |
| `onRowClick` | `(row) => void` | – | Row click handler |
| `toolbar` | `ReactNode` | – | Toolbar-д нэмэх товчнууд |
| `title` | string | – | Toolbar дээд талд гарах гарчиг |
| `excelData` / `excelColumns` / `excelFilename` | – | – | Excel export-ыг идэвхжүүлнэ |
| `emptyMessage` | string | – | data.length===0 үед харагдана (default: `t('tbl_no_data')`) |
| `defaultGroupBy` | string | – | Анхдагчаар group хийгдэх багана key |
| `selectable` | boolean | – | Бүлэг сонголт идэвхжүүлнэ |
| `selectedIds` / `onSelectionChange` | – | – | Selection state lifted up |
| `getRowId` | `(row) => string` | – | Default: `row.id` |

---

## 3. Layout — толгой, биет, footer

```
┌─ Toolbar ───────────────────────────────────────────────────────┐
│ [Title]  N rows / M total       🔍 [search] [Group▼] [Cols▼] [Excel] [...toolbar] │
├─ Sticky header (sortable, resizable) ──────────────────────────┤
│ ┌─[#]─[Багана1▾]─[Багана2▾]─[Багана3▾]─...                       │
│ ├ optional filter row: [text input + dropdown ▾] per filterable │
├─ Body (scrollable Y, single horizontal scroll wrapper) ────────┤
│   ▶ group row (badge: N rows + collapsed totals)               │
│     row 1 ...                                                   │
│     row 2 ...                                                   │
│   ─ subtotal row (blue label/numbers)                          │
│   ▶ next group ...                                              │
├─ Footer totals (sticky bottom) ────────────────────────────────┤
│   Page (N rows) ........... pageTotal (numeric cols)            │
│   Grand total (M rows) ... grandTotal (numeric cols)            │
├─ Pagination (group-byтэй үед нуугдана) ────────────────────────┤
│   1-50 of 234     << < 1 2 3 4 5 > >>                          │
└─────────────────────────────────────────────────────────────────┘
```

**Багана өргөн auto-fit:** Хэрэглэгч resize хийж байгаагүй бол визуал багануудын `defaultWidth`-ыг container width-д проpor scale хийнэ. Resize хийсний дараа `localStorage`-д бичигдэж, дараагийн ачаалалд хадгалагдана.

---

## 4. Numeric formatting

`fmt` callback нь per-cell-д `parseFloat(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })` ажиллана. Currency / percent / integer-ийг өөр харуулах бол `renderCell`-ээр override хийнэ.

```ts
renderCell={(key, row, fmt) => {
  if (key === 'amount') return <Text>{fmt(row.amount)} ₮</Text>
  if (key === 'rate') return `${(row.rate * 100).toFixed(1)}%`
  return undefined  // → default
}}
```

---

## 5. i18n гэрээ

- Header label: `t('col_' + colDef.key)` гэсэн key байгаа эсэхийг шалгана. Байвал орчуулга, үгүй бол `colDef.label` буцаана.
- Toolbar key: `tbl_search`, `tbl_group`, `tbl_group_by`, `tbl_columns`, `tbl_none`, `tbl_rows`, `tbl_subtotal`, `tbl_page`, `tbl_grand_total`, `tbl_no_data`, `tbl_no_values`, `tbl_all`, `tbl_clear`.
- Бүх 4 хэлийн файлд (`mn.ts`, `en.ts`, `zh.ts`, `ru.ts`) орчуулга байгаа эсэхийг тест шалгана (`i18n.test.ts`).

---

## 6. localStorage схем

| Key | Утга |
|-----|------|
| `${storageKey}_col_widths` | `number[]` — colDefs-тэй ижил урттай |
| `${storageKey}_col_visible` | `Record<string, boolean>` — colDef.key → visible flag |

> `storageKey` нэр нь page бүрт **давтагдашгүй** байх ёстой. Зөвлөмж: `<module>_<page>_<table>` formaт. Жишээ: `gl_journals_main`, `ar_invoices_list`, `cost_allocations_history`.

---

## 7. Row selection (optional)

```tsx
const [selected, setSelected] = useState<Set<string>>(new Set())

<StandardTable
  selectable
  selectedIds={selected}
  onSelectionChange={setSelected}
  getRowId={row => row.invoice_id}
  ...
/>
```

- Header checkbox: одоогийн page rows-ийг бүгдийг toggle (indeterminate state дэмждэг).
- Row checkbox click: `onRowClick`-ыг блоклоно (stopPropagation).
- Page болон group солих үед selection хадгалагдана (page change-д үргэлжилнэ).

---

## 8. Sort, Group, Filter гэрээ

| Цикл | Хэрэглэгчийн action | State change |
|------|---------------------|-------------|
| Sort | Header click (3-way) | none → asc → desc → none |
| Group | Toolbar `Group` → багана сонгох | sort + pagination idle; subtotal + collapse идэвхтэй |
| Column filter | Filter row дахь Input | `colFilters[key]` text contain match |
| Multi-select filter | Filter row dropdown ▾ | `filterSelections[key]` Set\<string\> |
| Global search | Toolbar `<Input>` | бүх багана дахь string contain match |

> Олон шүүлтүүр зэрэг ажилласан үед AND-логикоор холбогдоно. Нэг баган дотор column-filter text + multi-select хоёулаа байх боломжтой бөгөөд тус тусдаа нөлөөлнө.

---

## 9. Жишээ хэрэглээ

```tsx
const colDefs: ColDef[] = [
  { key: '#', label: '#', defaultWidth: 50 },
  { key: 'invoice_num', label: 'Нэхэмжлэл #', defaultWidth: 120, filterable: true },
  { key: 'customer', label: 'Харилцагч', defaultWidth: 200, filterable: true, groupable: true },
  { key: 'invoice_date', label: 'Огноо', defaultWidth: 110, filterable: true },
  { key: 'total_amount', label: 'Дүн', defaultWidth: 130, isNumeric: true },
  { key: 'balance', label: 'Үлдэгдэл', defaultWidth: 130, isNumeric: true },
  { key: 'status', label: 'Статус', defaultWidth: 100, filterable: true, groupable: true },
]

<StandardTable
  storageKey="ar_invoices_main"
  colDefs={colDefs}
  data={invoices}
  title={t('ar_invoices_title')}
  excelColumns={excelColumns}
  excelFilename="ar-invoices"
  defaultGroupBy="customer"
  renderCell={(k, row, fmt) => k === 'status' ? <StatusBadge status={row.status} /> : undefined}
  onRowClick={row => router.push(`/modules/receivables/InvoiceList/view/${row.id}`)}
  toolbar={<Button onClick={onNew}>+ Шинэ</Button>}
/>
```

---

## 10. MS Excel Table-ийн зан үйлийн стандарт

Entry-ийн `<StandardTable>` нь **MS Excel-ийн Table** (Ctrl+T-аар үүсгэдэг "ListObject")-той ижил UX зорилгоор spec-лэгдсэн. Хэрэглэгч Excel-ээс шилжих үед сурч нэг зүйл байхгүй байх ёстой. Доорх матриц одоогийн төлөв ба V1.07 төлөвлөгөөг нэгтгэв.

### 10.1 Идэвхтэй (V1.06-д бэлэн ✅)

| # | Excel feature | Entry-ийн дүйцэх |
|---|---------------|------------------|
| 1 | Sticky header (Freeze top row) | Sticky `<Thead>` — body scroll-той үед толгой үргэлж харагдана |
| 2 | Column resize (drag border) | Header-ийн баруун ирмэгээс `col-resize` — өргөн localStorage-д хадгална |
| 3 | Auto-filter (Filter dropdown) | Filterable багана дахь Excel-маягийн multi-select popover (search + чек + All / Clear / OK) |
| 4 | Sort by column (A↓Z↑) | Header click — none → asc → desc → none toggle |
| 5 | Total row | Footer-ийн "Page total" + "Grand total" мөр (Σ numeric багана) |
| 6 | Subtotals (Group + collapse) | `groupable: true` багана-аар collapse-able групп + per-group subtotal |
| 7 | Export to .xlsx | Toolbar `<ExcelExportButton>` — нэр, format, formulas хадгална |
| 8 | Hide/Show columns | Toolbar `Columns ▾` checkbox menu — localStorage persistence |
| 9 | Search (find within table) | Toolbar global search — бүх багана дахь contain match |
| 10 | Pagination | `PAGE_SIZE = 50` (group-byтэй үед idle) |

### 10.2 Excel-өөс хүлээгдэж буй боловч **дутуу** (V1.07-д төлөвлөгдсөн)

| # | Excel feature | Entry spec |
|---|---------------|-----------|
| 11 | **Active cell + range selection** | Cell click → blue outline. Shift+click → range. Ctrl+click → discontinuous selection. |
| 12 | **Keyboard navigation** | Arrow keys (←↑→↓), Tab/Shift+Tab (next/prev cell), Enter (next row), PageUp/PageDown, Home/End, Ctrl+Home/Ctrl+End |
| 13 | **Copy as TSV (Ctrl+C)** | Selected range-ийг tab-separated text-р clipboard-д хуулна — Excel-д шууд paste хийгдэнэ |
| 14 | **Paste from clipboard (Ctrl+V)** | Editable mode-той үед TSV → grid-д бөглөнө (bulk-edit) |
| 15 | **Status bar (selection summary)** | Footer-д сонгосон cell-үүдийн: `Count: N \| Sum: ... \| Avg: ... \| Min: ... \| Max: ...` (Excel-ийн bottom-right bar шиг) |
| 16 | **Inline cell edit** | Double-click эсвэл F2 → cell editor нээх; Esc → cancel, Enter → commit. `<editableCols>` props-ээр баганад идэвхжүүлнэ |
| 17 | **Multi-column sort** | Shift+click эхлэн second/third sort key нэмнэ — toolbar дахь "Sort indicator" дараалал харуулна |
| 18 | **Frozen first column(s)** | `freezeCols?: number` props — N багана зүүн талд sticky position |
| 19 | **Banded rows** | `bandedRows?: boolean` (default true) — даалгаврын subtle alternate row bg |
| 20 | **Conditional formatting** | `conditionalFormat?: (key, value, row) => CSSProperties \| undefined` — heatmap, traffic light, threshold-based color |
| 21 | **Find & Replace (Ctrl+F)** | Modal popup: find query + match-case toggle + "Find next/prev" + (editable бол) Replace |
| 22 | **Cell context menu (right-click)** | Copy / Copy formula / Insert row / Delete row / Format / Show formula references |
| 23 | **Drag fill (autofill)** | Active cell-ийн баруун доод буланд "fill handle" → drag-аар утга copy/series fill |
| 24 | **Excel paste (header bar)** | Toolbar дээр `Excel-ээс оруулах` товч — TSV/CSV нааж inline preview-аар хүлээж авах modal |
| 25 | **Resize all to fit (auto-size)** | Header double-click → багана өөрийн max content-д тохирно (Excel-ийн `Best fit`) |
| 26 | **Format cells (number/date/currency)** | Per-column `format?: 'number' \| 'percent' \| 'currency' \| 'date' \| 'datetime' \| 'tsv-decimal'` |
| 27 | **Hyperlink cells** | `renderCell` дотор `<Link>` ашиглавал Excel-ийн `=HYPERLINK()`-той ижил Excel export-д hyperlink-ээр дамжуулна |
| 28 | **Slicer** | Sidebar чек-эсэн pill panel — column нэг утгыг хурдан филтэрлэх, олон slicer хослон ашиглах |
| 29 | **Sparkline column** | `<Sparkline>` мини chart — нэг row дахь олон period утгыг нэг cell дотор зурна (trend) |
| 30 | **Grouped column headers** | Хоёр түвшний header — "Q1 2026" → [Jan, Feb, Mar] нэг толгойн доор |

### 10.3 Excel-тэй ялгаатай зориуд хэвлэгдсэн зан үйл

Entry зориуд **Excel-ээс өөр** хэрэглэдэг газрууд:

| Үйлдэл | Excel | Entry |
|--------|-------|-------|
| Шинэ мөр нэмэх | Гар бичилт | Ихэнх жагсаалт `+ Шинэ` товч → form modal/page |
| Cell бүрд formula | `=SUM(...)` | Read-only — formula-г backend SQL хариуцна |
| Macro / VBA | Бий | ❌ — security ба audit замаас хорьсон |
| Multi-sheet | Бий | ❌ — нэг хүснэгт = нэг page (тус бүрд URL) |
| Offline editing | Бий | ❌ — Entry нь server-of-record, optimistic локал кэш үгүй |

### 10.4 Дизайн зарчим

- **"Энгийн жагсаалт" → Entry table нь Excel шиг зан үйлдэг.** Хэрэглэгч filter / sort / hide / resize-ийг Excel шиг хийнэ.
- **"Бөглөх грид" → Inline edit + paste + drag-fill.** AR/AP/POS бичилтийн grid-үүд (V1.07-д) Excel-ийн tab-Enter flow-той ижил.
- **"Дашбоард" → Slicer + sparkline.** Финансийн dashboard-уудад Excel PivotTable-ийн slicer-той ижил experience.

### 10.5 Implementation roadmap

| Release | Features | Priority |
|---------|---------|----------|
| V1.06 (одоогийн) | #1-10 (бэлэн) | ✅ |
| V1.07 phase 1 | #11 active cell, #12 keyboard nav, #13 copy-as-TSV, #15 status bar, #19 banded rows | High |
| V1.07 phase 2 | #16 inline edit, #14 paste, #21 find & replace, #18 frozen cols, #25 auto-size | High |
| V1.07 phase 3 | #17 multi-sort, #20 conditional format, #26 cell format, #22 context menu | Medium |
| V1.08+ | #23 drag fill, #28 slicer, #29 sparkline, #30 grouped headers | Low |

### 10.6 Hooks API extension (V1.07 spec)

`<StandardTable>` props-ийг өргөтгөж дараах нэмэгдэнэ:

```ts
interface StandardTableProps {
  // ...одоогийн props...

  // V1.07 — Excel-маягийн зан үйл
  freezeCols?: number                                    // Эхний N баганыг sticky-left
  bandedRows?: boolean                                   // Default: true
  editableCols?: string[]                                // Inline edit идэвхтэй багана-ийн key
  onCellEdit?: (rowId: string, key: string, newValue: any) => Promise<void>
  conditionalFormat?: (key: string, value: any, row: any) => React.CSSProperties | undefined
  cellFormat?: Record<string, 'number' | 'percent' | 'currency' | 'date' | 'datetime'>
  selectionMode?: 'row' | 'cell' | 'range'               // Default: 'row' (одоогийнх)
  onSelectionSummary?: (summary: SelectionSummary) => void
  enableFindReplace?: boolean                            // Default: false
  enableContextMenu?: boolean                            // Default: false
  enablePasteFromClipboard?: boolean                     // Default: false
}

interface SelectionSummary {
  count: number
  sum?: number
  avg?: number
  min?: number
  max?: number
}
```

> Эдгээрийн ихэнх нь **opt-in** props — энгийн жагсаалт хуудсуудад анхдагч `selectionMode='row'` үлдэх ба зөвхөн bulk-edit grid-үүдэд (e.g. payroll bulk grid, period adjustment grid) идэвхжүүлнэ.

---

## 11. Шалгалт

- [ ] `storageKey` давтагдсан эсэх — codebase grep
- [ ] `defaultWidth` нийт нь зорилтот хэмжээний дотор (ихэнх дэлгэцэд 1200-1600px)
- [ ] Numeric багана бүгдэд `isNumeric: true` тэмдэглэсэн эсэх
- [ ] `t('col_<key>')` орчуулга 4 хэлд нэмэгдсэн
- [ ] `excelColumns` Excel-д тохирсон формат — `excelColumns.ts` спектэй ижил
- [ ] V1.07-д Excel Table-ийн нэмэлт зан үйл (§10.2) implementation roadmap дагасан
