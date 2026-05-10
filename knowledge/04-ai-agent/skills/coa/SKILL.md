---
name: coa
description: Entry chart of accounts reference. Use whenever you need to pick or validate a GL account code — 8-digit Segment3 codes plus the 10-segment full code structure. Required reading before writing any GL journal entry.
---

# Chart of Accounts Skill

Entry системийн дансны төлөвлөгөө. 8-оронтой Main Account код + 10-сегментийн бүтэц.

## Эх сурвалж

**Бүрэн жагсаалт:** `knowledge/03-стандарт/account-structure.md` — Read tool-оор унш.

## 10-сегмент бүтэц

```
101.000000.11000000.00.0000.000.0000.0000.00.0
 │     │       │     │   │   │   │    │   │ │
 1     2       3     4   5   6   7    8   9 10
```

| № | Нэр | Урт | DB хүснэгт |
|---|-----|-----|-----------|
| 1 | Company | 3 | `segment1_company` |
| 2 | Cost Center | 6 | `segment2_cost_center` |
| 3 | **Main Account** | **8** | `segment3_main_account` |
| 4 | Product / Service | 2 | `segment4_product_service` |
| 5 | Project | 4 | `segment5_project` |
| 6 | Inter Company | 3 | `segment6_inter_company` |
| 7 | Related Party | 4 | `segment7_related_party` |
| 8 | Cash Flow | 4 | `segment8_cash_flow` |
| 9 | Module | 2 | `segment9_modules` |
| 10 | Reserve | 1 | `segment10_reserve` |

## Segment3 — 8-digit Main Account бүлгүүд

| Бүлэг | Ангилал | Гол дансны код |
|-------|---------|----------------|
| **1X** Эргэлтийн хөрөнгө | 10 касс, 11 банк, 12 авлага, 13 санх. хөрөнгө, 14 бараа, 18 урьдчилгаа, 19 бусад | `11000001` Банк, `12000001` Авлага, `12000099` Авлагын нөөц, `14000001` Бараа |
| **2X** Эргэлтийн бус | 20 ҮХ, 21 биет бус, 24 хөр.оруулалт, 26 deferred tax, 27 ҮХХ, 29 бусад | `20000001` ҮХ, `20000002` Хур. элэгдэл, `21000001` Goodwill, `24000001` Equity invest, `26000001` Deferred tax asset, `29000001` HFS asset |
| **3X** Өр төлбөр | 31 богино өглөг, 32 богино зээл/нөөц, 33 урт өр | `31000001` Дансны өглөг, `31000002` Цалин өглөг, `31000003` Татварын өр, `32000004` Хойшлогдсон орлого, `32000005` Нөөц, `33000001` Lease liability, `33000002` Deferred tax liability |
| **4X** Эздийн өмч | 41 үндсэн, 42 нөөц, 43 валют, 44 хуримтлагдсан ашиг | `42000001` Дахин үнэлгээний нөөц, `44000001` Хуримтлагдсан ашиг |
| **5X** Орлого | 51 үйл ажиллагаа/бусад | `51000001` Орлого, `51000002` Бусад орлого |
| **6X** Өртөг | 60 COGS | `60000000` COGS |
| **7X** Удирдлага | 70 SG&A | `70000002` Элэгдэл/нөөц/ROU dep, `70000003` Цалин, `70000004` ААНОАТ |
| **8X** Санхүүгийн | 87 finance | `87000001` Хүүгийн зардал, `87000002` Бусад зардал/impairment, `87000003` FX gain/loss, `87000004` Goodwill impairment, `87000005` Equity loss |
| **9X** ОЗНД / нэгдсэн | 92 нэгтгэл | `92000000` Income summary |

> `*99` төгсгөлтэй — clearing / contra данс

## Хатуу дүрэм

1. **8-digit код** — заавал `segment3_main_account` хүснэгтэд бүртгэлтэй байх
2. **Active flag** — `active = true` дансыг л ашиглах
3. **Module access** — `gl/ar/ap/fa/cost/cash` flag-аар тухайн модулийн дансыг шүүх
4. **Шинэ код** — нэмэх хэрэгтэй бол migration файл бэлтгэх (жишээ: `database/*_migration.sql`)
5. **Tax-settings seed** — gl_*_account нэрээр `tax_settings` хүснэгтэд хадгалагдсан (жишээ: `gl_deferred_tax_asset`, `gl_hfs_writedown`)

## Хэрэглээ

Журнал бичихийн өмнө:
1. **Read `knowledge/03-стандарт/account-structure.md`** (хэрэгтэй хэсгийг)
2. Зөв 8-digit код сонгох
3. Module flag шалгах
4. `tax_settings`-ээс seed-тэй данс олох (configurable код)

```
Хэрэглэгч: "ROU asset элэгдэл бичихэд аль данс?"
Та:
  → coa skill: 70000002 (зардал) Dr / 20000002 (хур. элэгдэл) Cr
  → IFRS 16 reference: ifrs skill → ifrs-16-leases.md
```
