---
name: mongolian-tax
description: Mongolian tax law reference for Entry. Use when implementing VAT (НӨАТ), corporate income tax (ААНОАТ), personal income tax (ХАОАТ), withholding tax (WHT), eBarimt, tax filing schedules, penalties, or anything tied to Mongolian tax compliance. Returns rates, brackets, and GL postings consistent with the system.
---

# Mongolian Tax Skill

Монгол Улсын татварын хууль, тооцоолол, тайлагнах хуваарь. Татвартай холбоотой код бичих, тооцоолол хийх үед энэ skill-ийг ашиглана.

## Мэдлэгийн эх сурвалж

`knowledge/01-онол-хууль-стандарт/tax/` дотор бэлэн. **Read** tool-оор шууд унш.

| Сэдэв | Файл |
|-------|------|
| Тойм | `overview.md` |
| НӨАТ | `vat.md` |
| ААНОАТ | `cit.md` |
| ХАОАТ | `pit.md` |
| Суутган татвар (WHT) | `wht.md` |
| Онцгой албан татвар | `excise.md` |
| Үл хөдлөх хөрөнгийн татвар | `property.md` |
| еBarimt | `ebarimt.md` |
| Торгууль | `penalties.md` |
| 2026 шинэчлэлт | `2026-updates.md` |

Индекс — `knowledge/01-онол-хууль-стандарт/tax/_index.md`.

## Reference data (effective-dated JSON)

| Файл | Агуулга |
|------|---------|
| `knowledge/01-онол-хууль-стандарт/reference-data/tax-rates.json` | НӨАТ, ААНОАТ, WHT хувь хэмжээ |
| `knowledge/01-онол-хууль-стандарт/reference-data/pit-brackets.json` | ХАОАТ шатлал |
| `knowledge/01-онол-хууль-стандарт/reference-data/tax-calendar.json` | Тайлан өгөх хуваарь |

> Effective date важна — `asOfDate` ашиглан тухайн үеийн rate-ийг сонго.

## Хурдан лавлагаа

### НӨАТ
- **Хувь:** 10% (стандарт), 0% (экспорт)
- **Босго:** Жилийн борлуулалт ≥ 50 сая ₮ (хувь хүн), ≥ 50 сая ₮ (ААН) — заавал бүртгүүлэх
- **Тайлан:** TT-01, сар бүр 10-ны дотор
- **GL:** `Dr 31000003 / Cr 12000002` (offset netting)

### ААНОАТ
- **Шатлал:** 0–6 тэрбум ₮ → 10%, 6+ тэрбум → 25%
- **Тайлан:** Q1/Q2/Q3 YTD + жилийн эцэс (TT-02)
- **Deferred tax:** IAS 12 — `gl_deferred_tax_asset=26000001`, `gl_deferred_tax_liability=33000002`
- **GL:** `Dr 70000004 / Cr 31000003`

### ХАОАТ (PIT)
- **Шатлал (жилийн):** 0–120 сая → 10%, 120–180 сая → 15%, 180+ → 20%
- **Хувийн чөлөөлөлт:** сар бүр 240,000 ₮
- **Reference:** `pit-brackets.json` (effective-dated)

### WHT
- **Резидент:** 10%
- **Резидент бус:** 20%
- **GL:** AP invoice дээр additive — `Dr 31000001 / Cr 31000003 (WHT өр)`

### Е-баримт
- **Хуулиар:** заавал (2016 оноос)
- **Торгууль:** 40% хүртэл
- **API:** DDTD `put`, `return`, `send`
- **Баримтын төрөл:** Байгууллага (ТТД-аар) / Хувь хүн (РД / lottery)
- **Дэлгэрэнгүй:** `ebarimt.md`

## Хатуу дүрэм

1. **Effective date заавал** — rate/threshold lookup-д `asOfDate` өг.
2. **Citation** — хууль иш татахдаа зүйл/заалт ("ААНОАТ 20.2", "ХАОАТ 12.1.а")
3. **Е-баримт** — POS/AR борлуулалтад автомат илгээх
4. **WHT** — нийлүүлэгчийн `wht_type/wht_rate` авч AP invoice-д тооцоолох
5. **Penalty** — overdue/торгуулийг `tax-calendar.json`-оор шалгах

## Хэрэглээ

```
Хэрэглэгч: "POS борлуулалтад НӨАТ автомат бодуулах endpoint бичээрэй"
Та:
  1. Read knowledge/01-онол-хууль-стандарт/tax/vat.md
  2. Read knowledge/01-онол-хууль-стандарт/reference-data/tax-rates.json
  3. backEnd/utils/vatHelper.js шалгах (бэлэн loaded)
  4. POS route-д VAT calc + е-баримт send + GL posting нэмэх
```
