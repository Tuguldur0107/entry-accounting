---
id: tax:_index
title: Монгол татварын knowledge index
source: tax
---

# Монгол татварын knowledge index

| Сэдэв | Файл | Тайлбар |
|-------|------|---------|
| Ерөнхий бүтэц | [overview.md](overview.md) | Бүх татварын хурааангуй + хувь + модуль mapping |
| НӨАТ | [vat.md](vat.md) | 10%, exclusive/inclusive, e-баримт, GL |
| ААНОАТ | [cit.md](cit.md) | 10%/25%, quarterly + annual, deductible, DTA/DTL |
| ХАОАТ | [pit.md](pit.md) | Товч лавлагаа — бүрэн тооцоолол payroll/-д |
| Суутган татвар (WHT) | [wht.md](wht.md) | 10%/20% — individual/entity/non-resident |
| Онцгой албан татвар | [excise.md](excise.md) | Alcohol, tobacco, fuel |
| Үл хөдлөх хөрөнгийн татвар | [property.md](property.md) | 0.1-1% газар, 0.6% барилга |
| Е-баримт | [ebarimt.md](ebarimt.md) | ВАТ цахим баримт API |
| Торгууль | [penalties.md](penalties.md) | 0.1% өдөр, 20-50% misstatement |
| 2026 шинэчлэлт | [2026-updates.md](2026-updates.md) | ХАОАТ шатлалт, НӨАТ 400M, НДШ 14.5% |

## Эрхлэх даалгавар

- **Effective date заавал.** Rate, threshold, bracket бүрийг `reference-data/tax-rates.json`, `reference-data/pit-brackets.json` зэргээс `asOfDate` эсвэл `periodId`-аар lookup хийнэ.
- **Payroll tax-г энд бүү давхардуул.** НДШ/ЭМД/цалингийн ХАОАТ бүрэн тооцоолол нь `payroll/` knowledge folder-д байна.
- **Нарийн тоо хэмжээг `reference-data/`-аас ав.** Эндэх markdown нь rule + workflow + GL жишээ зорилготой.
