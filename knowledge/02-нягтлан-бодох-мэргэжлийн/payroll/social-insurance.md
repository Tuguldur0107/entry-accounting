---
id: payroll:social-insurance
title: НДШ / ЭМД — Нийгмийн даатгалын шимтгэл
source: payroll
modules: [payroll]
law: Нийгмийн даатгалын тухай хууль (15, 19, 20 зүйл)
cross_references: [ifrs:ias-19]
---

# НДШ — Нийгмийн даатгалын шимтгэл

## Ажилтны НДШ (нийт 11.5%)

| Төрөл | Хувь | Тайлбар |
|-------|------|---------|
| Тэтгэврийн даатгал | 8.5% | Өндөр насны тэтгэвэр |
| Тэтгэмжийн даатгал | 0.8% | Хөдөлмөрийн чадвар алдалт, жирэмсэн |
| Ажилгүйдлийн даатгал | 0.2% | Ажилгүй болсон үед |
| Эрүүл мэндийн даатгал (ЭМД) | 2.0% | Эмнэлгийн зардал |
| **Нийт** | **11.5%** | |

## Ажил олгогчийн НДШ (нийт 12.5% + ҮОМШӨ)

| Төрөл | Хувь | Тайлбар |
|-------|------|---------|
| Тэтгэврийн даатгал | 8.5% | |
| Тэтгэмжийн даатгал | 1.0% | Ажилтнаас 0.2% илүү |
| Ажилгүйдлийн даатгал | 0.2% | |
| Эрүүл мэндийн даатгал (ЭМД) | 2.0% | |
| ҮОМШӨ (Үйлдвэрлэлийн осол) | 0.8%–3.0% | Салбар, эрсдэлээс хамаарна |
| **Нийт** | **12.5%–14.5%** | |

## ҮОМШӨ салбарын хувь

| Салбар | Хувь |
|--------|------|
| Оффис, үйлчилгээ, худалдаа | 0.8% |
| Хөнгөн үйлдвэрлэл | 1.0% |
| Барилга | 1.5% |
| Хүнд үйлдвэр | 2.0% |
| Уул уурхай | 2.5%–3.0% |

## НДШ-ийн дээд хязгаар (Cap)

```
Шимтгэл ногдуулах дээд орлого = Хөдөлмөрийн хөлсний доод хэмжээ × 10

2025 оны байдлаар:
  Доод цалин: 792,000₮
  Дээд хязгаар: 792,000 × 10 = 7,920,000₮/сар

  Хэрэв цалин > 7,920,000₮ бол:
    НДШ = 7,920,000 × хувь (илүү хэсэгт НДШ ногдуулахгүй)
```

## Тооцоолол (JavaScript)

```javascript
// Дээд хязгаар тооцоолох
const siCap = minimumWage * siCapMultiplier   // 792,000 × 10
const cappedBase = Math.min(totalEarnings, siCap)

// Ажилтны НДШ
const si_pension       = Math.round(cappedBase * 0.085)
const si_benefit       = Math.round(cappedBase * 0.008)
const si_unemployment  = Math.round(cappedBase * 0.002)
const si_health        = Math.round(cappedBase * 0.02)
const totalEmployeeSI  = si_pension + si_benefit + si_unemployment + si_health

// Ажил олгогчийн НДШ
const emp_pension       = Math.round(cappedBase * 0.085)
const emp_benefit       = Math.round(cappedBase * 0.01)
const emp_unemployment  = Math.round(cappedBase * 0.002)
const emp_health        = Math.round(cappedBase * 0.02)
const emp_accident      = Math.round(cappedBase * accidentRate)  // 0.008 default
const totalEmployerSI   = emp_pension + emp_benefit + emp_unemployment + emp_health + emp_accident
```

## Тайлагнал

- НДШ шимтгэлийн тайлан → дараа сарын **5-нд**
- НДШ жилийн тайлан → 2-р сарын **15-нд**
- Шимтгэл төлөх хугацаа → дараа сарын **5-нд** (хоцорвол 0.1%/хоног алданги)
