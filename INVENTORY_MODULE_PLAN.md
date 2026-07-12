# Бараа материалын (Inventory) модулийн төлөвлөгөө

> Судалгааны эх сурвалж: `knowledge/01-онол-хууль-стандарт/ifrs/ias-2-inventory.md`,
> `knowledge/02-нягтлан-бодох-мэргэжлийн/01-gl-posting-matrix.md` (§2.15–2.19, 2.29, 2.35–2.40),
> `knowledge/03-стандарт/chart-of-accounts.md` (221/331 тушаал), `tax/vat.md`, `02-period-close.md`,
> мөн Cash + АР/АП модулиудын код (архитектурын загвар).

---

## 1. Зорилго ба хамрах хүрээ

Бараа материалын дэд бүртгэл (subledger): тоо хэмжээ × өртгөөр нөөцийг данслаж,
GL-ийн 14-бүлгийн дансуудтай үргэлж тулж байх. **Draft-first**: бүх хөдөлгөөн
ноорог үүсээд хэрэглэгч баталсны дараа GL-д бичигдэнэ (human-in-the-loop дүрэм).

| Үе шат | Багтах зүйл |
|--------|-------------|
| **Үе 1 (MVP)** | Бараа/агуулахын мастер дата · орлого, зарлага, шилжүүлэг, тохируулгын хөдөлгөөн · жигнэсэн дундаж өртөг · АП нэхэмжлэхээс орлогын draft · АР нэхэмжлэхээс COGS зарлагын draft · GL→Inventory draft sync · үлдэгдэл + хөдөлгөөний тайлан + GL тулгалт |
| **Үе 2** | Тооллого (counting) + илүүдэл/дутагдлын журнал · NRV бууруулалт/сэргээлт · буцаалтын урсгал · landed cost (2 шаттай, 14000099) |
| **Үе 3** | Үйлдвэрлэл (WIP 14000003 → FG 14000004, standard cost + variance) · FIFO сонголт · period close холболт |

---

## 2. Нягтлан бодох дүрэм (KB-ээс баталгаажсан)

### 2.1 Дансны кодууд (gl-posting-matrix §1)

| Данс | Хэрэглээ |
|------|---------|
| `14000001` | Бараа материал (үндсэн — бүх template энийг ашигладаг) |
| `14000003` / `14000004` | WIP / Бэлэн бүтээгдэхүүн (Үе 3) |
| `14000099` | Landed cost түр данс (Үе 2) |
| `61100000` | Борлуулалтын өртөг (COGS) |
| `87100004` / `51800003` | Тооллогын дутагдал / илүүдэл (Үе 2) |
| `87100005` | NRV бууруулалт (IAS 2 §9) (Үе 2) |
| `31000001` | Худалдан авалтын өглөг (АП) |
| `13620000` | НӨАТ авсан (оролтын НӨАТ)* |

\* KB-д `12000002` vs `13620000` зөрчилтэй — CLAUDE.md-ийн НӨАТ бүлэгт `13620000`
гэж заасныг мөрдөнө.

### 2.2 GL бичилтийн загварууд

```
Орлого (АП-аас):        Dr 14000001 (дүн)            / Cr 31000001
Орлого НӨАТ-тай:        Dr 14000001 + Dr 13620000    / Cr 31000001 (нийт)
Зарлага (борлуулалт):   Dr 61100000 (qty × avg_cost) / Cr 14000001
Тохируулга илүүдэл:     Dr 14000001                  / Cr 51800003   (Үе 2)
Тохируулга дутагдал:    Dr 87100004                  / Cr 14000001   (Үе 2)
NRV бууруулалт:         Dr 87100005                  / Cr 14000001   (Үе 2)
Агуулах хоорондын шилжүүлэг: GL бичилтгүй (нэг дансны дотор, subledger-ийн л хөдөлгөөн)
```

### 2.3 Өртгийн арга — жигнэсэн дундаж (moving average)

KB-ийн үйлдлийн стандарт (event E5/E6). LIFO хориотой (IAS 2), FIFO Үе 3-т нэмж болно.

```
Орлого бүрд:  new_avg = (old_qty × old_avg + in_qty × in_cost) / (old_qty + in_qty)
Зарлага бүрд: cost = out_qty × avg_cost   (дундаж өөрчлөгдөхгүй)
Хамгаалалт:   out_qty ≤ on_hand_qty — хасах үлдэгдэл ХОРИОТОЙ (батлахад шалгана)
```

Тооцоолол **цэвэр функцээр** (`lib/inventory/costing.ts`) — Cash-ийн
`calculateCashBalances` шиг posted хөдөлгөөнүүдийг он цагийн дарааллаар replay
хийж бараа×агуулах бүрийн `{qty, avgCost, value}` гаргана. Unit тесттэй.

### 2.4 Валют, НӨАТ

- Орлогын өртөг = АП нэхэмжлэхийн **baseAmount (MNT, historical rate)** — IAS 21.
  Төлбөрийн өдрийн ханшийн зөрүү (51800001/87000003) өртөгт ХЭЗЭЭ Ч орохгүй.
- Буцаан суутгагдах НӨАТ өртөгт орохгүй (Dr 13620000 тусдаа мөр).
- НӨАТ модуль гараагүй тул Үе 1-д НӨАТ-ын задаргааг АП нэхэмжлэхийн мөрөнд
  хэрэглэгч өөрөө (тусдаа мөрөөр) бичнэ — одоогийн АР/АП зарчимтай ижил.

---

## 3. Өгөгдлийн бүтэц (Drizzle)

```
inventory_items        — id, userId, code (user-д unique), name, unit (ш/кг/л/м…),
                         costMethod ('weighted_avg' default; 'fifo' Үе 3),
                         inventoryAccountNumber (default 14000001),
                         cogsAccountNumber (default 61100000), isActive, createdAt

warehouses             — id, userId, code, name, isActive, createdAt

inventory_movements    — id, userId, documentNo (IN-YYYYMMDD-XXXXXX эсвэл гараар),
                         movementType ('receipt'|'issue'|'transfer'|'adjustment'),
                         date, itemId, warehouseId, toWarehouseId (зөвхөн transfer),
                         quantity numeric(18,4), unitCost numeric(18,4),
                         amount numeric(18,2)  ← GL-д бичигдэх MNT дүн (qty×cost),
                         counterAccountNumber, description,
                         status ('draft'|'posted'|'reversed'),
                         voucherId, sourceVoucherId, arApDocumentId (nullable),
                         reversalVoucherId, postedAt, createdAt
```

Конвенцууд (Cash/АР-АП-тай ижил): userId cascade FK, numeric нь string,
status enum text, optimistic-claim UPDATE, `$inferSelect` type export.
**Тоо хэмжээний precision `numeric(18,4)`** — мөнгөнөөс нарийн (шинэ прецедент).

`ar_ap_document_lines`-д **nullable** багана нэмнэ: `itemId`, `quantity`,
`warehouseId` — бараагүй мөр null хэвээр, GL логик өөрчлөгдөхгүй.

---

## 4. Server actions + амьдралын мөчлөг

`lib/actions/inventory.ts` ("use server"), Cash-ийн загвараар:

- `createInventoryItem / toggleInventoryItem`, `createWarehouse / toggleWarehouse`
- `createInventoryMovement(data, postNow?)` — draft insert; валидаци:
  идэвхтэй бараа/агуулах, qty>0, receipt-д unitCost>0, issue-д үлдэгдэл шалгах
- `postInventoryMovement(id)` — claim UPDATE (race guard) → GL voucher + 2 мөр
  (§2.2 template, `inventoryPostingCodeBuilder`-оор бүтэн 10 хэсэгт код) →
  voucherId холбох. **Adopt branch**: sourceVoucherId-тэй draft батлахад шинэ
  журнал үүсгэхгүй, эх воучерийг холбоно (Cash-тай яг ижил).
- `postInventoryMovements(ids[])` — batch, per-id failure тайлантай
- `reverseInventoryMovement(id)` — сторно воучер + status='reversed'.
  Зарлагыг буцаахад дундаж өртөг replay-гээр өөрөө зөв болно (цэвэр функц тул).
- `deleteInventoryMovement(id)` — зөвхөн draft

**Сегмент**: `inventoryPostingCodeBuilder` = `cashPostingCodeBuilder`-ийн клон,
S9-д **"IN"** тогтмол (Cash "CA" шиг server талд pin хийнэ). S4
(Бүтээгдэхүүн/Үйлчилгээ) идэвхтэй бол барааны кодоор автоматаар бөглөж болно.
Агуулах = **subledger-ийн л талбар** (GL сегмент БИШ) — BS/IS нь [3]-аар
aggregate хийдэг тул GL сегмент зөвхөн Trial Balance-д харагдах байсан;
шаардлагатай үед S2-д stamp хийх сонголтыг Үе 2-т үлдээв.

**Module key plumbing**: `ModuleKey`-д `"inv"` нэмэх — `MODULE_DEFS`,
`MODULE_LABELS`, `chartOfAccounts.modules` default, segmentValues/Configs-ийн
modules gating, S9 утгын жагсаалт.

---

## 5. Интеграцийн цэгүүд

### 5.1 АП нэхэмжлэх → орлогын draft
АП нэхэмжлэхийн мөр 14-бүлгийн данстай, `itemId + quantity`-тай бол батлагдах
үед `inventory_movements`-д **receipt draft** үүснэ: unitCost =
`baseLineAmount / quantity`, `sourceVoucherId` = нэхэмжлэхийн voucherId,
`arApDocumentId` холбоно. Батлахад adopt (GL давхар бичигдэхгүй).

### 5.2 АР нэхэмжлэх → COGS зарлагын draft
АР нэхэмжлэх зөвхөн орлогын талыг бичдэг (`Dr Авлага / Cr Орлого`) — **COGS
хөл өнөөдөр огт байхгүй**. Бараатай мөрийн хувьд батлагдах үед **issue draft**
үүснэ; түүнийг батлахад Dr 61100000 / Cr 14000001 (qty × тухайн үеийн avg_cost)
**шинэ воучер** үүсгэнэ (энэ нь эх воучерт байгаагүй бичилт тул adopt биш).

### 5.3 GL → Inventory reverse sync
Cash-ийн хос файлын загвар: цэвэр `lib/inventory/gl-sync.ts` (unit тесттэй) +
энгийн server модуль `lib/inventory/sync-voucher.ts` (**"use server" БИШ**).
14-данс хөндсөн, аль ч subledger-т холбогдоогүй воучер → draft.
**Гол ялгаа**: GL мөр зөвхөн MNT дүн өгдөг — **тоо хэмжээ үл мэдэгдэх
sentinel** (qty=0) draft үүсээд, бараа/агуулах/qty бөглөтөл батлагдахгүй
(валютын rate-sentinel-тэй ижил зарчим). Олон мөрт/тодорхойгүй воучерт null
(таамаглахгүй). **Backfill-ийн linked-set нь БҮХ subledger-ийн voucher
холбоосыг** (cash + arap + inventory) хамрах ёстой — эс бөгөөс АП-аас үүссэн
воучер давхар draft төрүүлнэ.

### 5.4 Кассын шууд худалдан авалт
Cash payment-д 14-данс counter болвол мөн qty-pending draft үүсгэнэ
(хориглохгүй — жижиг бэлэн худалдан авалт бодит хэрэгцээ).

### 5.5 Тайлангийн mapping
`lib/reports/bs-lines.ts`-д "inventory" мөр (prefix 14) аль хэдийн бий —
өөрчлөлт хэрэггүй. Seed дансуудад 14000001-ийг нэмэх (одоо SEED-д алга).

---

## 6. UI (Cash-ийн page-per-view загвар, workspace БИШ)

Sidebar (ангилалгүй, стандарт дараалал):

```
Бараа материал (id: "inventory", /inventory, icon: Package)
├── Хяналтын самбар     /inventory              ← үлдэгдэл, ноорог, хасах-эрсдэл, GL зөрүү
├── Хөдөлгөөн           /inventory/movements    ← Cash transactions-ийн UX-ийг бүрэн давтана:
│                                                  төрлийн таб + статус chip + batch батлах +
│                                                  мөр дарж дэлгэрэнгүй (эх GL журналтай) + GL badge
├── Тайлан              /inventory/reports      ← үлдэгдэл (qty×cost), хөдөлгөөний тайлан, GL тулгалт
└── Бараа, агуулах      /inventory/items        ← мастер дата (тохиргооны байрлалд, сүүлд)
```

- Бүх хүснэгт `DataGridDynamic`, шинэ багана төрөл хэрэгтэй бол
  `lib/grid/columnTypes.ts`-д (`quantity` — 4 орны бутархай, баруун зэрэгцүүлэлт).
- Шинэ хөдөлгөөний dialog: төрөл сонгох segmented control, бараа/агуулах
  SearchableSelect, qty + unitCost + тооцоолсон дүн (readonly), АП/АР
  нэхэмжлэхээс сонгох боломж (cash-ийн нэхэмжлэх picker-тэй ижил хэв).
- Дэлгэрэнгүй drawer: холбогдсон GL журнал / эх воучер + "Журнал нээх" линк.
- Хяналтын самбар Cash-ийн "онош" хэв маягаар: бараа бүрийн subledger value vs
  GL 14-дансны үлдэгдэл, зөрүүтэй бол шалтгаан + дараагийн алхмын линк.

---

## 7. Guardrail-ууд

1. **Хасах үлдэгдэл хориотой** — issue батлахад on-hand шалгана (даталсан
   он цагийн цэг дээр, өөрөөр хэлбэл өмнөх огноогоор бичихэд ч дараагийн
   бүх үлдэгдэл ≥ 0 хэвээр байхыг шалгана).
2. **Давхар бичилтээс хамгаалах** — sourceVoucherId + adopt; sync-ийн
   idempotency бүх subledger-ийг хамарна (§5.3).
3. **Qty-үнэ зөрөх drift** — GL тулгалтын тайлан (14-данс vs Σ movement value)
   үндсэн тайлангийн нэг; qty-sentinel draft батлагдахгүй.
4. **Том дүнгийн батлагдал** (>10M₮) — CLAUDE.md-ийн human-in-the-loop дүрмээр
   нэмэлт анхааруулга confirm-д харуулна.
5. **Огноогоор effective** — өртөг replay нь огноо + createdAt дарааллаар,
   тайлан asOf параметртэй.

---

## 8. Шийдэх асуултууд (хэрэгжүүлэхийн өмнө батлуулах)

1. **NRV бууруулалтын данс**: matrix шууд Cr 14000001 гэдэг, IAS 2 файл
   contra-нөөц данс гэдэг — аль нь? (Санал: matrix-ийг мөрдөж шууд кредитлэх,
   Үе 2-т шийднэ.)
2. **Буцаалтын урсгал**: KB-д template алга — sale/purchase-ийн mirror-reverse
   гэж үзэх үү? (Санал: тийм, Үе 2.)
3. **Нэг бараа олон дансанд** (14000001 vs 14000002 түлш г.м.) — бараа бүр өөрийн
   inventoryAccountNumber-тай байхаар шийдсэн; зөв үү?
4. **АР/АП draft-ын post action** одоо `lib/actions/arap.ts`-д алга (createArApDocument
   зөвхөн postNow) — inventory hook-оос ӨМНӨ энэ цоорхойг нөхөх шаардлагатай.

## 9. Хэрэгжүүлэх дараалал (Үе 1 дотор)

1. Schema + migration (items, warehouses, movements; arap lines-ийн nullable багана)
   + `"inv"` module key plumbing
2. `lib/inventory/costing.ts` (цэвэр, unit тест) + `load-data.ts`
3. `lib/actions/inventory.ts` (мастер дата + movement lifecycle + batch)
4. UI: items хуудас → movements хуудас (Cash transactions UX-ийг reuse) → dashboard → reports
5. Интеграц: АП→receipt, АР→COGS issue, GL sync + backfill, cash counter
6. Sidebar + тест + build + GL тулгалтын шалгалт
