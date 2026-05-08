# Entry Accounting — CLAUDE.md

## Төслийн тойм

Монгол нягтлан бодох бүртгэлийн вэб программ. Одоогийн байдал болон төлөвлөгдсөн feature-үүд:

| Feature | Одоо | Төлөвлөгдсөн |
|---------|------|--------------|
| Ерөнхий журнал (GL) | ✅ | — |
| Draft → Post журнал | ❌ | ✅ |
| Period систем | ❌ | ✅ |
| НӨАТ модуль | ❌ | ✅ |
| Цалингийн модуль (Payroll) | ❌ | ✅ |
| AI agent (expert accountant) | ❌ | ✅ |

## Файлын бүтэц

```
entry-accounting/
├── app/
│   ├── (auth)/login|register     # Нэвтрэх / бүртгүүлэх
│   ├── (dashboard)/
│   │   ├── layout.tsx            # Topbar + auth guard
│   │   └── gl/
│   │       ├── journal/          # Журналын жагсаалт
│   │       ├── accounts/         # Дансны тохиргоо
│   │       └── reports/          # GL тайлан
│   └── api/auth/[...nextauth]/   # NextAuth handler
├── components/gl/                # GL client components
├── lib/
│   ├── auth.ts                   # NextAuth config
│   ├── actions/gl.ts             # Server Actions
│   ├── actions/auth.ts           # Register action
│   ├── db/schema.ts              # Drizzle schema
│   ├── db/index.ts               # DB connection
│   └── store/gl-store.ts         # Zustand UI state
├── knowledge/                    # Мэргэжлийн мэдлэгийн сан
├── .env.local                    # DATABASE_URL, AUTH_SECRET
└── drizzle.config.ts
```

## Технологи (одоогийн)

- **Next.js 16** App Router + TypeScript
- **PostgreSQL** on Railway — Drizzle ORM
- **NextAuth v5** (Credentials + JWT)
- **Tailwind CSS** + shadcn/ui (Base UI)
- **Zustand** — UI state (modal open/close)
- Server Actions — mutations (createVoucher, deleteVoucher, createAccount…)

---

## ⚠️ UI стандартын зөрчил

`knowledge/03-стандарт/ui-standards/` файлууд нь **Chakra UI** системийн spec.
Энэ төсөл shadcn/ui (Base UI) ашигладаг тул:

| Сэдэв | Knowledge файл | Энэ төсөлд |
|-------|----------------|-----------|
| UI component | `<StandardTable>`, `<Modal>` (Chakra) | shadcn `Table`, `Dialog` |
| Дизайн | Dark mode + glassmorphism | Зөвхөн цайвар (#fafafa/#fff) |
| i18n | `t('key')`, 4 хэл | Зөвхөн монгол, hardcoded |

Нягтлан бодох логик, дансны код, IFRS/татварын дүрэм бүгд хамаарна.

---

## Гол дүрэм

- **Server Component by default:** Data fetch нь page.tsx дотор, mutation нь `lib/actions/` Server Action-аар
- **Client Component:** `"use client"` зөвхөн state/event handler шаардагдах үед
- **Монгол хэл:** UI текст бүгд монголоор
- **Нэмэх модулиуд:** periods/, vat/, payroll/ — тус бүрийн үед `app/(dashboard)/` доор нэмнэ

---

## Нягтлан бодох стандарт

### 1. Журналын баланс (journal-balance guardrail)

```
abs(ΣДебет − ΣКредит) ≤ 0.01   → тэнцсэн
ΣДебет = 0                       → хоосон, хориотой
Мөр бүрд дебет ЭСВЭЛ кредит    → хоёулаа зэрэг байж болохгүй
Мөр бүрийн дүн ≥ 0
```

Тэнцээгүй бол "Хадгалах" товч идэвхгүй — **одоогийн кодонд хэрэгжсэн**.

### 2. Draft → Post журнал (төлөвлөгдсөн)

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/journal-entry.md`

```
Draft үүсгэх → хэрэглэгч шалгана → Post дарах → хадгалагдана
  ↑ засвал draft руу буцна
```

- Draft статустай журнал нь period close-д ороогүй байна
- Post хийхэд journal_balance guardrail заавал давна
- `adjustment_type`: `regular` | `prior_period` | `closing` | `reversing` | `fx_reval` | `accrual`

### 3. Дансны бүлгийн бүтэц (8 оронтой код)

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/01-gl-posting-matrix.md`

| Бүлэг | Код | Жишээ |
|-------|-----|-------|
| Эргэлтийн хөрөнгө | 1XXXXXXX | `11210000` Касс, `11000001` Банк |
| Эргэлтийн бус хөрөнгө | 2XXXXXXX | `21010000` Үндсэн хөрөнгө |
| Өр төлбөр | 3XXXXXXX | `31000001` AP, `31410000` НӨАТ өглөг |
| Эздийн өмч | 4XXXXXXX | `41100000` Эздийн өмч, `44000001` Хуримтлагдсан ашиг |
| Орлого | 5XXXXXXX | `51100000` Борлуулалтын орлого |
| COGS | 6XXXXXXX | `61100000` COGS |
| Үйл ажиллагааны зардал | 7XXXXXXX | `72100000` Цалингийн зардал |
| Санхүүгийн зардал | 8XXXXXXX | `87100001` Хүүгийн зардал |

### 4. Period систем (төлөвлөгдсөн)

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/02-period-close.md`

- Период нь `open` → `closed` статустай
- Хаагдсан периодод журнал бичих хориотой (admin-аас бусад)
- **Monthly close** гол алхмууд:
  1. Элэгдэл бодох (FA)
  2. FX дахин үнэлгээ (валют)
  3. Accrual бичилт
  4. Period хаах → snapshot үүсгэх
- **Year-end closing entries:**
  - `Dr 51100000 Орлого → Cr 44000099 Орлогын дүн`
  - `Dr 44000099 → Cr 6/7/8XXXXXXX Зардал`
  - `Dr 44000099 net → Cr 44000001 Хуримтлагдсан ашиг`
- Татварын хуваарь: НӨАТ дараа сарын 10, НДШ дараа сарын 5, ААНОАТ улирлын дараа сарын 20

### 5. НӨАТ (VAT) — 10%

Knowledge: `knowledge/01-онол-хууль-стандарт/tax/vat.md`, `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md`

```
Exclusive: Авлага = Нийт, Орлого = Нийт/1.1, НӨАТ өглөг = Нийт × 10/110
Тооцоо: payableVat = outputVat − inputVat
```

GL posting:
```
Борлуулалт: Dr 13110000 Авлага / Cr 51100000 Орлого + Cr 31410000 НӨАТ өглөг
Худалдан авалт: Dr Зардал + Dr 13620000 НӨАТ авсан / Cr 31000001 AP
Тооцоо: Dr 31410000 / Cr 13620000 / Cr 11000001 Банк (зөрүү)
```

Дараа сарын **10-нд** тайлан + төлбөр. Хоцорвол 0.1%/хоног.

### 6. Цалин (Payroll) — Gross → Net

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/`

**НДШ хувь:**

| | Ажилтан | Ажил олгогч |
|--|---------|-------------|
| Тэтгэвэр | 8.5% | 8.5% |
| Тэтгэмж | 0.8% | 1.0% |
| Ажилгүйдэл | 0.2% | 0.2% |
| ЭМД | 2.0% | 2.0% |
| ҮОМШӨ | — | 0.8–3.0% |
| **Нийт** | **11.5%** | **12.5–14.5%** |

**НДШ дээд хязгаар:** Доод цалин × 10 (2025: 792,000 × 10 = 7,920,000₮)

```js
siCap = minimumWage × 10
cappedBase = Math.min(totalEarnings, siCap)
employeeSI = cappedBase × 11.5%
employerSI = cappedBase × (12.5% + accidentRate)
taxableIncome = totalEarnings − employeeSI
netSalary = totalEarnings − employeeSI − pit − otherDeductions
```

**GL posting (7 мөр):**
```
Dr 72100000 Цалингийн зардал       — нийт олголт
Dr 72100002 НДШ зардал (ажил олгогч)
  Cr 31420000 НДШ өглөг            — ажилтан + ажил олгогч НДШ
  Cr 31430000 ХАОАТ өглөг
  Cr 31500001 Цалингийн өглөг      — гарт олгох цалин
```

Тайлагнал: НДШ дараа сарын **5-нд**, ХАОАТ дараа сарын **10-нд**.

### 7. Domain separation (guardrail)

- **IFRS treatment ≠ Татварын treatment** — ялгааг тодорхой тусгана
- **Цалингийн ХАОАТ ≠ Бизнесийн WHT** — андуурахгүй
- **Элэгдэл:** IAS 16 (дансны) vs татварын хуулийн хувь зөрүү → IAS 12 DTA/DTL

### 8. Human-in-the-loop (draft-first policy)

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/guardrails/human-in-the-loop.md`

- AI agent бичилт **шууд хадгалахгүй** — draft үүсгэнэ, хэрэглэгч баталгаажуулна
- Том дүн (>10M₮), period хаалт, payroll post → нягтланч баталгаажуулалт шаарддаг

### 9. Effective date (татвар/цалины тооцоололд)

Knowledge: `knowledge/02-нягтлан-бодох-мэргэжлийн/guardrails/effective-date.md`

- Татварын хувь, НДШ, ХАОАТ bracket-ийг **огноогоор** lookup хийнэ
- Хамаарах огноогүй тооцоолол хийхгүй — хэрэглэгчээс асууна

---

## UI стандарт

### Өнгө аяс

```css
body: #fafafa | card: #ffffff | border: #ececec
primary button: #4a6fa5 | danger: #e53e3e | secondary: #f3f4f6
text: #2c2c2c | secondary text: #666
```

### Popup / Modal

```
Overlay: rgba(0,0,0,0.4)
Content: #fff, border-radius 8px, box-shadow
Header: гарчиг + × товч | Footer: [Болих] [Хадгалах]
Хаах: × товч / Болих / overlay дарах / Esc
```

### Destructive үйлдэл

```
Устгах → confirm диалог: [Болих] [Устгах]
Ашиглагдсан данс устгах → анхааруулна
```

---

## DB өгөгдлийн бүтэц (Drizzle / PostgreSQL)

```
users              — id, name, email, passwordHash
chart_of_accounts  — id, userId, number, name
journal_vouchers   — id, userId, date, description, status
journal_lines      — id, voucherId, accountNumber, debit, credit, description, sortOrder
```

Migration: `npx drizzle-kit generate` → `npx drizzle-kit push`

## Анхдагч дансны мэдээлэл

| Дугаар | Нэр |
|--------|-----|
| 11210000 | Касс |
| 11000001 | Харилцах данс |
| 51100000 | Борлуулалтын орлого |
| 61100000 | Үндсэн үйл ажиллагааны зардал |

---

## Knowledge Base — хэзээ, юу уншихыг

**Нягтлан бодох логик нэмэхийн өмнө холбогдох файлыг заавал уншина. Татварын хувь, account code, IFRS дүрмийг дур мэдэн таахгүй.**

| Нөхцөл | Унших файл |
|--------|-----------|
| Account код, GL posting template | `knowledge/02-нягтлан-бодох-мэргэжлийн/01-gl-posting-matrix.md` |
| Period close workflow | `knowledge/02-нягтлан-бодох-мэргэжлийн/02-period-close.md` |
| Журнал бичих workflow | `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/journal-entry.md` |
| НӨАТ тайлан workflow | `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md` |
| Цалингийн workflow | `knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/payroll-run.md` |
| Цалин, НДШ тооцоолол | `knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/` |
| IFRS стандарт | `knowledge/01-онол-хууль-стандарт/ifrs/_index.md` → тухайн файл |
| Татварын хууль | `knowledge/01-онол-хууль-стандарт/tax/_index.md` → тухайн файл |
| 2026 татварын шинэчлэлт | `knowledge/01-онол-хууль-стандарт/tax/2026-updates.md` |
| Дансны нэгдсэн жагсаалт | `knowledge/03-стандарт/chart-of-accounts.md` |
