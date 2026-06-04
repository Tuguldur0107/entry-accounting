---
id: workflow:cash-management
title: Cash модуль — Мөнгөн гүйлгээ ба банкны бүртгэл
type: workflow
modules: [cash, gl, reports]
standards: [IAS 7, IAS 21]
---

# Cash модуль — Мөнгөн гүйлгээ (Cash Management)

Энэ баримт нь тарсан мэдээллийг (IAS 7, event-flows E2/E4, table-inventory §4,
segment-strategy S8/S9) нэг дор нэгтгэв. Cash модулийн **бодит реализаци** үүнийг
дагана.

## 1. Зорилго

Касс болон банкны харилцах дансны мөнгөн орлого/зарлагыг бүртгэж, **давхар
бичилтийн зарчмаар GL журнал автоматаар үүсгэх**, улмаар IAS 7 мөнгөн гүйлгээний
тайлан гаргах.

## 2. Өгөгдлийн бүтэц (schema)

### `bank_accounts` — кассын/банкны данс
| Багана | Утга |
|--------|------|
| `id` | uuid |
| `userId` | эзэмшигч |
| `accountNumber` | холбогдох GL данс (`10xxxxxx` касс / `11xxxxxx` банк) |
| `name` | "Голомт MNT харилцах" |
| `currency` | MNT / USD … |
| `isActive` | идэвхтэй эсэх |

### `bank_transactions` — мөнгөн гүйлгээ
| Багана | Утга |
|--------|------|
| `bankAccountId` | аль данс |
| `date` | YYYY-MM-DD |
| `direction` | `inflow` \| `outflow` *(CHECK)* |
| `amount` | дүн (numeric 18,2, эерэг) |
| `contraAccount` | нөгөө тал данс (орлого/зардал/авлага/өглөг) |
| `cfCategory` | `operating` \| `investing` \| `financing` *(CHECK, IAS 7)* |
| `counterparty` | харьцагч |
| `description`, `reference` | тайлбар |
| `source` | `manual` \| `ar` \| `ap` \| `import` *(CHECK)* |
| `sourceId` | эх бичлэгийн id (AR/AP холболтод) |
| `status` | `draft` \| `posted` *(CHECK)* |
| `reconStatus` | `unreconciled` \| `matched` \| `cleared` *(CHECK)* |
| `voucherId` | post хийхэд үүссэн GL журналын id |

> ⚠️ **Audit-аас**: `direction/cfCategory/status/reconStatus`-г заавал **CHECK
> constraint**-аар хязгаарлана (GL `journal_vouchers.status` чөлөөт text байсан
> алдааг давтахгүй).

## 3. Гүйлгээний урсгал (E2/E4 нэгтгэсэн)

Бүх олон-table бичилт **нэг `db.transaction` дотор** (атомик).

### Inflow (орлого — E2 AR төлбөр г.м.)
```
[Step 1] bank_transactions INSERT (direction='inflow', status)
[Step 2] status='posted' бол → journal_vouchers + lines INSERT:
   Dr <bankAccount.accountNumber>   amount   (мөнгө орж ирэв)
   Cr <contraAccount>               amount   (орлого / авлага бууралт)
[Step 3] voucherId-г bank_transactions-д буцааж холбоно
```

### Outflow (зарлага — E4 AP төлбөр г.м.)
```
   Dr <contraAccount>               amount   (зардал / өглөг бууралт)
   Cr <bankAccount.accountNumber>   amount   (мөнгө гарав)
```

Дүн нэг тул journal **бүтцээрээ балансална** (D = C).

## 4. Posted lock + сторно

GL-тэй ижил бодлого:
- `posted` гүйлгээг **засах/устгах хориотой** — сторно (reversing) бичилт ашиглана.
- `draft` гүйлгээг чөлөөтэй засаж/устгаж болно.

## 5. IAS 7 тайлан (reports)

| Таб | Тооцоо |
|-----|--------|
| **Үлдэгдэл** | банк бүрээр: openingBalance + Σ(inflow) − Σ(outflow) |
| **Direct cash flow** | `cfCategory`-аар бүлэглэж inflow/outflow цэвэр дүн |
| **Indirect** *(дараа)* | цэвэр ашиг + элэгдэл ± ажлын капитал (IAS 7 reconciliation) |

`cfCategory` гурван ангилал — IAS 7-ийн Operating / Investing / Financing.

## 6. Хүрээ (scope)

### Энэ хувилбарт (V1)
- ✅ Гар гүйлгээ + GL автомат posting
- ✅ Банкны данс удирдлага
- ✅ Үлдэгдэл + direct cash flow тайлан

### Дараагийн фаз (follow-up)
- [ ] **Reconciliation** — bank statement vs системийн гүйлгээ тулгалт (table-inventory §4.2)
- [ ] **Statement import** — CSV/Excel оруулж auto-match (event-flows §3 "Cash module §4.4")
- [ ] **AR/AP холболт** — `source='ar'|'ap'` автомат гүйлгээ (E2/E4 бүрэн)
- [ ] **Multi-currency FX reval** — IAS 21 period-close ханшийн зөрүү (E12)
- [ ] **Indirect cash flow** тайлан

## 7. Холбогдох баримт
- [IAS 7](../../01-онол-хууль-стандарт/ifrs/ias-7-cashflow.md) — мөнгөн гүйлгээний тайлан
- [Event flows §3 (E2), §5 (E4)](../../03-стандарт/05-event-flows.md)
- [Table inventory §4](../../03-стандарт/ui-standards/07-table-inventory.md) — Cash дэлгэцүүд (Chakra spec — энэ төсөлд shadcn-аар буулгана)
- [Segment strategy §7.2](../../03-стандарт/segment-strategy.md) — S8 cf_category, S9 module
- [GL posting matrix](../01-gl-posting-matrix.md) — кассын/банкны данс
