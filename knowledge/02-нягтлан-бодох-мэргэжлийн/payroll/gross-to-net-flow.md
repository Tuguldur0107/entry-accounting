---
id: payroll:gross-to-net
title: Цалин бодолтын бүрэн урсгал (Gross → Net)
source: payroll
modules: [payroll]
---

# Цалин бодолтын бүрэн урсгал (Gross → Net)

```
┌─────────────────────────────────────────────────────┐
│  1. Үндсэн цалин (Base Salary)                      │
│     + Илүү цагийн хөлс (Overtime Pay)               │
│     + Урамшуулал (Bonus)                            │
│  ═══════════════════════════════════════════════    │
│  = Нийт олголт (Total Earnings / Gross)             │
│                                                     │
│  2. Суутгал:                                        │
│     − Ажилтны НДШ (11.5%)                           │
│       • Тэтгэвэр: 8.5%                              │
│       • Тэтгэмж: 0.8%                               │
│       • Ажилгүйдэл: 0.2%                            │
│       • ЭМД: 2.0%                                   │
│     − ХАОАТ (10% / 15% / 20% шатлалт)               │
│     − Бусад суутгал                                 │
│  ═══════════════════════════════════════════════    │
│  = Гарт олгох цалин (Net Salary)                    │
│                                                     │
│  3. Ажил олгогчийн зардал (нэмэлтээр):              │
│     + Ажил олгогчийн НДШ (12.5%+)                   │
│       • Тэтгэвэр: 8.5%                              │
│       • Тэтгэмж: 1.0%                               │
│       • Ажилгүйдэл: 0.2%                            │
│       • ЭМД: 2.0%                                   │
│       • ҮОМШӨ: 0.8% (салбараас хамаарна)            │
│  ═══════════════════════════════════════════════    │
│  = Нийт хөдөлмөрийн зардал (Total Labor Cost)       │
└─────────────────────────────────────────────────────┘
```

## Формул

```js
grossSalary = baseSalary × (workedHours / workHours)
overtimePay = (baseSalary / workHours) × overtimeRate × overtimeHours
totalEarnings = grossSalary + overtimePay + bonus

employeeSI = min(totalEarnings, siCap) × 11.5%
taxableIncome = max(0, totalEarnings − employeeSI)
pit = progressivePIT(taxableIncome) − pitCredit(taxableIncome)

netSalary = totalEarnings − employeeSI − pit − otherDeductions
employerSI = min(totalEarnings, siCap) × (12.5% + accidentRate)
totalLaborCost = totalEarnings + employerSI
```

## Гол нөхцөлүүд

- `siCap = minimumWage × capMultiplier` (2025: 792,000 × 10 = 7,920,000₮)
- Employer rate жилээс хамаарна (2026: 14.5% хүртэл)
- `accidentRate` ҮОМШӨ салбараас (0.8–3.0%)
- PIT шатлалт ба хөнгөлөлт effective date-тэй
