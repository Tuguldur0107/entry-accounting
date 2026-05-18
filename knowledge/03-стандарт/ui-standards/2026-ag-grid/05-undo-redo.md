# 05. Undo / Redo

Хоёр түвшний undo/redo систем:

1. **AG Grid built-in cell-edit undo** — F2/Enter-ийн дараах нэг нүдний өөрчлөлт
   (`undoRedoCellEditing: true`).
2. **`grid-store.ts` history** — paste, delete-row, batch import зэрэг
   user-action-sized atom-ууд.

## Patch model

```ts
interface CellPatch {
  rowId: string;
  field: string;
  prev: unknown;
  next: unknown;
}
interface HistoryEntry {
  label: string;     // "edit" | "paste" | "delete-row" | "import"
  patches: CellPatch[];
}
```

```ts
store.applyPatches("paste", [
  { rowId: "abc", field: "account", prev: oldAcc, next: newAcc },
  { rowId: "abc", field: "debit", prev: 0, next: 1000 },
]);
store.undo();
store.redo();
```

## Capacity / memory

`createGridStore(surfaceId, initial, capacity = 100)` — surface бүрд хамгийн ихдээ
100 patch. Delta л хадгална, full row snapshot биш.

`store.resetDirtyState()` — save-ийн дараа history-г цэвэрлэдэг.

## Журам

- **Cell edit (singleton):** AG Grid built-in undo хариуцна
- **Paste, delete-row, programmatic import:** Store-ийн `applyPatches(label, patches)`-аар
  л бүртгэгдэнэ — атомичоор undo хийгдэнэ
