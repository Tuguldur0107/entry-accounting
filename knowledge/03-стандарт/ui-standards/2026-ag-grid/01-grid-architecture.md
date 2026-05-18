# 01. Хүснэгтийн архитектур (AG Grid Community v35)

Entry Accounting-ийн бүх хүснэгтийн UI энэ архитектурт нийцнэ. `<table>`, shadcn
`<Table>`, custom CSS grid-ээр шинээр хүснэгт бичих **хориотой**.

---

## 1. Эх сурвалж файлууд

```
lib/grid/
├── types.ts              ColumnTypeId, EaColDef, RowMeta, BatchPatch, HistoryEntry, CellPatch
├── registerGrid.ts       ModuleRegistry.registerModules([AllCommunityModule])
├── theme.ts              themeQuartz.withParams({ ...→ var(--ea-*) })
├── validators.ts         required, nonNegativeNumber, debitXorCredit, segmentCodeShape, accountExists, dateISO, composeValidators
├── formatters.ts         fmtMnt, parseMntInput, moneyValueFormatter, accountValueFormatter
├── columnTypes.ts        columnTypeDefaults, col() helper
├── segments.ts           buildSegCode, parseSegParts, fmtAccountDisplay, normalizePastedAccount, SEG_DEFAULTS
├── clipboard.ts          processClipboardData
├── EaGrid.tsx            Wrapper (theme, keyboard, clipboard, undo/redo defaults)
├── EaGridDynamic.tsx     dynamic(ssr:false) — БҮХ callsite энийг ашиглана
└── editors/
    ├── SegSelect.tsx                Portal-mounted searchable dropdown
    ├── AccountSegmentEditor.tsx     Popup editor → 10-part dotted код буцаана
    ├── DebitCreditEditor.tsx        Number editor + Dr⊕Cr mutex
    └── SwitchCellRenderer.tsx       shadcn Switch (callback dispatch)

lib/store/grid-store.ts   Zustand factory: createGridStore<TData>(surfaceId, initial, capacity=100)
```

---

## 2. SSR

AG Grid module init үед `document` хэрэгтэй. Бүх callsite `EaGridDynamic`-ийг
import хийнэ — энэ нь `next/dynamic({ ssr: false })`-р боогддог. Хуудаснууд
(`page.tsx`) Server Component хэвээр үлдэж `rowData`-г prop-оор client component-руу
дамжуулна.

---

## 3. Mutation flow

```
   cell edit
       │
       ▼
 EaGrid onCellValueChanged
       │
       ▼
 setRows(...) ЭСВЭЛ store.applyPatches("edit", [{rowId, field, prev, next}])
       │
   (Save товч)
       │
       ▼
 store.buildBatch() → { create, update, delete: string[] }
       │
       ▼
 Server Action (lib/actions/*.ts)
```

Client-ээс DB-руу шууд хандах эсвэл `processDataFromClipboard`-аас DOM мутаци хийх
**ХОРИОТОЙ**.
