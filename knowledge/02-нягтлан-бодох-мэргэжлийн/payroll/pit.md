---
id: payroll:pit
title: ХАОАТ — Цалингийн орлогын татвар бүрэн тооцоолол
source: payroll
modules: [payroll]
law: ХАОАТ-ын тухай хууль (11, 23.1, 24 зүйл)
---

# ХАОАТ — Хувь хүний орлогын албан татвар (Payroll domain)

## Шатлалт татварын хувь (2026-аас)

| Сарын татвар ногдох орлого | Хувь |
|------------------------------|------|
| 0 – 10,000,000₮ | **10%** |
| 10,000,001 – 15,000,000₮ | **15%** |
| 15,000,001₮ + | **20%** |

> 2025 он хүртэл: **10% тогтмол** (flat). 2026-аас шатлалт.

## Татвар ногдох орлого

```
taxableIncome = totalEarnings − totalEmployeeSI
```

НДШ-ийг орлогоос хасаад үлдсэн дүн дээр татвар ногдуулна.

## Шатлалт тооцоолол

```javascript
function calculatePIT(taxableIncome) {
  const B1_LIMIT = 10_000_000, B1_RATE = 0.10
  const B2_LIMIT = 15_000_000, B2_RATE = 0.15
  const B3_RATE = 0.20

  if (taxableIncome <= 0) return 0

  if (taxableIncome <= B1_LIMIT) {
    return Math.round(taxableIncome * B1_RATE)
  }

  if (taxableIncome <= B2_LIMIT) {
    return Math.round(
      B1_LIMIT * B1_RATE +
      (taxableIncome - B1_LIMIT) * B2_RATE
    )
  }

  return Math.round(
    B1_LIMIT * B1_RATE +
    (B2_LIMIT - B1_LIMIT) * B2_RATE +
    (taxableIncome - B2_LIMIT) * B3_RATE
  )
}
```

## ХАОАТ-ын хөнгөлөлт (23.1 дүгээр зүйл)

Бага орлоготой ажилтнуудад татварын хөнгөлөлт олгоно:

| Татвар ногдох орлого | Хөнгөлөлтийн дүн |
|-----------------------|-------------------|
| ≤ 500,000₮ | 20,000₮ |
| ≤ 1,000,000₮ | 18,000₮ |
| ≤ 1,500,000₮ | 16,000₮ |
| ≤ 2,000,000₮ | 14,000₮ |
| ≤ 2,500,000₮ | 12,000₮ |
| ≤ 3,000,000₮ | 10,000₮ |
| > 3,000,000₮ | 0₮ |

```javascript
function pitCredit(taxableIncome) {
  if (taxableIncome <= 500000)  return 20000
  if (taxableIncome <= 1000000) return 18000
  if (taxableIncome <= 1500000) return 16000
  if (taxableIncome <= 2000000) return 14000
  if (taxableIncome <= 2500000) return 12000
  if (taxableIncome <= 3000000) return 10000
  return 0
}

// Эцсийн ХАОАТ
const pit = Math.max(0, calculatePIT(taxableIncome) - pitCredit(taxableIncome))
```

## ХАОАТ-аас чөлөөлөгдөх орлого

- Нэг удаагийн тусламж (гамшиг, гэмт хэргийн хохирол)
- Нөхөн олговор (хөдөлмөрийн чадвар алдалт)
- Тэтгэвэр
- Жирэмсний ба амаржсаны тэтгэмж

## Тайлагналын хугацаа

- ХАОАТ суутгалын тайлан → дараа сарын **10-нд**
- ТТ-11 жилийн тайлан → 2-р сарын **15-нд**
