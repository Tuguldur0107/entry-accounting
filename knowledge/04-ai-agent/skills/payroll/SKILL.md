---
name: payroll
description: Payroll calculation reference for Entry. Use when implementing salary calculations, social insurance (НДШ), health insurance (ЭМД), personal income tax (ХАОАТ), overtime, payslip generation, or payroll GL posting. Returns rates, formulas, and 8-digit GL accounts.
---

# Payroll Skill

Цалин тооцооллын модулийн мэдлэг. Gross→Net flow, НДШ/ЭМД/ХАОАТ, илүү цаг, GL posting.

## Мэдлэгийн эх сурвалж

`knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/` дотор. **Read** tool-оор шууд унш.

| Сэдэв | Файл |
|-------|------|
| Gross→Net flow | `gross-to-net-flow.md` |
| НДШ + ЭМД | `social-insurance.md` |
| ХАОАТ (PIT) | `pit.md` |
| Илүү цаг | `overtime.md` |
| GL журнал | `gl-journal.md` |
| Тайлан | `reporting.md` |
| Хуулийн лавлагаа | `law-reference.md` |
| Жишээ тооцоо | `worked-example.md` |

Индекс — `knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/_index.md`.

## Reference data

| Файл | Агуулга |
|------|---------|
| `knowledge/01-онол-хууль-стандарт/reference-data/si-rates.json` | НДШ/ЭМД хувь хэмжээ + cap |
| `knowledge/01-онол-хууль-стандарт/reference-data/pit-brackets.json` | ХАОАТ шатлал |
| `knowledge/01-онол-хууль-стандарт/reference-data/minimum-wage.json` | Хөдөлмөрийн доод хөлс |

## Хурдан лавлагаа

### НДШ (Social insurance)
- **Ажилтан:** 11.5%
- **Ажил олгогч:** 12.5%
- **Cap:** хөдөлмөрийн доод хөлсөөс 10 дахин (sireet `si-rates.json` лавлах)

### ЭМД (Health insurance)
- **Ажилтан:** 1%
- **Ажил олгогч:** 1%

### ХАОАТ (PIT)
- **Шатлал (сар):** 10/15/20%
- **Хувийн чөлөөлөлт:** сар бүр 240,000 ₮
- **Reference:** `pit-brackets.json`

### Илүү цаг
- **Ажлын өдөр:** 1.5×
- **Амралтын өдөр:** 2×
- **Шөнө:** 1.5×
- **Дэлгэрэнгүй:** `overtime.md`

### GL posting (жишээ загвар)
```
Цалин (gross):
  Dr 70000003 Цалингийн зардал
  Dr 70000003 НДШ ажил олгогч (12.5%)
  Dr 70000003 ЭМД ажил олгогч (1%)
    Cr 31000002 Цалин өглөг (net)
    Cr 31000003 НДШ суутгал (ажилтан 11.5%)
    Cr 31000003 ЭМД суутгал (ажилтан 1%)
    Cr 31000003 ХАОАТ суутгал

Цалин олгох:
  Dr 31000002 / Cr 11000001
```
Бүрэн жагсаалт — `gl-journal.md`.

## Хатуу дүрэм

1. **Дараалал:** Gross → НДШ → ЭМД → taxable income → ХАОАТ → Net
2. **SI cap** — хөдөлмөрийн доод хөлсөөс 10 дахин (cap-аас дээш суутгахгүй)
3. **Negative net** — таамаглал ✗ (заавал validation хийх)
4. **Effective date** — rate/bracket-ийг `asOfDate`-ээр lookup
5. **Journal balance** — Dr = Cr заавал
6. **Citation** — Хөдөлмөрийн хууль/НДХ хуулийн заалт иш татах

## Хэрэглээ

```
Хэрэглэгч: "Илүү цагийн нэмэгдэл бодуулах функц бичээрэй"
Та:
  1. Read knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/overtime.md
  2. Read knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/worked-example.md
  3. Хуулийн заалт (Хөдөлмөрийн хууль 53)
  4. payroll engine-ийн existing функцэд multiplier нэмэх
  5. Test data + journal balance
```
