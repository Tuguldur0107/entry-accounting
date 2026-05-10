---
name: ifrs
description: IFRS/IAS standards reference for the Entry accounting system. Use when writing GL journals, period-close logic, financial statements, depreciation, lease/revenue/impairment recognition, fair value, consolidation, EPS — anything that has to obey IFRS or NББОУС rules. Cite the exact standard paragraph (e.g. "IAS 16.31"). Returns 8-digit account codes consistent with Entry's chart of accounts.
---

# IFRS / НББОУС Skill

Entry системийн **IFRS / IAS** стандарт лавлагаа. Код бичих, журнал бүртгэх, тайлан гаргах, бодлого тогтоохдоо энэ skill-ийг ашиглана.

## Мэдлэгийн эх сурвалж

Бүх стандарт тус тусдаа файлд `knowledge/01-онол-хууль-стандарт/ifrs/`-д байна. Хэрэгтэй стандартыг **Read** tool-оор шууд унш — энд бүгдийг хуулж тавьсангүй.

| Стандарт | Файл | Хэзээ хэрэглэх |
|----------|------|----------------|
| IAS 1 | `ias-1-presentation.md` | Тайлан танилцуулах, period close |
| IAS 2 | `ias-2-inventory.md` | Бараа материал, NRV |
| IAS 7 | `ias-7-cashflow.md` | Мөнгөн гүйлгээний тайлан |
| IAS 8 | `ias-8-policies-errors.md` | Бодлогын өөрчлөлт, prior period adjustment |
| IAS 10 | `ias-10-events-after.md` | Тайлангийн дараах үйл явдал |
| IAS 12 | `ias-12-income-taxes.md` | ААНОАТ, deferred tax |
| IAS 16 | `ias-16-ppe.md` | Үндсэн хөрөнгө, элэгдэл, дахин үнэлгээ |
| IAS 19 | `ias-19-employee-benefits.md` | Ажилтны хангамж |
| IAS 20 | `ias-20-grants.md` | Засгийн газрын тусламж |
| IAS 21 | `ias-21-foreign-exchange.md` | Валютын дахин үнэлгээ (FX) |
| IAS 23 | `ias-23-borrowing-costs.md` | Зээлийн зардал капитализаци |
| IAS 24 | `ias-24-related-party.md` | Хамааралтай тал |
| IAS 28 | `ias-28-associates.md` | Equity method |
| IAS 32 | `ias-32-fi-presentation.md` | Санхүүгийн хэрэглүүр — танилцуулга |
| IAS 33 | `ias-33-eps.md` | EPS — нэгж хувьцаанд ногдох ашиг |
| IAS 34 | `ias-34-interim.md` | Interim тайлан |
| IAS 36 | `ias-36-impairment.md` | Үнэ цэнийн бууралт |
| IAS 37 | `ias-37-provisions.md` | Нөөц, болзошгүй өр |
| IAS 38 | `ias-38-intangible.md` | Биет бус хөрөнгө |
| IAS 40 | `ias-40-investment-property.md` | Хөрөнгө оруулалтын ҮХ |
| IAS 41 | `ias-41-agriculture.md` | Хөдөө аж ахуй |
| IFRS 3 | `ifrs-3-business-combinations.md` | Бизнесийн нэгдэл, гүүдвилл |
| IFRS 5 | `ifrs-5-held-for-sale.md` | Борлуулахаар эзэмшиж буй хөрөнгө |
| IFRS 7 | `ifrs-7-fi-disclosure.md` | Санхүүгийн хэрэглүүр — тодруулга |
| IFRS 8 | `ifrs-8-segments.md` | Үйл ажиллагааны сегмент |
| IFRS 9 | `ifrs-9-financial-instruments.md` | ECL, classification |
| IFRS 10 | `ifrs-10-consolidation.md` | Нэгтгэсэн тайлан, NCI |
| IFRS 13 | `ifrs-13-fair-value.md` | Бодит үнэ цэнэ (Level 1/2/3) |
| IFRS 15 | `ifrs-15-revenue.md` | Орлого хүлээн зөвшөөрөх (5 алхам) |
| IFRS 16 | `ifrs-16-leases.md` | Түрээс, ROU asset, lease liability |

Индекс бүхэн `knowledge/01-онол-хууль-стандарт/ifrs/_index.md`-д.

## Workflow & guardrails

| Файл | Зорилго |
|------|---------|
| `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/journal-entry.md` | GL журналын ажлын урсгал |
| `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/period-close.md` | Хаалтын процедур (depreciation, FX, accruals, reclassification) |
| `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/module-mapping.md` | IFRS standard ↔ Entry module хамаарал |
| `knowledge/02-нягтлан-бодох-мэргэжлийн/guardrails/journal-balance.md` | Dr=Cr хатуу шалгалт |
| `knowledge/02-нягтлан-бодох-мэргэжлийн/guardrails/effective-date.md` | Effective date lookup |

## Дансны код — хурдан лавлах

Entry нь **8 оронтой Segment3** дансны код ашиглана:

| Бүлэг | Ангилал |
|-------|---------|
| 1X | Эргэлтийн хөрөнгө (10 касс, 11 банк, 12 авлага, 13 санх. хөрөнгө, 14 бараа, 18 урьдчилгаа) |
| 2X | Эргэлтийн бус хөрөнгө (20 ҮХ, 21 биет бус, 24 урт. хөр.оруулалт, 26 deferred tax, 27 хөр.оруулалтын ҮХХ, 29 бусад) |
| 3X | Өр төлбөр (31 богино өглөг, 32 богино зээл/нөөц, 33 урт өр) |
| 4X | Эздийн өмч (41 үндсэн, 42 дахин үнэлгээ, 43 валютын нөөц, 44 хуримтлагдсан ашиг) |
| 5X | Орлого |
| 6X | Өртөг (COGS) |
| 7X | Удирдлагын зардал |
| 8X | Санхүүгийн зардал (87) |
| 9X | ОЗНД / нэгтгэсэн (92) |

Бүрэн жагсаалт — **`coa` skill** эсвэл `knowledge/03-стандарт/account-structure.md`.

## Гол GL загварууд (хурдан лавлагаа)

```
Элэгдэл (IAS 16):       Dr 70000002 / Cr 20000002
FX revaluation (IAS 21): AR ашиг → Dr 12000001 / Cr 87000003
Impairment (IAS 36):    Dr 87000002 / Cr 20000002
Lease month (IFRS 16):  Dr 70000002 ROU dep / Cr 20000002
                        Dr 87000001 хүү / Cr 33000001 lease liab
                        Dr 33000001 / Cr 11000001 төлбөр
ECL (IFRS 9):           Dr 87000002 / Cr 12000099
Provision (IAS 37):     Dr 70000002 / Cr 32000005
Year-end close:         Dr 51* / Cr 44000001 (орлого хаалт)
                        Dr 44000001 / Cr 6*-8* (зардал хаалт)
PPA (IAS 8):            Dr/Cr 44000001 (prior period)
```

Дэлгэрэнгүй журналыг тухайн стандартын файлд буюу `knowledge/01-онол-хууль-стандарт/ifrs/<standard>.md`-д.

## Хатуу дүрэм

1. **Dr = Cr** — баланс заавал
2. **Period validation** — хаагдсан period-д бичиж болохгүй (`checkPeriodOpen` middleware)
3. **8-digit код** — Segment3 хүснэгтэд байх ёстой
4. **Standard citation** — иш татахдаа яг параграф (IAS 16.31, IFRS 9.5.5)
5. **Effective date** — rate/threshold-ийг `asOfDate`-ээр lookup

## Хэрэглээ

```
Хэрэглэгч: "Lease month-end posting хийгээрэй"
Та:
  1. Read knowledge/01-онол-хууль-стандарт/ifrs/ifrs-16-leases.md
  2. Read knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/journal-entry.md (хэрэгтэй бол)
  3. Backend route, schema-г шалгах
  4. Dr/Cr баланстай журнал, 8-digit код, period check бүхий код бичих
  5. IFRS 16.36 гэх параграф иш татах
```
