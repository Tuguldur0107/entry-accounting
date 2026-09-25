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

Дансууд нь Entry-д `arap_ecl_settings`-ийн РОЛЬ (default доорх) — стандарт
жагсаалтын 12000001 «Дансны авлага», 12000099 «Авлагын ECL нөөц» (ENT-065,
D-ECL-1; өмнөх хувилбарт нөөц ба авлага хоёулаа 12000001 гэж алдаатай байв).

```
ECL нөөц бүртгэх (сарын delta = шаардлагатай − одоогийн нөөц):
  Dr 87000002 ECL зардал                 / Cr 12000099 Авлагын ECL нөөц (contra)

Авлага хасах (write-off) — эхлээд нөөцөөс, хүрэхгүй хэсэг нь шууд зардал:
  Dr 12000099 Авлагын ECL нөөц           / Cr 13110000 Авлага (нэхэмжлэлийн хяналтын данс)
  Dr 87000002 ECL зардал (үлдэгдэл)

Хассан авлагын сэргэлт (recovery) — зардлыг бууруулна, дараа нь кассаар хаана:
  Dr 13110000 Авлага                     / Cr 87000002 ECL зардал
  Dr Касс/Банк                           / Cr 13110000 Авлага

Хойшлогдсон татвар (IAS 12) — нөөц нь татварын хасагдах зардал биш бол:
  Dr 26000001 DTA                         / Cr 70000004 Хойшлогдсон татварын зардал
  (DTA = ECL нөөц × ААНОАТ-ын хувь; хасалт татварт хасагдах эсэх нь ААНОАТ-ын
   хуулийн нөхцөлөөр — шүүхийн шийдвэр, хөөн хэлэлцэх хугацаа г.м.)
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
