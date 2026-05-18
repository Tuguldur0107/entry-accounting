# 04. Keyboard ба Paste contract

`EaGrid` дотор default keyboard ба clipboard зан үйлийг тогтоодог. Surface-үүд
эдгээрийг override хийхгүй.

## Keyboard contract

| Товч | Үйлдэл |
|------|--------|
| Arrow keys | Нүд хооронд |
| Tab / Shift+Tab | Editable нүд хооронд |
| Enter / Shift+Enter | Commit + доош / дээш |
| F2 | Edit mode эхлүүлэх |
| Esc | Edit-ийг буцаах |
| Ctrl/Cmd+C / V / X | Copy / Paste / Cut |
| Ctrl/Cmd+Z / Y | Undo / Redo |
| Delete | Сонголтыг цэвэрлэх |

`stopEditingWhenCellsLoseFocus: true`, `undoRedoCellEditing: true`,
`undoRedoCellEditingLimit: 100`.

## Paste contract

```
clipboard (raw TSV)
      │
      ▼
processDataFromClipboard (surface-supplied)
      │
      ▼
AG Grid → cell.valueParser → onCellValueChanged
```

- Number column-уудад `parseMntInput` — `₮`, зай, таслал бүгдийг танина
- `account-segment` column-д `normalizePastedAccount(raw, activeSegIds, defaultSegments)`:
  - 10-part dotted шууд буцаана
  - Active-only N-part → `buildSegCode`-р padded 10-part
  - 8-цифр single → S3 байрлалд padded
  - Бусад тохиолдол: raw утга — validator улаан-border тэмдэглэгдэнэ

## Алдаа гарвал

- Invalid нүднүүд улаан border — paste-ийг REJECT хийхгүй
- `store.setError(rowId, field, errorMn)` дуудаж `RowMeta.errors`-д хадгална
