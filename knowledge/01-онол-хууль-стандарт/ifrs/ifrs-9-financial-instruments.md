---
id: ifrs:ifrs-9
title: IFRS 9 — Санхүүгийн хэрэглүүр
standard: IFRS 9
standard_mn: СТОУС 9
modules: [ar, cash]
priority: p2
related: [ifrs-7, ias-32]
---

# IFRS 9 — Санхүүгийн хэрэглүүр (Financial Instruments)

**Модуль:** AR, Cash

## Авлагын хэмжилт

- Анхны хүлээн зөвшөөрөлт: Бодит үнэ цэнээр (ихэвчлэн нэхэмжлэлийн дүн)
- Дараагийн хэмжилт: Хорогдуулсан өртгөөр (amortized cost)

## Expected Credit Loss (ECL) — Хүлээгдэж буй зээлийн алдагдал

- **Хялбаршуулсан арга (Simplified approach)** — авлагад зориулсан:
  - Provision matrix ашиглана
  - Хугацаа хэтэрсэн хоногоор бүлэглэнэ

| Хугацаа хэтэрсэн | ECL хувь (жишиг) |
|-------------------|-------------------|
| Хэвийн (0-30 хоног) | 1% |
| 31-60 хоног | 5% |
| 61-90 хоног | 10% |
| 91-180 хоног | 25% |
| 181-365 хоног | 50% |
| 365+ хоног | 100% |

## GL журнал

```
ECL нөөц бүртгэх:
  Dr 87000002 Найдваргүй авлагын зардал  / Cr 12000001 Авлагын алдагдлын нөөц (contra)

Авлага хасах (write-off):
  Dr 12000001 Авлагын алдагдлын нөөц     / Cr 12000001 Авлага
```

## Ангилал (classification)

- **Amortized cost:** Hold to collect business model + SPPI (principal+interest only)
- **FVOCI:** Hold to collect and sell business model
- **FVTPL:** Бусад бүх хөрөнгө (trading, derivative)

## Hedge accounting

- Cash flow hedge, fair value hedge, net investment hedge
- Effective portion → OCI, ineffective → P&L

## Checklist

- [ ] ECL provision matrix компанийн түүхэн алдагдлаар calibrate-лэгдсэн эсэх
- [ ] Авлагын насжилт сар бүр update-тэй эсэх
- [ ] Bad debt write-off approval workflow байгаа эсэх
