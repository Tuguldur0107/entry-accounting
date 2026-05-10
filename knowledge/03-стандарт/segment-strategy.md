# 07 — Сегментийн стратеги (Account Combination Strategy)

Entry-ийн GL дансны кодын **10 сегментийн бүтэц**, ашиглалтын бодлого, validation дүрэм, default mapping, тайлангийн integration-ыг нэг дор баримтжуулсан баримт. Энэ нь architecture, database, reporting design гурвыг **нэг бодлогоор хэлхдэг** master file.

> **Гол санаа:** Main account-ыг хэт олшруулахгүйгээр өртөг бодолт, нэгтгэсэн тайлан, intercompany elimination, monthly cash flow, related-party disclosure, source-module reconciliation бүгдийг **сегмент-ээр хэвтээ зүсэлтээр** хийнэ.

---

## 7.1 Сегмент мастер лавлах

Бүрэн кодын жишээ:

```text
101.100100.51100000.11.1001.201.9001.1101.14.1
```

**Нийт урт:** 37 оронтой (3+6+8+2+4+3+4+4+2+1). Цэгээр тусгаарласан display нь **46 тэмдэгт**.

| № | Файлын нэр | Сегментийн нэр | Урт | Database table | Эх үүсвэр |
|---|------------|----------------|----:|----------------|-----------|
| 1 | `segment1` | Company | 3 | `segment1_company` | Tenant + Company master |
| 2 | `segment2` | Cost Center | 6 | `segment2_cost_center` | Cost master |
| 3 | `segment3` | Main Account | 8 | `segment3_main_account` | Chart of Accounts |
| 4 | `segment4` | Product / Service | 2 | `segment4_product_service` | Product master |
| 5 | `segment5` | Project | 4 | `segment5_project` | Project master |
| 6 | `segment6` | Inter Company | 3 | `segment6_inter_company` | IC counterparty list |
| 7 | `segment7` | Related Party | 4 | `segment7_related_party` | Related-party registry |
| 8 | `segment8` | Cash Flow | 4 | `segment8_cash_flow` | IAS 7 code list |
| 9 | `segment9` | Modules | 2 | `segment9_modules` | System enum |
| 10 | `segment10` | Reserve | 1 | `segment10_reserve` | Future expansion |

**Кодын ерөнхий дүрэм:**
- Сегмент бүрийн кодын **эхний орон `0` биш**, `1-9`-ийн аль нэгээр эхэлнэ (validation-аар enforce — §7.6.2).
- Сегмент бүрийн length **fixed-width** — урт хүрэхгүй бол leading-zero-аар дүүргэх БИШ; харин masterт байгаа бэлэн кодыг ашиглах ёстой (master лавлахгүйгээр гаргахгүй).
- Сегмент 9 (Module) утга нь системийн `segment9_modules` enum-аас сонгогдоно (бүх 18 модулийн 2 оронтой код).

### 7.1.1 Segment 3 — Main Account бүлгүүд

8 оронтой дансны кодын **эхний 2 орон** нь бүлгийг тодорхойлно.

| Бүлэг | Ангилал | Дэд бүлгүүд |
|-------|---------|------------|
| **1X** | Эргэлтийн хөрөнгө | 10 Касс, 11 Харилцах, 12 Авлага, 13 Авлага/Санхүүгийн хөрөнгө, 14 Бараа материал, 18 Урьдчилгаа, 19 Бусад |
| **2X** | Эргэлтийн бус хөрөнгө | 20 ҮХ/ROU, 21 Биет бус, 24 Урт хугацаат хөрөнгө оруулалт, 25 Хамааралтай компанид хийсэн оруулалт, 26 Хойшлогдсон татвар, 27 Хөрөнгө оруулалтын ҮХХ, 29 Бусад |
| **3X** | Өр төлбөр | 31 Богино хугацаат өглөг (AP, татвар, НДШ, ХХОАТ, цалин, wallet), 32 Богино зээл/нөөц, 33 Урт хугацаат өр/түрээс |
| **4X** | Эздийн өмч | 41 Үндсэн өмч, 42 Дахин үнэлгээний нөөц, 43 Валютын/бусад нөөц, 44 Хуримтлагдсан ашиг |
| **5X** | Орлого | 51 Үйл ажиллагааны орлого, FX олз, IC орлого, хамааралтай компанийн ашгийн хувь |
| **6X** | Өртөг | 60 Үйлдвэрлэлийн зардал (DL/MOH/scrap), 61 Борлуулсан бүтээгдэхүүний өртөг |
| **7X** | Үйл ажиллагааны зардал | 70 Элэгдэл/ROU dep/CIT exp, 72 Цалин/НДШ, 73 Бусад үйл ажиллагааны зардал |
| **8X** | Санхүүгийн зардал | 87 Санхүүгийн зардал, ханшийн гарз, данснаас хассаны олз/гарз, NRV, татварын торгууль |
| **9X** | ОЗНД / нэгдсэн | 92 Орлого, зарлагын нэгдсэн данс |

> Кодын `*99` төгсгөлтэй данс нь тухайн бүлгийн **clearing / түр данс**.

### 7.1.2 Segment 3 — Дансны бүрэн жагсаалт

Багана тайлбар:
- **gl/ar/ap/fa/cost/cash** — Аль модулийн нэвтрэх дансны жагсаалтад харагдах эсэх (✓ = идэвхтэй)
- Бүгд `active = true` гэж таамаглана

#### 10 — Касс

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 10000001 | Кассд байгаа бэлэн мөнгө MNT | Cash on Hand MNT | ✓ |  |  |  |  | ✓ |
| 10000002 | Кассд байгаа бэлэн мөнгө USD | Cash on Hand USD | ✓ |  |  |  |  | ✓ |
| 10000099 | Кассийн түр данс | Cash Clearing Account | ✓ | ✓ | ✓ |  |  | ✓ |

#### 11 — Харилцах

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 11000001 | Харилцахад байгаа бэлэн мөнгө MNT | Bank Account MNT | ✓ |  |  |  |  | ✓ |
| 11000002 | Харилцахад байгаа бэлэн мөнгө USD | Bank Account USD | ✓ |  |  |  |  | ✓ |
| 11000099 | Харилцах дансны түр данс | Bank Clearing Account | ✓ | ✓ | ✓ |  |  | ✓ |

#### 12 — Авлага

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 12000001 | Дансны авлага | Accounts Receivable | ✓ | ✓ |  |  |  | ✓ |
| 12000002 | НӨАТ оролтын авлага | VAT Input Receivable | ✓ | ✓ |  |  |  | ✓ |
| 12000003 | Бусад авлага | Other Receivables | ✓ | ✓ |  |  |  | ✓ |
| 12000099 | Авлагын ECL нөөц | AR Allowance / ECL Provision (IFRS 9) | ✓ | ✓ | ✓ |  |  | ✓ |

#### 13 — Авлага / Санхүүгийн хөрөнгө

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 13000001 | Санхүүгийн хөрөнгө | Financial Investment | ✓ |  |  |  |  | ✓ |
| 13000006 | Санхүүгийн хэрэгсэл | Financial Instrument | ✓ |  |  |  |  | ✓ |
| 13110000 | Дансны авлага (харилцагч) | Trade Accounts Receivable (IFRS 15) | ✓ | ✓ |  |  |  | ✓ |
| 13620000 | НӨАТ оролтын данс | VAT Input Account | ✓ | ✓ |  |  |  | ✓ |
| 13000099 | Санхүүгийн хөрөнгийн түр данс | Financial Asset Clearing | ✓ | ✓ | ✓ |  |  | ✓ |

#### 14 — Бараа материал

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 14000001 | Бараа материал | Inventory (IAS 2) | ✓ |  |  |  | ✓ |  |
| 14000002 | Түлш шатахуун | Fuel | ✓ |  |  |  | ✓ |  |
| 14000003 | Дуусаагүй үйлдвэрлэл | Work in Progress — WIP (IAS 2) | ✓ |  |  |  | ✓ |  |
| 14000004 | Бэлэн бүтээгдэхүүн | Finished Goods — FG (IAS 2) | ✓ |  |  |  | ✓ |  |
| 14000005 | Хангамжийн материал | Supplies | ✓ |  |  |  | ✓ |  |
| 14000099 | Бараа материалын / нэмэлт зардлын түр данс | Inventory / Landed Cost Clearing (IAS 2) | ✓ | ✓ | ✓ |  | ✓ |  |

#### 18 — Урьдчилж төлсөн зардал

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 18000001 | Урьдчилж төлсөн зардал/тооцоо | Prepaid Expenses | ✓ | ✓ | ✓ |  |  | ✓ |
| 18000099 | Урьдчилж төлсөн зардлын түр данс | Prepaid Clearing Account | ✓ | ✓ | ✓ |  |  | ✓ |

#### 19 — Бусад эргэлтийн хөрөнгө

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 19000001 | Бусад эргэлтийн хөрөнгө | Other Current Assets | ✓ |  |  |  |  | ✓ |
| 19000002 | Борлуулах зорилгоор эзэмшиж буй эргэлтийн бус хөрөнгө | Noncurrent Assets Held for Sale (IFRS 5) | ✓ |  |  |  |  | ✓ |
| 19000099 | Эргэлтийн хөрөнгийн түр данс | Current Asset Clearing Account | ✓ | ✓ | ✓ |  |  | ✓ |

#### 20 — Үндсэн хөрөнгө / ROU хөрөнгө

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 20000001 | Үндсэн хөрөнгө / ROU хөрөнгө | Fixed Assets / ROU Asset (IAS 16, IFRS 16) | ✓ |  |  | ✓ |  |  |
| 20000002 | Хуримтлагдсан элэгдэл | Accumulated Depreciation | ✓ |  |  | ✓ |  |  |
| 20000099 | Үндсэн хөрөнгийн түр данс | Fixed Asset Clearing Account | ✓ | ✓ | ✓ | ✓ |  |  |

#### 21 — Биет бус хөрөнгө

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 21000001 | Биет бус хөрөнгө | Intangible Assets (IAS 38) | ✓ |  |  | ✓ |  |  |
| 21010000 | Үндсэн хөрөнгийн өртөг | Asset Cost (IAS 16) | ✓ |  |  | ✓ |  |  |
| 21000099 | Хуримтлагдсан элэгдэл — биет бус | Accumulated Depreciation — Intangibles (IAS 16, IAS 38) | ✓ | ✓ | ✓ | ✓ |  |  |

#### 24 — Урт хугацаат хөрөнгө оруулалт

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 24000001 | Урт хугацаат хөрөнгө оруулалт | Long-Term Investments | ✓ |  |  | ✓ |  |  |
| 24000099 | Хөрөнгө оруулалтын түр данс | Investment Clearing Account | ✓ | ✓ | ✓ | ✓ |  |  |

#### 25 — Холбоотой компанид хийсэн хөрөнгө оруулалт

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 25000001 | Холбоотой компанид хийсэн хөрөнгө оруулалт | Investment in Associate (IAS 28) | ✓ |  |  | ✓ |  |  |
| 25000099 | Хамааралтай хөрөнгө оруулалтын түр данс | Associate Investment Clearing | ✓ | ✓ | ✓ | ✓ |  |  |

#### 26 — Хойшлогдсон татварын хөрөнгө

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 26000001 | Хойшлогдсон татварын хөрөнгө | Deferred Tax Asset (IAS 12) | ✓ |  |  | ✓ |  |  |
| 26000099 | Татварын хөрөнгийн түр данс | Tax Asset Clearing Account | ✓ | ✓ | ✓ | ✓ |  |  |

#### 27 — Хөрөнгө оруулалтын зориулалттай ҮХХ

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 27000001 | Хөрөнгө оруулалтын зориулалттай үл хөдлөх хөрөнгө | Investment Property (IAS 40) | ✓ |  |  | ✓ |  |  |
| 27000099 | Үл хөдлөх хөрөнгийн түр данс | Investment Property Clearing Account | ✓ | ✓ | ✓ | ✓ |  |  |

#### 29 — Бусад эргэлтийн бус хөрөнгө

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 29000001 | Бусад эргэлтийн бус хөрөнгө | Other Noncurrent Assets | ✓ |  |  | ✓ |  |  |
| 29000099 | Эргэлтийн бус хөрөнгийн түр данс | Noncurrent Asset Clearing Account | ✓ | ✓ | ✓ | ✓ |  |  |

#### 31 — Богино хугацаат өглөг

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 31000001 | Дансны өглөг | Accounts Payable (IFRS 9) | ✓ |  | ✓ |  |  |  |
| 31000003 | Татварын өр (НӨАТ/ААНОАТ/WHT) | Multi-Tax Payable — VAT/CIT/WHT | ✓ |  | ✓ |  |  |  |
| 31420000 | НДШ өглөг | Social Insurance Contribution Payable (IAS 19) | ✓ |  | ✓ |  |  |  |
| 31430000 | ХХОАТ өглөг | Personal Income Tax Withheld Payable | ✓ |  | ✓ |  |  |  |
| 31500001 | Цалингийн өглөг (нэт) | Net Salary Payable (IAS 19) | ✓ |  | ✓ |  |  |  |
| 31600001 | Wallet үүргийн өр | Wallet Liability (IFRS 15) | ✓ |  | ✓ |  |  |  |
| 31900001 | Нөөц өр төлбөр | Provision (IAS 37) | ✓ |  | ✓ |  |  |  |
| 31000099 | Өглөгийн түр данс | Payable Clearing Account | ✓ | ✓ | ✓ |  |  |  |

#### 32 — Богино хугацаат зээл/нөөц

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 32000001 | Богино хугацаат зээл | Short-Term Loan | ✓ |  | ✓ |  |  |  |
| 32000002 | Хүүгийн өглөг | Interest Payable | ✓ |  | ✓ |  |  |  |
| 32000003 | Ногдол ашгийн өглөг | Dividend Payable | ✓ |  | ✓ |  |  |  |
| 32000004 | Урьдчилж орсон орлого | Unearned Revenue | ✓ |  | ✓ |  |  |  |
| 32000005 | Нөөц өр төлбөр | Provision | ✓ |  | ✓ |  |  |  |
| 32000006 | Бусад богино хугацаат өр төлбөр | Other Short-Term Liabilities | ✓ |  | ✓ |  |  |  |
| 32000007 | Борлуулах зорилгоор эзэмшиж буй ЭБ хөрөнгийн өр төлбөр | Noncurrent Assets Held for Sale Liab | ✓ |  | ✓ |  |  |  |
| 32000099 | Богино хугацаат өглөгийн түр данс | Short-Term Liabilities Clearing | ✓ | ✓ | ✓ |  |  |  |

#### 33 — Урт хугацаат өр төлбөр

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 33000001 | Урт хугацаат зээл / Түрээсийн өр | Long-Term Loan / Lease Liability (IFRS 16) | ✓ |  | ✓ |  |  |  |
| 33000002 | Хойшлогдсон татварын өр | Deferred Tax Liability (IAS 12) | ✓ |  | ✓ |  |  |  |
| 33000003 | Нөөц өр төлбөр | Provision | ✓ |  | ✓ |  |  |  |
| 33000004 | Бусад урт хугацаат өр төлбөр | Other Long-Term Liabilities | ✓ |  | ✓ |  |  |  |
| 33000099 | Урт хугацаат өглөгийн түр данс | Long-Term Liabilities Clearing | ✓ | ✓ | ✓ |  |  | ✓ |

#### 41–44 — Эздийн өмч

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 41000001 | Эздийн өмч | Owners' Equity | ✓ |  |  |  |  |  |
| 41000099 | Өмчийн түр данс | Equity Clearing Account | ✓ | ✓ | ✓ |  |  |  |
| 42000001 | Хөрөнгийн дахин үнэлгээний нэмэгдэл | Revaluation Surplus (IAS 16, IFRS 13) | ✓ |  |  |  |  |  |
| 42000099 | Дахин үнэлгээний түр данс | Revaluation Clearing Account | ✓ | ✓ | ✓ |  |  | ✓ |
| 43000001 | Гадаад валютын хөрвүүлэлтийн нөөц | Foreign Currency Translation Reserve (IAS 21) | ✓ |  |  |  |  |  |
| 43000002 | Эздийн өмчийн бусад хэсэг | Other Components of Equity | ✓ |  |  |  |  |  |
| 43000099 | Валютын хөрвүүлэлтийн түр данс | Currency Translation Clearing Account | ✓ | ✓ | ✓ |  |  | ✓ |
| 44000001 | Хуримтлагдсан ашиг | Retained Earnings (IAS 1) | ✓ |  |  |  |  |  |
| 44000099 | Орлого/зарлагын нэгтгэлийн данс | Income Summary — closing convention | ✓ | ✓ | ✓ |  |  | ✓ |

#### 51 — Орлого

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 51100000 | Үйл ажиллагааны орлого | Operating Revenue (IFRS 15) | ✓ | ✓ |  |  |  |  |
| 51800001 | Валютын ханшийн олз | Unrealized FX Gain (IAS 21) | ✓ | ✓ |  |  |  |  |
| 51800005 | Группын доторх орлого | IC Revenue (IFRS 10 — eliminate on consol) | ✓ | ✓ |  |  |  |  |
| 51800007 | Хамааралтай компанийн ашгийн хувь | Share of Associate Profit (IAS 28) | ✓ | ✓ |  |  |  |  |
| 51000099 | Орлогын түр данс | Revenue Clearing Account | ✓ | ✓ |  |  |  |  |

#### 60 — Өртөг (үйлдвэрлэлийн)

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 60000002 | Шууд хөдөлмөрийн зардал | Direct Labor — DL (IAS 2.12) | ✓ |  |  |  | ✓ |  |
| 60000003 | Үйлдвэрлэлийн нийтлэг зардал | Manufacturing Overhead — MOH (IAS 2.12) | ✓ |  |  |  | ✓ |  |
| 60000005 | Үйлдвэрлэлийн хог | Production Scrap (IAS 2.16) | ✓ |  | ✓ | ✓ |  |  |
| 60000099 | Өртгийн түр данс | Cost Clearing Account | ✓ |  | ✓ | ✓ |  |  |

#### 61 — Борлуулсан бүтээгдэхүүний өртөг

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 61100000 | Борлуулсан бүтээгдэхүүний өртөг | Cost of Goods Sold — COGS (IAS 2.34) | ✓ |  |  |  |  |  |
| 61000099 | ОЗНД-ын түр данс | COGS Clearing Account | ✓ |  | ✓ | ✓ |  |  |

#### 70 — Үйл ажиллагааны зардал

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 70000001 | Элэгдлийн зардал | Depreciation Expense (IAS 16) | ✓ |  | ✓ |  |  |  |
| 70000002 | ROU хөрөнгийн элэгдэл | ROU Asset Depreciation (IFRS 16) | ✓ |  | ✓ |  |  |  |
| 70000004 | ААНОАТ / Хойшлогдсон татварын зардал | CIT / Deferred Tax Expense (IAS 12) | ✓ |  | ✓ |  |  |  |
| 70000099 | Зардлын түр данс | Operating Expenses Clearing | ✓ |  | ✓ |  |  |  |

#### 72 — Цалингийн зардал

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 72100000 | Цалингийн зардал | Salary Expense (IAS 19) | ✓ |  | ✓ |  |  |  |
| 72100002 | НДШ ажил олгогчийн зардал | Employer Social Insurance Expense | ✓ |  | ✓ |  |  |  |

#### 73 — Үйл ажиллагааны бусад зардал

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 73100001 | Үйл ажиллагааны зардал (AP) | Operating Expense — AP | ✓ |  | ✓ |  |  |  |

#### 87 — Санхүүгийн зардал

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 87000001 | Санхүүгийн зардал / Түрээсийн хүү | Financial Expenses / Lease Interest (IFRS 16) | ✓ |  | ✓ |  |  |  |
| 87000002 | Үнэ цэнийн бууралтын алдагдал | Impairment Loss (IAS 36, IFRS 5, IFRS 9) | ✓ |  | ✓ |  |  |  |
| 87000003 | Гадаад валютын ханшийн зөрүүний гарз | Foreign Exchange Loss (IAS 21) | ✓ |  | ✓ |  |  | ✓ |
| 87000004 | Үндсэн хөрөнгө данснаас хассаны олз (гарз) | Disposal Gain/Loss on Fixed Assets | ✓ |  |  | ✓ |  |  |
| 87000005 | Биет бус хөрөнгө данснаас хассаны олз (гарз) | Disposal Gain/Loss on Intangibles | ✓ |  |  | ✓ |  |  |
| 87100005 | Цэвэр борлуулах үнийн бууралт | NRV Write-down (IAS 2.9) | ✓ |  | ✓ |  |  |  |
| 87100007 | Татварын торгууль, алданги | Tax Penalty (Tax Administration Law) | ✓ |  | ✓ |  |  |  |
| 87000099 | Санхүүгийн зардлын түр данс | Financial Expense Clearing Account | ✓ |  | ✓ |  |  |  |

#### 92 — ОЗНД / нэгдсэн

| Код | Монгол нэр | English | gl | ar | ap | fa | cost | cash |
|-----|-----------|---------|----|----|----|----|------|------|
| 92000000 | Орлого, зарлагын нэгдсэн данс | Profit and Loss Summary | ✓ |  |  |  |  |  |
| 92000099 | Орлого, зарлагын түр данс | P&L Clearing Account | ✓ | ✓ | ✓ |  |  |  |

---

## 7.2 Сегмент бүрийн зорилго

| Сегмент | Гол зорилго | Хэрэглэх жишээ |
|---------|-------------|----------------|
| Company | Group structure, multi-entity tenant, consolidation | "101 = эх компани, 102 = охин компани А" |
| Cost Center | Зардал хаана үүссэн (хэлтэс, цех, нэгж) | "100100 = Үйлдвэрлэлийн цех №1" |
| Main Account | Дансны мөн чанарыг илэрхийлэх (натурал ангилал) | "51100000 = Үйл ажиллагааны орлого" |
| Product / Service | Бүтээгдэхүүн / үйлчилгээ-ээр тайлан | "11 = Хүнс, 12 = Цахилгаан хэрэгсэл" |
| Project | Project P&L, unbilled revenue, WIP | "1001 = ABC барилгын төсөл" |
| Inter Company | Группын доторх эсрэг тал (consolidation elimination) | "201 = охин компани А" |
| Related Party | Группээс гадуурх холбоотой этгээд (disclosure) | "9001 = Гүйцэтгэх захирлын ХХК" |
| Cash Flow | IAS 7 — Operating / Investing / Financing | "1101 = Операционал-Бараа худалдан авалт" |
| Modules | Journal үүсгэсэн source модуль | "14 = Inventory, 02 = AR" |
| Reserve | Future expansion-д зориулсан үйлчлэх сегмент | TBD |

---

## 7.3 Required / Optional matrix

Транзакцийн төрөл бүрд аль сегмент **заавал бөглөгдөх ёстой**, аль нь **сонголтоор үлдэх** болохыг тодорхойлно.

> Хүснэгтэд: ✅ = required (validation хорино хэрэв хоосон), ⭕ = optional, — = applicable биш (default `0`).

| Транзакц / Posting type | s1 Co | s2 CC | s3 Acct | s4 Prod | s5 Proj | s6 IC | s7 RP | s8 CF | s9 Mod | s10 |
|-------------------------|:-----:|:-----:|:-------:|:-------:|:-------:|:-----:|:-----:|:-----:|:------:|:---:|
| AR — Invoice post | ✅ | ⭕ | ✅ | ⭕ | ⭕ | ⭕ | ⭕ | — | ✅ | — |
| AR — Receipt (cash line) | ✅ | ⭕ | ✅ | — | ⭕ | ⭕ | ⭕ | ✅ | ✅ | — |
| AP — Bill post (expense) | ✅ | ✅ | ✅ | ⭕ | ⭕ | ⭕ | ⭕ | — | ✅ | — |
| AP — Bill post (capitalize) | ✅ | ⭕ | ✅ | — | ⭕ | ⭕ | ⭕ | — | ✅ | — |
| AP — Vendor payment (cash line) | ✅ | ⭕ | ✅ | — | ⭕ | ⭕ | ⭕ | ✅ | ✅ | — |
| Cash — Deposit / Withdrawal | ✅ | ⭕ | ✅ | — | ⭕ | ⭕ | ⭕ | ✅ | ✅ | — |
| Cash — FX revaluation | ✅ | ⭕ | ✅ | — | — | — | — | — | ✅ | — |
| Inventory — Receipt (qty only) | ✅ | ⭕ | — | ⭕ | ⭕ | — | — | — | ✅ | — |
| Inventory — Issue / Transfer | ✅ | ⭕ | — | ⭕ | ⭕ | — | — | — | ✅ | — |
| Cost — Receipt capitalize | ✅ | ⭕ | ✅ | ⭕ | ⭕ | ⭕ | ⭕ | — | ✅ | — |
| Cost — Issue COGS | ✅ | ✅ | ✅ | ✅ | ⭕ | — | — | — | ✅ | — |
| Cost — NRV write-down | ✅ | ⭕ | ✅ | ⭕ | — | — | — | — | ✅ | — |
| FA — Acquisition | ✅ | ✅ | ✅ | — | ⭕ | ⭕ | ⭕ | — | ✅ | — |
| FA — Depreciation run | ✅ | ✅ | ✅ | — | ⭕ | — | — | — | ✅ | — |
| FA — Disposal (cash line) | ✅ | ✅ | ✅ | — | ⭕ | — | — | ✅ | ✅ | — |
| Payroll — Run post | ✅ | ✅ | ✅ | — | ⭕ | — | — | — | ✅ | — |
| Payroll — Disbursement (cash) | ✅ | ⭕ | ✅ | — | — | — | — | ✅ | ✅ | — |
| POS — Sale (sale-side) | ✅ | ⭕ | ✅ | ⭕ | — | — | — | ✅ | ✅ | — |
| POS — COGS (Cost listener) | ✅ | ⭕ | ✅ | ✅ | — | — | — | — | ✅ | — |
| AGIS — IC settlement (both legs) | ✅ | ⭕ | ✅ | ⭕ | ⭕ | ✅ | — | — | ✅ | — |
| Tax — VAT settlement | ✅ | ⭕ | ✅ | — | — | — | — | — | ✅ | — |
| Manufacturing — Issue / Output | ✅ | ✅ | ✅ | ✅ | ⭕ | — | — | — | ✅ | — |
| Manufacturing — Variance close | ✅ | ✅ | ✅ | ✅ | ⭕ | — | — | — | ✅ | — |
| Wallet — Top-up / Charge | ✅ | ⭕ | ✅ | — | — | — | — | ✅ | ✅ | — |
| Manual GL adjustment | ✅ | ⭕ | ✅ | ⭕ | ⭕ | ⭕ | ⭕ | ⭕ | ✅ | — |

**Cash account дүрэм:** Аливаа journal-ийн line-д **cash account (1X-аас эхэлсэн натурал)** ашиглавал `segment8_cash_flow` **заавал** бөглөгдөнө (validation алдаа нэмж буцаана). §7.6.7.

**Intercompany дүрэм:** Хэрвээ `segment6_inter_company` бөглөгдсөн бол `segment6 ≠ segment1` (компани өөрөөрөө хариуцагч байж болохгүй). §7.6.6.

**Cost center дүрэм:** Manufacturing/Cost модульд cost center **заавал** — Service tenant-д Cost модуль идэвхгүй бол cost center сегмент `000000` (default cost center master record).

---

## 7.4 Default mapping source matrix

Сегментүүдийг хэрэглэгчээр гар бичвэрээр оруулахаас зайлсхийж — module-ийн master data-аас автоматаар default татах policy.

| Сегмент | Source entity | Default lookup алгоритм |
|---------|---------------|-------------------------|
| s1 Company | Login session-ий `company_id` | Хэрэглэгчийн идэвхтэй company → `segment1_company.code` |
| s2 Cost Center | Employee.cost_center / Department / Manual override | Payroll-д Employee → CC; Expense-д Department → CC; default fallback `000000` |
| s3 Main Account | Posting template (per module) | AR invoice template → Cr `51100000` (configurable per item type); AP bill type → Dr `7XXXXXXX` |
| s4 Product | `inv_items.product_segment` / Sale-line.item / WO output | Inventory issue → item.product; POS sale → SKU.product |
| s5 Project | Customer contract / Expense.project_id / Timesheet.project | AR invoice → contract.project; AP expense → manual select if expense-link enabled |
| s6 Inter Company | Customer.intercompany_code / Supplier.intercompany_code | IC customer flag → counterparty; non-IC → blank |
| s7 Related Party | Customer.related_party_code / Supplier.related_party_code / Employee.compensation_type | Related-party registry lookup → код; non-RP → blank |
| s8 Cash Flow | Cash transaction type → CF code map (`cash_settings`) | Cash receipt customer → "1101 Operating"; Loan disbursement → "3201 Financing" |
| s9 Module | Posting service-ээр автомат set | `journal_entries.module = 'AR'` → s9 = `02`; `module = 'POS'` → s9 = `08` etc. |
| s10 Reserve | Always `0` (V1.06-д) | Future expansion |

**Default override:** Хэрэглэгчид default-ыг "edit" хийх боломжтой (UI form-д талбарууд editable, гэхдээ default-уудаар pre-fill хийнэ). Override хийсэн бол `override_reason` талбар ашиглах policy (§7.10).

---

## 7.5 Сегмент ашиглалтын policy

### 7.5.1 Хэзээ Main account шинээр нээх vs. сегмент ашиглах

> **Зарчим:** Main account-ыг **зөвхөн дансны мөн чанарыг илэрхийлэх**-д ашиглана. Хэлтэс, бүтээгдэхүүн, төсөл, контрактаар тайлан гаргах хэрэгцээг **сегмент-ээр хариулна**.

**Main account шинээр нээх ёстой жишээ:**
- Шинэ төрлийн хөрөнгө (жш. "Дижитал хөрөнгө" — 25 group)
- Шинэ төрлийн орлого (жш. "Subscription revenue" — 51-ээс ялгарсан)
- Хууль шаардсан тусдаа данс (жш. tax-deductible сан тус тусдаа)

**Main account шинээр НЭ нээх — сегмент ашиглах ёстой жишээ:**
- "Бараа худалдааны орлого" vs. "Үйлчилгээний орлого" → `segment4_product_service`
- "ABC барилгын төсөл" vs. "DEF дэд бүтэц" → `segment5_project`
- "Үйлдвэрлэлийн цех №1 цалин" vs. "Захиргааны цалин" → `segment2_cost_center`
- "Хүүгийн зардал — банкны зээл" vs. "Хүүгийн зардал — bond" → `segment4_product_service` эсвэл sub-account

### 7.5.2 Main account-ыг "хэт задлахгүй" зарчим

Хэрэв management reporting-н хэрэгцээ нь main account-ыг 2-3 сегментийн комбинацаар хариулагдах боломжтой бол **main account задлахгүй**. Энэ нь:
- Chart of Accounts-ыг хүртээмжтэй байлгана (нягтлан бүх дансыг ой санамжаар ашиглах боломжтой).
- IFRS таксономид main account-ыг тогтворжуулна (note disclosure нь `segment3 + segment4 + ...` үндсэлж generate болно).
- Reporting hierarchy-ийг tenant-аас tenant-руу шилжүүлэх боломжтой.

### 7.5.3 Сегмент бүрийн ашиглалтын дүрэм

| Сегмент | Дүрэм |
|---------|-------|
| s1 Company | Бүх journal line-д **always required**. Login session-аас автомат set. Manual override **зөвхөн superadmin/tenant admin**. |
| s2 Cost Center | Зардал үүссэн нэгж. Manufacturing/Cost модульд required; AR/Cash-д optional. Default master `000000`. |
| s3 Main Account | Бүх journal line-д **always required**. Posting template-ээр auto-fill. |
| s4 Product/Service | Inventory/POS/Cost issue, sale-side, COGS-д required. Cash/Payroll-д optional. |
| s5 Project | Project module enabled tenant-д optional → AR/AP/Cost-д recommended. Project profitability-ийн source. |
| s6 Inter Company | AGIS journal-д **required (both legs)**. Бусад модульд IC counterparty flag-аар auto-fill. `segment6 == segment1` хориотой. |
| s7 Related Party | Related-party transaction (loan, advance, mgmt comp)-д required. Customer/Supplier registry-ээс auto-fill. |
| s8 Cash Flow | Cash account (1X main account)-тай journal line-д **always required**. Cash transaction type-аас map. |
| s9 Modules | Posting service-ээр **always auto-set** — manual edit боломжгүй. |
| s10 Reserve | Always `0` (V1.06-д). |

---

## 7.6 Validation rules (database + backend)

### 7.6.1 Code length validation
- Сегмент бүр nullable биш (NOT NULL CHECK length(code) = expected_len).
- Сегмент урт нь fixed-width — leading zero хүлээн авдаггүй.

### 7.6.2 First-character non-zero validation
- Бүх 10 сегментийн утгад `code[0] != '0'`.
- Жишээ: `segment4 = 11` ОК, `segment4 = 01` БУРУУ.
- Master CRUD-д enforce; posting service-д хоёрдогч check.

### 7.6.3 Master existence validation
- Журналын мөр бичигдэхээс өмнө `segment{N}_*.code` master-д байгаа эсэхийг шалгана.
- Master байхгүй кодоор post хийсэн бол алдаа `SEGMENT_NOT_FOUND` буцаана.

### 7.6.4 Active status validation
- Master-ийн `is_active = false` бол шинэ posting-д ашиглах боломжгүй.
- Хуучин posting-д тухайн код байж болно (audit trail).

### 7.6.5 Tenant/Company scope validation
- Сегмент бүр `tenant_id`-р scope. Cross-tenant ашиглах боломжгүй.
- s1 Company нь tenant-ийн `companies` table-аас (one-to-one).
- s2 Cost Center, s5 Project нь company-scope (s1-д уядаг).
- s3 Main Account, s8 Cash Flow, s9 Module нь tenant-scope shared.

### 7.6.6 Intercompany self-loop prohibition
- `segment6_inter_company.code != segment1_company.code` (нэг journal line дотор).
- AGIS journal-д тусгайлан `segment6 == counterparty.segment1` шалгалт.

### 7.6.7 Cash flow code requirement
- Хэрэв `segment3_main_account.code` нь cash account (10/11 group) бол `segment8_cash_flow.code != '0000'`.
- Cash module-ийн line validation pattern (§04-cash.md §X)-д enforce.

### 7.6.8 Period close enforcement
- Closed period-д шинэ posting боломжгүй (бүх module-аар).
- Close-аас өмнө **segment completeness check** — pending journal line-ууд бүгд required сегмент бөглөсөн эсэх (§ 03-cross-module/02-period-close.md).

### 7.6.9 Module enum enforcement
- `segment9_modules.code` нь системийн enum-аас гарч болохгүй.
- Posting service-ээр set хийдэг — UI-д editable биш.

### 7.6.10 Related-party logic validation
- Хэрэв `segment7_related_party.code != '0000'` бол customer/supplier-ийн `related_party_code` matched байх ёстой.
- Mismatch бол алдаа `RP_CODE_MISMATCH`.

---

## 7.7 Defaulting engine

Backend posting service-ийн pre-post hook ажиллагааг тодорхойлно. Fields-ийг хоосон ирвэл (UI form-аас оруулсангүй) автоматаар олж бөглөнө.

```text
DefaultingEngine.fillSegments(line, context):
  for each segment 1..10:
    if line.segment{N} is null OR line.segment{N} == '':
      line.segment{N} = lookupDefault(N, context)
    validate(line.segment{N})
```

| Source signal | Сегмент | Lookup |
|---------------|---------|--------|
| `context.user.company_id` | s1 | `companies` table → `segment1_company.code` |
| `context.employee_id` | s2 | `employees.cost_center_code` → fallback `'000000'` |
| `context.department_id` | s2 | `departments.cost_center_code` |
| `context.template.account_code` | s3 | Posting template configurable → `segment3_main_account.code` |
| `context.product_id` / `inv_item_id` | s4 | `inv_items.product_segment_code` |
| `context.project_id` | s5 | `projects.code` (manual entry-д explicit pass) |
| `context.customer.intercompany_flag` | s6 | `customers.intercompany_code`; `'000'` if non-IC |
| `context.supplier.intercompany_flag` | s6 | `suppliers.intercompany_code` |
| `context.customer.related_party_code` | s7 | `customers.related_party_code`; `'0000'` if none |
| `context.cash_transaction_type` | s8 | `cash_transaction_type → cash_flow_code` map (`cash_settings`) |
| `context.posting_module` | s9 | `'02' | '03' | ...` enum (auto-set) |
| (always) | s10 | `'0'` |

**Override discipline:** Хэрэглэгч default-аас өөр код оруулсан бол `journal_entry_lines.override_reason` талбарт reason бичих policy (Tenant Admin-аар toggle хийгдэж болох — high-risk override-д required).

---

## 7.8 Reporting layer integration

### 7.8.1 Cost reporting
- **Үндсэн зүсэлт:** `segment2_cost_center + segment3_main_account + segment4_product_service`.
- Cost sheet, product margin, department spending бүгд сегмент-suurь.
- `vw_cost_lines_expanded` view: `journal_entry_lines × segment2 × segment3 × segment4` JOIN.

### 7.8.2 Consolidation reporting
- **Үндсэн зүсэлт:** `segment1_company + segment3_main_account + segment6_inter_company`.
- IC counterparty matrix: company `s1` × counterparty `s6`-д Dr/Cr тулгалт.
- Elimination journal rule: `segment3 + segment6` matched lines нь paired off.

### 7.8.3 Cash flow reporting (IAS 7)
- **Үндсэн зүсэлт:** `segment8_cash_flow`.
- Direct CF report: cash line-уудаас `segment8` group by → Operating/Investing/Financing classify.
- Indirect CF reconciliation: net income → adjustments → final CF (segment8 cross-check).

### 7.8.4 Project profitability
- **Үндсэн зүсэлт:** `segment5_project`.
- Project P&L: `segment5` × `segment3` (revenue 5X vs. expense 7X).
- Unbilled revenue, WIP: `segment5` × `inv_items` JOIN.

### 7.8.5 Related-party disclosure (IAS 24)
- **Үндсэн зүсэлт:** `segment7_related_party`.
- Related-party listing: `segment7 != '0000'` filter → group by transaction type.
- Note disclosure template: balance + transaction volume per related party.

### 7.8.6 Module-source reconciliation
- **Үндсэн зүсэлт:** `segment9_modules`.
- Subledger-to-GL reconciliation: `segment9 = 'AR'` line-уудын нийлбэр vs. `ar_invoices.posted_total`.
- Audit / reconciliation report-уудад `segment9` filter.

---

## 7.9 Effective-dated rules

Сегмент мастер тус бүр **effective-dated** болно — `effective_from`, `effective_to` талбартай. Posting service нь journal line-ийн `transaction_date`-аар хүчинтэй mapping сонгоно.

| Master | Effective-date use case |
|--------|-------------------------|
| `segment2_cost_center` | Cost center-ийн нэр өөрчлөгдвөл (одоогийн posting шинэ нэрээр, өмнөх tape хуучнаар) |
| `segment3_main_account` | Main account active/inactive шилжих, нэр өөрчлөх |
| `segment4_product_service` | Product line discontinued |
| `segment5_project` | Project closed (read-only after close date) |
| `segment6_inter_company` | IC structure өөрчлөгдөх (M&A) |
| `segment7_related_party` | Related-party registry update |
| `segment8_cash_flow` | IAS 7 code list update |

> Historical rerun: Тайлан дахин гаргахад, тухайн үеийн mapping ашигладаг — closed period-ийн дансны нэр changed бол хуучин нэрээр харуулна.

---

## 7.10 Audit + governance

### 7.10.1 Master CRUD audit
- Сегмент мастер бүрийн create/update/delete нь `audit_log` table-д бичигдэнэ.
- Sensitive fields (e.g. `related_party_code`) — actor + timestamp + before/after value хадгалагдана.

### 7.10.2 Override audit
- Default-аас өөр сегмент оруулсан posting-д `override_reason`, `override_by` талбар хадгалагдана.
- Тайлан дээрэх drill-down-д "Override" badge харагдана.

### 7.10.3 High-risk approval
- Approval workflow rule-д "intercompany journal", "related-party journal", "large cash movement" гэсэн trigger-уудыг сегмент-аар тодорхойлно (e.g. `segment6 != '000'` AND `total_amount > 100M`).

### 7.10.4 Period close governance
- Pre-close validation block: pending journal line-ууд required сегмент бүгдийг бөглөсөн эсэх.
- Missing segment бүхий line байгаа бол close хориглоно (operator must fix or post adjustment).

---

## 7.11 Migration strategy

V1.06-аас өмнөх legacy posting-д (хэрэв sample data-д байсан бол) сегмент бөглөгдөөгүй байж болно. Migration plan:

1. **Backfill default values** — s1 = current company, s2 = `'000000'`, s3 = existing account_code, s4-s8 = `'00..0'`, s9 = posting module enum, s10 = `'0'`.
2. **Mark as legacy** — `journal_entries.legacy_segments = true` flag (future cleanup-ийг боломжтой болгох).
3. **Reporting compatibility** — Old reports нь shim view-аар backward-compatible: `vw_gl_lines_v1` (legacy) vs. `vw_gl_lines_expanded` (V1.06.2-аас).

---

## 7.12 Холбоотой документуудтай уялдаа

| Документ | Энэ файл-аас холбогдох хэсэг |
|----------|------------------------------|
| [01-architecture/01-high-level.md](./01-high-level.md) | §7.1 segment master → §1 architecture |
| [01-architecture/04-multi-tenant.md](./04-multi-tenant.md) | §7.6.5 tenant/company scope |
| [01-architecture/06-module-dependencies.md](./06-module-dependencies.md) | §7.4 default mapping by module |
| [02-modules/01-gl.md](../02-modules/01-gl.md) | §11 chart_of_accounts + coa_segments |
| [02-modules/04-cash.md](../02-modules/04-cash.md) | §7.6.7 cash flow required rule |
| [02-modules/05-inventory.md](../02-modules/05-inventory.md) | §7.5.3 product/service usage |
| [02-modules/09-agis.md](../02-modules/09-agis.md) | §7.6.6 IC self-loop, §7.8.2 consolidation |
| [02-modules/10-cost.md](../02-modules/10-cost.md) | §7.5.3 CC/MA/Product cost model |
| [02-modules/11-manufacturing.md](../02-modules/11-manufacturing.md) | §7.5.3 product cost segment flow |
| [02-modules/14-reports.md](../02-modules/14-reports.md) | §7.8 reporting layer |
| [02-modules/15-admin.md](../02-modules/15-admin.md) | §7.10 master administration, audit |
| [02-modules/18-audit.md](../02-modules/18-audit.md) | §7.10 audit-log entries |
| [03-cross-module/01-gl-posting-matrix.md](../03-cross-module/01-gl-posting-matrix.md) | §7.3 required matrix per template |
| [03-cross-module/02-period-close.md](../03-cross-module/02-period-close.md) | §7.6.8, §7.10.4 close-time check |
| [03-cross-module/03-ifrs-mapping.md](../03-cross-module/03-ifrs-mapping.md) | §7.8.5 related-party (IAS 24), §7.8.3 CF (IAS 7) |
| [04-technology/03-database.md](../04-technology/03-database.md) | §7.1 master tables, §7.2 line schema |
| [04-technology/02-backend.md](../04-technology/02-backend.md) | §7.6, §7.7 validation + defaulting middleware |
| [04-technology/01-frontend.md](../04-technology/01-frontend.md) | §7.7 defaulting UX |
| [04-technology/06-testing.md](../04-technology/06-testing.md) | §7.6 validation test scenarios |
| [§7.1.1–7.1.2 (энэ файлын дотор)](#711-segment-3--main-account-бүлгүүд) | Segment3 main-account бүлэг ба дансны бүрэн жагсаалт |
| [TODO-2-segment-strategy.md](../TODO-2-segment-strategy.md) | Implementation backlog (this rollout) |

---

**Version:** V1.06.2 (2026-05-01 эхэлсэн)
**Status:** Active workstream — Phase 1 documentation alignment
**Owner:** Cross-module — affects all 18 модуль
