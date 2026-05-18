# 02. Column type registry

`lib/grid/columnTypes.ts` бол **шинэ column kind тодорхойлох цорын ганц газар**.

## Дэмжих kinds

| `eaType` | Editor | ValueFormatter | Alignment | Бусад |
|----------|--------|----------------|-----------|-------|
| `text` | Plain text editor | — | left | editable |
| `readonly-text` | — | — | left | non-editable |
| `number-money` | Number input | `moneyValueFormatter` | right, mono | `parseMntInput`-ээр parse |
| `readonly-money` | — | `moneyValueFormatter` | right, mono | non-editable |
| `debit` / `credit` | `DebitCreditEditor` | `moneyValueFormatter` | right, mono | Dr⊕Cr mutex (sibling clear) |
| `account-segment` | `AccountSegmentEditor` (popup) | per-surface | left, mono | 10-part dotted код |
| `date` | `dateString` editor | — | left, mono | `YYYY-MM-DD` |
| `switch` | — (callback dispatch) | — | center | shadcn `Switch` |
| `select` | `agSelectCellEditor` | — | left | values via cellEditorParams |

## Хэрэглээний жишээ

```ts
import { col } from "@/lib/grid/columnTypes";

const columnDefs = [
  col({ eaType: "account-segment", field: "account", headerName: "Данс", width: 240 }),
  col({ eaType: "debit", field: "debit", headerName: "Дебет", width: 150 }),
  col({ eaType: "credit", field: "credit", headerName: "Кредит", width: 150 }),
  col({ eaType: "text", field: "description", headerName: "Тайлбар", flex: 1 }),
];
```

## Шинэ kind нэмэх

1. `lib/grid/types.ts` → `ColumnTypeId` union-д нэр нэмнэ
2. `lib/grid/columnTypes.ts` → `columnTypeDefaults` объектод default ColDef бичнэ
3. Шаардлагатай бол editor/renderer `lib/grid/editors/`-д үүсгэнэ
4. Validator хэрэгтэй бол `lib/grid/validators.ts`-д нэмнэ
