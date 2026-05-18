# Сегментийн идэвхтэй / идэвхгүй дүрэм (Active/Inactive Segment Rule)

> **Статус:** Заавал мөрдөх стандарт. Entry Accounting проектын **бүх** UI, DB write, DB read үйлдэлд **үл хамаарах зүйлгүй** хэрэгжинэ. Шинэ feature нэмэх, refactor хийх, тайлан зохиох — хаа сайгүй энэ дүрмийг автоматаар сахина.

## Үндсэн зарчим

10-сегмент бүтэцтэй (`segment_configs.isEnabled`) Entry Accounting систем нь сегмент бүрийг идэвхтэй (`enabled = true`) эсвэл идэвхгүй (`enabled = false`) болгох боломжтой. Сегмент 3 (Үндсэн данс) нь **байнга идэвхтэй** — disable хийх боломжгүй. Бусад сегментүүд (S1, S2, S4–S10) хэрэглэгчийн тохиргооноос хамаарна.

Тус сегментийн төлөв нь дараах гурван үе шатанд **өөр өөр** зан төлөвтэй байх ёстой:

| Үе шат | Идэвхтэй (`enabled`) | Идэвхгүй (`disabled`) |
|--------|----------------------|----------------------|
| **1. UI харагдац** | Бүх газар харагдана: багана, талбар, дроп-даун, шүүлтүүр | **Огт харагдахгүй** |
| **2. DB бичих (write)** | Хэрэглэгчээс утга авч хадгалагдана | Default утга = `"0"` сегментийн **уртын дагуу** padded |
| **3. DB унших (read)** | Group-ийн нэг хэсэг — өвөрмөц утгаар салгана | **"all" wildcard** — бүх утгуудаар нэгтгэгдэнэ (aggregate) |

---

## 1. UI харагдац — Display rule

Идэвхгүй сегмент **хаашаа ч** UI-д харагдахгүй:

- Журнал бичих форм (`journal-entry-form.tsx`) — input талбар үүсэхгүй
- Дансны тохиргоо (`accounts-table.tsx`) — багана үүсэхгүй
- Сегмент утгуудын жагсаалт — segmentValues UI зөвхөн идэвхтэй segmentId-ийг харуулна
- Журналын жагсаалт (`journal-list.tsx`) — composite дансны кодыг харуулахдаа идэвхтэй сегментүүдээ л холбоно
- Бүх тайлан (Гүйлгээ баланс, Баланс, Орлогын тайлан, Мөнгөн гүйлгээ) — багана үүсэхгүй
- Шүүлтүүр / Filter — идэвхгүй сегментээр шүүх боломжгүй

**Code pattern:**
```tsx
const activeSegments = SEGMENT_DEFS.filter((s) => activeSegIds.includes(s.id));
// activeSegments.map((s) => <Column ... />)
```

`activeSegIds` нь page-аас доош Server Component-оос Client Component руу дамжуулагдана. Helper: `lib/reports/balances.ts` → `getActiveKey()`.

---

## 2. DB бичих — Write rule

Шинэ бичлэг хийхдээ (createVoucher, createSegmentValue гэх мэт):

- **Идэвхтэй сегмент:** Хэрэглэгчээс талбар авч validation хийгээд хадгална
- **Идэвхгүй сегмент:** `"0"` тэмдэгтийг сегментийн `length`-ийн дагуу давтаж padded хийнэ

Сегмент тус бүрийн length-ийг `SEGMENT_DEFS` (`lib/constants/standard-accounts.ts`)-аас авна:

| Сегмент | Урт | Default ("0" padded) |
|---------|-----|----------------------|
| S1 Company | 3 | `"000"` |
| S2 Cost Center | 6 | `"000000"` |
| S3 Main Account | 8 | (заавал идэвхтэй, default байхгүй) |
| S4 Product/Service | 2 | `"00"` |
| S5 Project | 4 | `"0000"` |
| S6 Inter Company | 3 | `"000"` |
| S7 Related Party | 4 | `"0000"` |
| S8 Cash Flow | 4 | `"0000"` |
| S9 Modules | 2 | `"00"` |
| S10 Reserve | 1 | `"0"` |

**Code pattern:**
```ts
function defaultSegmentValue(segDef: SegmentDef): string {
  return "0".repeat(segDef.length);
}

function buildAccountNumber(
  inputs: Record<number, string>,
  activeSegIds: number[],
): string {
  return SEGMENT_DEFS.map((def) =>
    activeSegIds.includes(def.id)
      ? inputs[def.id] ?? defaultSegmentValue(def)
      : defaultSegmentValue(def),
  ).join(".");
}
```

DB дэх `journalLines.accountNumber` field нь **үргэлж 10-сегмент бүтэн форматтай** (цэгээр тусгаарлагдсан). Идэвхгүй сегмент байр хоосон үлдэхгүй — `"0"` padded утгаар дүүргэгдэнэ.

---

## 3. DB унших / Тайлан — Read rule

Тайлан, aggregation, дансны жагсаалт уншихдаа:

- **Идэвхтэй сегментүүдээр** group хийнэ — group key-д орох
- **Идэвхгүй сегментийн** утга group key-д **орохгүй** → бүх утгуудаар нэгтгэгдэнэ (sum/aggregate)

Энэ нь "all" wildcard зан төлөв — идэвхгүй сегмент байгаа гэдгийг үл харгалзан өгөгдлийг идэвхтэй сегментүүдийн утгаар л ангилна.

**Жишээ:** S2 (Cost Center) идэвхгүй гэвэл, `001.100100.51100000.00.0000.000.0000.0000.00.0` болон `001.200200.51100000.00.0000.000.0000.0000.00.0` (зөвхөн S2 ялгаатай) хоёр бичлэг нэг мөрөнд нэгтгэгдэнэ.

**Code pattern:**
```ts
export function getActiveKey(
  accountNumber: string,
  activeSegIds: number[],
): string {
  const parts = accountNumber.split(".");
  if (parts.length !== 10) return accountNumber;
  return activeSegIds.map((id) => parts[id - 1] ?? "").join(".");
}

// aggregateBalances groups by getActiveKey(...) instead of full accountNumber
```

Helper: [lib/reports/balances.ts](../../lib/reports/balances.ts) — `getActiveKey()`, `aggregateBalances()`, `buildCashFlow()`.

---

## Дүгнэлт checklist

Шинэ feature нэмэх / код шинэчлэх үед бүх асуултанд "Тийм" гэж хариулна:

- [ ] Идэвхгүй сегмент UI-д хаа сайгүй огт харагдахгүй байгаа эсэх
- [ ] Бичих үед идэвхгүй сегмент `"0"` length-ээр padded хийгдсэн эсэх
- [ ] Унших/aggregate үед `getActiveKey` (эсвэл түүнтэй адил логик) хэрэглэсэн эсэх
- [ ] `activeSegIds` page-ээс доош дамжуулагдсан эсэх (`segment_configs.isEnabled` тулгуурласан)
- [ ] Бүх тайланг ижил зарчмаар хэрэгжүүлсэн эсэх

---

## Холбогдох файлууд

- [knowledge/03-стандарт/segment-strategy.md](segment-strategy.md) — 10-сегмент мастер лавлах
- [lib/constants/standard-accounts.ts](../../lib/constants/standard-accounts.ts) — `SEGMENT_DEFS`
- [lib/reports/balances.ts](../../lib/reports/balances.ts) — read/aggregate helpers
- [lib/db/schema.ts](../../lib/db/schema.ts) — `segment_configs`, `segment_values`

---

**Анхааруулга:** Энэ дүрэм нь хэрэглэгчийн хүсэлтийн дагуу хатуу мөрдөх стандарт юм. Аливаа сегментийн хувьд "энэ онцгой тохиолдол" гэж онцлох боломжгүй — S3 (Main Account) заавал идэвхтэй гэдгээс бусад. Хэрэв шинэ ангиллын аргачлал хэрэгтэй бол энэ дүрмийг **өөрчлөхгүй**, харин дээр нэмж бичнэ.
