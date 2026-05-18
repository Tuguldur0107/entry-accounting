# 06. Surface inventory

| Surface | Файл | Хэлбэр | Гол онцлог |
|---------|------|--------|-----------|
| Journal entry (бичих/засах) | [components/gl/journal-entry-form.tsx](../../../../components/gl/journal-entry-form.tsx) | Editable | `AccountSegmentEditor` popup, `DebitCreditEditor` mutex, Excel paste, undo/redo, pinned totals, balance guardrail |
| Journal list | [components/gl/journal-list.tsx](../../../../components/gl/journal-list.tsx) | Read-only | Dynamic row height (voucher header + N lines), pagination 15/page, sortable, action column |
| Accounts config (S3 + non-S3) | [components/gl/accounts-table.tsx](../../../../components/gl/accounts-table.tsx) | Switch toggles | Edit mode/drafts, pending-delete tracking, group header rows via colSpan, built-in column filter |
| GL trial balance | [components/gl/gl-balance-view.tsx](../../../../components/gl/gl-balance-view.tsx) | Read-only | Multi-header `colGroup`, pinned totals |
| Balance sheet | [components/gl/balance-sheet-view.tsx](../../../../components/gl/balance-sheet-view.tsx) | Read-only flat row model | ReportGrid + section/group/subtotal/total kinds |
| Income statement | [components/gl/income-statement-view.tsx](../../../../components/gl/income-statement-view.tsx) | Read-only flat row model | ReportGrid |
| Cash flow | [components/gl/cash-flow-view.tsx](../../../../components/gl/cash-flow-view.tsx) | Read-only flat row model | ReportGrid + footnote opening cash |

## Хуваалцагч компонент

- [components/gl/report-grid.tsx](../../../../components/gl/report-grid.tsx) — Balance
  Sheet / Income Statement / Cash Flow гурвулуу нэгдсэн "indented financial statement"
  grid. `ReportRow.kind` (`section | group | detail | subtotal | total | footnote | empty`)
  дискриминатор + colSpan + rowClassRules-ээр render хийнэ.

## Шинэ хүснэгт нэмэхэд

1. Surface-ийн `*.tsx` файл доторх grid-ийг `EaGridDynamic`-аар start
2. ColDefs нь `col({ eaType, ... })` ашиглана
3. Mutation хэрэгтэй бол `createGridStore(surfaceId, initial)` factory үүсгээд
   `applyPatches` дуудна
4. Save flow: `store.buildBatch()` → Server Action (`lib/actions/*.ts`)
5. Энэ файлд surface-ийг бүртгэнэ
