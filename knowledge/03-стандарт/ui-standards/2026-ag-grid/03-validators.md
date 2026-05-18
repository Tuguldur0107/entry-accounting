# 03. Validator registry

`lib/grid/validators.ts` дотор pure function-ууд `{ ok, errorMn }` буцаана.

## Үндсэн validators

| Function | Зорилго |
|----------|---------|
| `required(v)` | Хоосон утга оруулахгүй |
| `nonNegativeNumber(v)` | NaN биш ба `≥ 0` |
| `debitXorCredit(row)` | Row-level — Dr ба Cr хоёулаа > 0 байж болохгүй |
| `segmentCodeShape(v)` | 10-part dotted ЭСВЭЛ 8-цифр single-segment |
| `accountExists(knownCodes)(v)` | Main account `knownCodes` set-д байх |
| `dateISO(v)` | `^\d{4}-\d{2}-\d{2}$` |
| `composeValidators(...vs)` | Олон validator хэлхэх |

## Жишээ

```ts
import { composeValidators, required, accountExists } from "@/lib/grid/validators";

const knownSet = new Set(accounts.map(a => a.number));
const accountValidator = composeValidators(required, accountExists(knownSet));
```

## Row-level guardrail (journal entry)

```ts
const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
const balanced = Math.abs(totalDebit - totalCredit) <= 0.01;
// "Хадгалах" товч disabled={!balanced}
```

`balanced === false` бол `posted` статусаар хадгалахыг хориглоно.
