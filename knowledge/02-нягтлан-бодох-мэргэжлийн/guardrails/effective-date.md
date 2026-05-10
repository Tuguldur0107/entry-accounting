---
id: guardrail:effective-date
title: Effective date guardrail
type: guardrail
severity: error
scope: [tax, payroll]
blocks_on: fail
---

# Effective date guardrail

## Policy

Tax rate, SI rate, PIT bracket, minimum wage, tax calendar бүрт **effective date version** хэрэглэсэн байх ёстой. `asOfDate`-гүй rate lookup хориглоно.

## Нарийн дүрэм

1. Бүх calculation tool input-д `asOfDate` эсвэл `periodId` шаардлагатай
2. Rate table-ээс effective version-ийг дараах rule-аар сонгоно:
   - `effectiveFrom <= asOfDate AND (effectiveTo IS NULL OR asOfDate < effectiveTo)`
3. Тохирох version олдохгүй бол → error, assumption бүү хий
4. Хэрэв `asOfDate` хэрэглэгч өгөөгүй бол → agent эргэж асуу, default хэрэглэж болохгүй
5. Effective date-аар зөв version сонгогдсон эсэх audit log-т хадгална

## Affected tools

- `calculate_vat`, `calculate_cit`, `calculate_wht`
- `calculate_social_insurance`, `calculate_pit`, `calculate_gross_to_net`
- `get_tax_calendar`
- `run_tax_validation`, `run_payroll_validation`

## Алдааны дүрэм

```
issue.severity = 'error'
issue.code = 'no_effective_rate'
issue.message = `${asOfDate}-д хүчинтэй rate олдсонгүй (${rateTable})`
issue.blocksDraft = true
issue.suggestedAction = 'Reference data-гаа шинэчлэх эсвэл зөв asOfDate өгөх'
```

## Reference data location

- `reference-data/tax-rates.json`
- `reference-data/si-rates.json`
- `reference-data/pit-brackets.json`
- `reference-data/minimum-wage.json`
- `reference-data/tax-calendar.json`
