---
id: guardrail:si-cap
title: Social insurance cap guardrail
type: guardrail
severity: error
scope: [payroll]
blocks_on: fail
---

# НДШ / ЭМД cap guardrail

## Policy

Нийгмийн даатгалын шимтгэл нь **доод цалин × cap multiplier** (одоогоор 10)-аас илүү орлогод ногдохгүй. Cap-ээс дээш gross-тэй ажилтанд SI нь cap-аар тооцогдсон байх ёстой.

## Нарийн дүрэм

1. `siCap = minimumWage × siCapMultiplier` (reference-data/si-rates.json + minimum-wage.json)
2. `cappedBase = min(totalEarnings, siCap)`
3. Employee SI = `cappedBase × 11.5%`
4. Employer SI (ex. accident) = `cappedBase × 12.5%`
5. ҮОМШӨ (accident) = `cappedBase × accidentRate` (sector-specific)
6. Computed SI > `siCap × maxRate` бол → error
7. `negative_net` — ажилтны net салын цалин < 0 бол → error

## Affected tools

- `calculate_social_insurance`
- `calculate_gross_to_net`
- `run_payroll_validation({ validationSet: 'si_cap' | 'negative_net' })`

## Алдааны дүрэм

```
issue.severity = 'error'
issue.code = 'si_cap_exceeded' | 'negative_net_salary'
issue.message = `SI cap breach: computed ${x}, max allowed ${maxAllowed}` |
                `Negative net salary: ${netAmount} < 0`
issue.blocksDraft = true
```

## Edge cases (ялгавартай)

- **Minimum wage шинэчилсэн сард:** effective date-аар rate version солигдоно
- **Ажилтны override:** `hr_employees.custom_si_rate` байвал default-ээс түрүүлнэ (гэхдээ cap хэвээр)
- **Шинэ ажилтан middle-of-month:** ажилласан өдрөөр дугуйрлаж prorate
