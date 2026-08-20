# Report line mapping — стандарт

Тайлан бүрийн "стандарт мөр" (жишээ нь Балансын тайлангийн **Мөнгөн
хөрөнгө**, **Дансны өглөг**) тус бүрд аль GL дансууд орох ёстойг
хэрэглэгч өөрчилж тохируулах боломжтой механизм. Default mapping нь
тайлангийн `defaultPrefixes`-ээс resolve хийгддэг бөгөөд хэрэглэгчийн
override-ыг `report_line_mappings` хүснэгтэд хадгалж prefix-ээс эхний
ээлжинд тавьдаг.

Анх Балансын тайланд хэрэгжсэн. **Орлогын тайлан 2026-08-д мөн энэ
стандартаар хэрэгжив** (`lib/reports/is-lines.ts` + income-statement-view;
хамгаалалт: мөрөнд ороогүй данс + давхар mapping-ийн зөрүүний индикатор).
Мөнгөн гүйлгээний тайлан contra-дансны ангиллаар хэвээр — mapping-тэй
болгох бол classifyCashFlow-ийн автомат логикийг line default болгох
refactor шаардлагатай (шийдвэр нээлттэй). Мөнгөн хөрөнгийн тайланд
дансаар бус S8 мөнгөн урсгалын КОДООР нэгтгэдэг хэсэг нэмэгдсэн —
"өөр хэмжигдэхүүнээр mapping"-ийн жишээ (код нь хэрэглэгчийн засварладаг
segment_values лавлах тул тусдаа mapping хүснэгт шаардаагүй).

---

## 1. Архитектур

```
┌─ DB ─────────────────────────────────────────────────────────────┐
│  report_line_mappings (userId, reportType, lineKey,              │
│                        accountNumbers CSV, updatedAt)            │
│  UNIQUE (userId, reportType, lineKey)                            │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ upsert / delete
                              │
┌─ Server actions ──────────────────────────────────────────────────┐
│  lib/actions/report-mappings.ts                                  │
│    getReportMappings(reportType)                                 │
│    saveReportMapping(reportType, lineKey, accountNumbers[])      │
│    clearReportMapping(reportType, lineKey)                       │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ revalidatePath after writes
                              │
┌─ Report definitions ──────────────────────────────────────────────┐
│  lib/reports/<report>-lines.ts                                   │
│    Standard SAS / IAS lines с                                   │
│    key, section, group, label, defaultPrefixes, sign             │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─ Aggregator + view ───────────────────────────────────────────────┐
│  components/gl/<report>-view.tsx                                 │
│    1) resolveLineAccounts(key, mappings, accounts)               │
│       → override ?? accountsMatchingDefaultPrefixes              │
│    2) sum debit-net / credit-net per line                        │
│    3) build ReportRow[] (section / group / detail / subtotal)    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ UI ──────────────────────────────────────────────────────────────┐
│  components/gl/report-grid.tsx                                   │
│    `onMappingClick` prop → "Mapping" column with icon            │
│  components/gl/mapping-dialog.tsx                                │
│    Grouped account checklist + per-account balance               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Data flow — нэг мөрд хэрхэн дүн тооцоологддог вэ

```
For each BS_LINE (e.g. cash):

  if user override exists in report_line_mappings:
      accountNumbers = override.accountNumbers
  else:
      accountNumbers = accounts.filter(a =>
        line.defaultPrefixes.some(p => a.number.startsWith(p)))

  amount = 0
  for code in accountNumbers:
      bal = byMainAccount.get(code)
      if not bal: continue
      amount += line.sign === "debit"
                  ? (bal.closeDebit − bal.closeCredit)
                  : (bal.closeCredit − bal.closeDebit)
```

Хэрэглэгч **хоосон жагсаалт хадгалбал** (override `[]`) line нь
**0**-р тооцоологдоно — энэ нь зориуд "энэ мөрөнд юу ч оруулахгүй" гэж
хэрэглэгч тэмдэглэсэн заавар. Default-руу буцахын тулд
`clearReportMapping` дуудах ёстой.

---

## 3. Шинэ mappable тайлан нэмэх жагсаалт

Жишээ нь Орлогын тайлан / Мөнгөн гүйлгээний тайланг mapping-тэй болгох
гэвэл:

### 3.1 Schema

`lib/db/schema.ts` дотор `report_line_mappings`-д шинэ row нэмэх
шаардлагагүй. `reportType` багана нь "income-statement", "cash-flow"
гэх мэт **string-аар тэлэгддэг**. Шинэ string үнэ цэнэ нэмэхэд
migration хэрэггүй.

### 3.2 Lines definition файл

`lib/reports/<report>-lines.ts` файл шинээр үүсгэж SAS / IAS standard
line-уудыг тодорхойлно:

```ts
export interface IsLine {
  key: string;
  section: "revenue" | "expense";
  group: string;
  groupLabel: string;
  label: string;
  defaultPrefixes: string[];
  sign: "debit" | "credit";
}

export const IS_LINES: readonly IsLine[] = [
  { key: "operating-revenue", section: "revenue", group: "revenue",
    groupLabel: "Орлого", label: "Үйл ажиллагааны орлого",
    defaultPrefixes: ["5110"], sign: "credit" },
  ...
];
```

**Эрхэм дүрэм:** `defaultPrefixes` нь өөр line-уудтай **давхцалгүй**
байх ёстой. Давхцалтай үед нэг данс олон line дээр давхар бодогдоно.
Нарийн орлогог зорьсон тохиолдолд `["31000001", "31000099"]` гэх мэт
exact account кодоор тодорхойл.

### 3.3 ReportType-ыг өргөтгөх

`lib/actions/report-mappings.ts`-ийн `ReportType` union-д нэмэх:

```ts
export type ReportType = "balance-sheet" | "income-statement" | "cash-flow";
```

### 3.4 Page server component-д mappings fetch хийх

`app/(dashboard)/gl/reports/page.tsx`-д өөр reportType-ийн mappings-ийг
parallel fetch хийгээд view-руу дамжуулна:

```ts
db.query.reportLineMappings.findMany({
  where: and(
    eq(reportLineMappings.userId, userId),
    eq(reportLineMappings.reportType, "income-statement"),
  ),
}),
```

### 3.5 View component refactor

`components/gl/<report>-view.tsx`-д:

- `mappings: ReportLineMapping[]` prop хүлээж авна
- `Map<lineKey, accountNumbers[]>` болгож хувирга
- `resolveLineAccounts` helper-ийг копилоосож line бүрт ашиглах
- Line бүрт `byMainAccount` дансан үлдэгдлээс `debitNet/creditNet`
  тооцоо
- ReportRow[] угсралтаа `lineKey` тавьсан detail-р хийх (Mapping icon
  идэвхжүүлэхэд хэрэгтэй)
- MappingDialog-ийг рендер хийх state + render логик нэмнэ

### 3.6 Pre-computed balance map

Mapping dialog-д account-уудын үлдэгдлийг харуулахын тулд
`Map<mainAccount, number>` дамжуулна:

```ts
const accountBalances = useMemo(() => {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.mainAccount, r.totals.closeDebit - r.totals.closeCredit);
  }
  return map;
}, [rows]);
```

Орлогын тайланд `closeDebit - closeCredit` биш `periodCredit -
periodDebit` (бүртгэлийн хугацааны эерэг орлого) гэх мэт өөр сигн
ашиглаж болно. Тайлантай нийцүүлэх.

### 3.7 ReportGrid дотор `onMappingClick`-ийг дамжуулах

`<ReportGrid ... onMappingClick={(key) => setOpenLineKey(key)} />`

ReportRow дотор `lineKey` тавьсан detail-уудад автоматаар "Mapping"
icon багана нэмэгдэнэ.

---

## 4. UI стандарт

### MappingDialog

| Зүйл | Стандарт |
|------|----------|
| Дөрвөлжин | `max-w-2xl sm:max-w-2xl` (672px) — sm responsive variant override заавал |
| Title | `<chip>Дансны mapping</chip>  <bold>Line label</bold>` |
| Тайлбар | `Энэ мөрийн дүнд оруулах GL дансуудыг сонгоно уу. Үлдэгдэл нь тайлангийн он сар үед таны бичсэн журналаар тооцоологдов.` |
| Хайлт | `<Input>` `flex-1` + `Зөвхөн үлдэгдэлтэй` checkbox |
| Bulk actions | `Бүгдийг сонгох (N)`, `Цэвэрлэх` — visible item тоо |
| Counter | `Сонгосон: N | Нийт үлдэгдэл: X` (sum of selected balances) |
| Account row | `[checkbox] [code 80px mono primary] [name flex-1 truncate] [balance 140px mono right-align]` |
| Balance color | `≥0` text-1, `<0` danger-fg, `0` text-4 + "—" |
| Бүлэглэлт | Sticky group header `{key}x — {ACCOUNT_GROUPS[key]}` (1X / 2X / 3X / 4X / ...) |
| Footer | `Болих` (outline), `Хадгалах` (primary) |
| Save → Server Action | `saveReportMapping(reportType, lineKey, [...selected])` |
| Re-open reset | `setSelected(new Set(initialAccounts)); setQuery(""); setOnlyWithBalance(false)` |

### ReportGrid Mapping column

| Property | Утга |
|----------|------|
| `colId` | `"mapping"` |
| `headerName` | `"Mapping"` |
| `width` | 84, `maxWidth` 100 |
| `cellRenderer` | `kind === "detail" && r.lineKey` бол icon button, бусад үед `null` |
| Icon | `SlidersHorizontal` (lucide-react) |
| Button class | `ea-btn ea-btn--icon ea-btn--primary` |

### Computed lines (e.g. Тайлант үеийн цэвэр ашиг)

- `kind: "detail"` хэвээр үлдэнэ (numbering + indentation авна)
- **`lineKey`-гүй** — Mapping icon гарахгүй
- Бодит mapping боломжгүй учир: `Тайлант үеийн цэвэр ашиг = ΣRevenue −
  ΣExpense`, нэг line-руу orchestrated mapping-аар тооцоологдох
  боломжгүй

---

## 5. Edge case-ууд

1. **Default prefix-уудын давхцал** — нэг данс хоёр line-ыд тоологдох
   эрсдэлтэй. Specific exact кодыг ашиглаж шийднэ (жишээ:
   `["31000001", "31000099"]` нь bare `"31000"` биш).

2. **Empty override** — хэрэглэгч хадгалах үед бүх checkbox arilгасан
   бол `accountNumbers = ""` болгож хадгална. `mappings.get(key) = []`
   undefined биш тул override-ыг хүндэлж 0 буцаана. Default-руу буцахын
   тулд `clearReportMapping` дуудах.

3. **Zero-amount lines** — өгөгдөл байхгүй line-уудыг default-аар
   нуудаг. Хэрэглэгч **mapping тавьсан тохиолдолд** хоосон ч гэсэн
   харуулна (user-pinned).

4. **`revalidatePath("/gl/reports")`** — server action хадгалсны
   дараа page-ийн next render-д шинэ mappings дамжина. Client state
   шинэчлэх hook шаардлагагүй.

5. **Entity vs segment-level aggregation** — Балансын тайлан, Орлогын
   тайлан, Мөнгөн гүйлгээний тайлан бүгд **`activeSegIds = [3]`**
   (Main Account) дээр аггрегаци хийдэг. Сегментийн задаргаа зөвхөн
   Trial Balance (Гүйлгээ баланс) дээр.

6. **Mapping copy / preset** — одоохондоо нэг хэрэглэгчийн нэг
   reportType-ийн нэг lineKey-д нэг row. Mapping preset
   (нийтлэг бүтцийг шилжүүлэх) feature алга — ирээдүйн нэмэлт.

---

## 6. Холбоотой файлууд

- [lib/db/schema.ts](../../../lib/db/schema.ts) — `report_line_mappings` table
- [lib/actions/report-mappings.ts](../../../lib/actions/report-mappings.ts) — server actions
- [lib/reports/bs-lines.ts](../../../lib/reports/bs-lines.ts) — Balance Sheet line definitions
- [components/gl/balance-sheet-view.tsx](../../../components/gl/balance-sheet-view.tsx) — reference implementation
- [components/gl/mapping-dialog.tsx](../../../components/gl/mapping-dialog.tsx) — shared dialog
- [components/gl/report-grid.tsx](../../../components/gl/report-grid.tsx) — `onMappingClick` prop
- [components/ui/dialog.tsx](../../../components/ui/dialog.tsx) — `max-w-2xl sm:max-w-2xl` override required

---

## 7. Стандартыг мөрдөх checklist

Шинэ тайлан нэмж байгаа programmer-ийн checklist:

- [ ] `<report>-lines.ts` файл байгаа эсэх
- [ ] `defaultPrefixes` нь өөр line-уудтай давхцалгүй
- [ ] Aggregator нь `activeSegIds = [3]` хатуу хэрэглэнэ
- [ ] `accountBalances: Map<string, number>` ReportGrid + MappingDialog-руу дамжина
- [ ] Detail row бүхэн `lineKey` тавьсан, computed row бол ҮГҮЙ
- [ ] Page server component mappings parallel fetch хийсэн
- [ ] `ReportType` union-д нэр нэмэгдсэн
- [ ] MappingDialog re-mount per line бөгөөд state reset хийдэг
- [ ] `Cmd+Shift+R` (hard refresh)-ийн дараа mapping change persist хийгдэх
