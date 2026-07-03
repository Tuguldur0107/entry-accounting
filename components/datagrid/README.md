# DataGrid — хүснэгтийн нэгдсэн component

Excel-маягийн дахин ашиглагдах хүснэгт. AG Grid **Community v35** (MIT, үнэгүй)
дээр суурилсан. `datagrid-template`-ээс гаралтай, Entry Accounting-д тохируулан
өргөтгөсөн хувилбар.

Бүх хүснэгтийн UI ЗААВАЛ энэ component-оор хийгдэнэ — `<table>`, shadcn
`<Table>`, custom CSS grid хориотой (CLAUDE.md § Хүснэгтийн стандарт).

## Файлууд

```
DataGrid.tsx          Гол component (theme, clipboard, selection, pagination)
DataGridDynamic.tsx   dynamic(ssr:false) wrapper — БҮХ callsite ЭНИЙГ import хийнэ
ComboFilter.tsx       Бүх баганын нэгдсэн filter: оператор + checkbox жагсаалт
datagrid.css          Filter + hover styling
```

## Ашиглах

```tsx
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import type { ColDef } from "ag-grid-community";

const columnDefs: ColDef<Row>[] = [
  { field: "id", headerName: "ID", width: 90 },
  { field: "name", headerName: "Нэр", flex: 1 },
];

<DataGridDynamic<Row>
  rowData={rows}
  columnDefs={columnDefs}
  pageSize={25}
  height={540}
/>
```

> `DataGrid`-ийг шууд import хийхгүй — AG Grid init үед `document` хэрэгтэй тул
> SSR дээр унана. Үргэлж `DataGridDynamic`.

## Props

`DataGridProps<T>` нь `AgGridReactProps<T>`-г өвлөдөг тул AG Grid-ийн бүх
тохиргоо (rowHeight, getRowId, pinnedBottomRowData, singleClickEdit,
undoRedoCellEditing…) шууд дамжина. Нэмэлт:

| Prop | Төрөл | Default | Тайлбар |
|------|-------|---------|---------|
| `height` | `number \| string` | `480` | Контейнерийн өндөр |
| `pageSize` | `number` | — | Өгвөл pagination автоматаар асна |
| `showSelectionCheckboxes` | `boolean` | `false` | Мөр сонголтын checkbox |
| `wrapperClassName` | `string` | — | Гадуур div-д нэмэх class |
| `clipboard.onProcess` | `(rows) => rows` | — | Paste өгөгдөл хувиргах hook |
| `ref` | `Ref<DataGridHandle>` | — | `{ api: GridApi }` — imperative хандалт |

## ComboFilter

Бүх баганад default-оор идэвхтэй. Оператор (Агуулсан / Агуулаагүй / Эхэлсэн /
Төгссөн / Хэв маяг `* ?` / `=` / `≠` / `>` / `<` / Хооронд) + хайлттай checkbox
жагсаалт, хоёулаа AND-аар.

## Тусгай editor-ууд (lib/grid/editors/)

| Editor | Зориулалт |
|--------|-----------|
| `AccountSegmentEditor` | Данс: гараар бичих + ⌄ товчоор сегмент panel |
| `DebitCreditEditor` | Дебет/Кредит + Dr⊕Cr mutex |
| `SegSelect` | Searchable dropdown (portal) |
| `SwitchCellRenderer` | shadcn Switch нүдэнд |

AG Grid v32+: custom editor утгаа `props.onValueChange()`-ээр дамжуулна;
`document.body`-д portal хийх бол `ag-custom-component-popup` class ЗААВАЛ.

## Бэлэн surface-ууд

| Component | Хэлбэр |
|-----------|--------|
| `components/journal/journal-lines-grid.tsx` | Журналын мөр (Данс/Дт/Кт/Тайлбар) — reuse-д бэлэн |
| `components/gl/journal-list.tsx` | Read-only жагсаалт + pagination |
| `components/gl/accounts-table.tsx` | Inline switch + batch save |
| `components/gl/gl-balance-view.tsx` | Multi-header + pinned totals |
| `components/gl/report-grid.tsx` | Тайлангийн section/total мөр |

## Scale хийх үед (олон арван мянга+ мөр)

1. Pagination-ийг backend руу шилжүүл
2. ComboFilter-ийн unique утгуудыг `SELECT DISTINCT`-ээс тат
3. Filter model-ийг сериалайз хийж SQL WHERE болго
