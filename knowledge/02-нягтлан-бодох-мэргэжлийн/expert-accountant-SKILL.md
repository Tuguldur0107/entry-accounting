---
name: Мэргэшсэн нягтлан бодогчын чадвар
description: IFRS/НББОУС, Монголын татварын хууль, цалин тооцоолол болон Entry системийн модуль бүрт хэрэгжүүлэх нэгдсэн мэргэжлийн чадвар
type: skill
version: 1.0.0
domains: [ifrs, tax, payroll]
---

# Мэргэшсэн нягтлан бодогчын чадвар (Expert Accountant Skill)

> Entry системийн нэгдсэн accounting intelligence. IFRS/НББОУС стандарт, Монгол Улсын
> татварын хууль, цалин тооцоолол — бүгдийг нэг skill-д нэгтгэсэн. Knowledge, tool,
> guardrail, workflow, reference data бүрэлдэхүүнүүдээр зохион байгуулагдсан.

---

## 1. Skill-ийн зорилго

Мэргэшсэн нягтлан бодогчийн шийдвэр гаргалт, зөвлөгөө, бичилтийг автоматжуулах.
Энэ skill нь дараах 3 домэйны мэргэжлийн мэдлэгийг нэгтгэнэ:

| Домэйн | Хамрах хүрээ |
|--------|--------------|
| **IFRS / НББОУС** | IAS 1-41, IFRS 3-16 стандарт; recognition, measurement, disclosure |
| **Монгол татвар** | НӨАТ, ААНОАТ, ХАОАТ, WHT, онцгой, үл хөдлөх, eBarimt, filing calendar, penalties, 2026 шинэчлэлт |
| **Цалин** | Gross→Net, НДШ, ЭМД, ХАОАТ bracket, overtime, payslip, payroll journal, validation |

---

## 2. Skill-ийн бүтэц

```
expert-accountant/
├── SKILL.md                  ← энэ файл (entry + manifest)
├── knowledge/                ← RAG chunks (semantic-searchable)
│   ├── ifrs/*.md             ← IAS/IFRS standard тус бүрийн chunk
│   ├── tax/*.md              ← НӨАТ, ААНОАТ, ХАОАТ г.м
│   └── payroll/*.md          ← SI, PIT, overtime г.м
├── workflows/                ← олон алхамт response pattern
│   ├── journal-entry.md
│   ├── vat-return.md
│   ├── payroll-run.md
│   ├── period-close.md
│   └── module-mapping.md
├── guardrails/               ← human-readable policy document
│   ├── journal-balance.md
│   ├── effective-date.md
│   ├── si-cap.md
│   └── human-in-the-loop.md
└── reference-data/           ← effective-dated JSON (rate, bracket, calendar)
    ├── tax-rates.json
    ├── si-rates.json
    ├── pit-brackets.json
    ├── minimum-wage.json
    ├── tax-calendar.json
    └── ifrs-module-mapping.json
```

---

## 3. Context Contract

Skill-ийн tool болгоны input-д дараах context шаардлагатай:

```ts
type ExpertAccountantContext = {
  companyId: string              // tenant isolation
  companyName?: string
  module:                        // одоогийн module
    | 'gl' | 'ar' | 'ap' | 'cash' | 'inventory'
    | 'fa' | 'payroll' | 'tax' | 'reports' | 'pos' | 'admin'
  page?: string
  recordType?: string
  recordId?: string
  periodId?: string
  dateFrom?: string              // ISO: YYYY-MM-DD
  dateTo?: string
  asOfDate?: string              // effective-date lookup-д зориулав
  currency?: string              // default: MNT
  locale?: 'mn' | 'en' | 'ru' | 'zh'
  userId: string
  userRole: string               // superadmin | admin | chief_accountant | accountant | ...
  permissions: string[]          // RBAC
}
```

---

## 4. Tool catalog (domain-аар бүлэглэсэн)

Тэмдэглэл: **draft-first policy** — бүх mutation tool зөвхөн proposal үүсгэнэ, хэрэглэгч UI card-аас Post даралгүй DB-д бичигдэхгүй.

### 4.1 IFRS домэйн

| Tool | Зорилго | Type |
|------|---------|------|
| `get_ifrs_module_context` | module+record-ийн IFRS context цуглуулах | read |
| `get_accounting_policy_snapshot` | компанийн policy snapshot | read |
| `explain_ifrs_treatment` | тодорхой transaction/balance-д ямар standard яагаад үйлчлэхийг тайлбарлана | read + reason |
| `run_ifrs_checks` | сонгосон check set (ias1, ias7, ifrs15, ifrs16 гэх мэт) | validate |
| `create_ifrs_adjustment_draft` | IFRS adjustment journal draft бэлтгэх | draft |

### 4.2 Tax домэйн

| Tool | Зорилго | Type |
|------|---------|------|
| `get_taxpayer_profile` | VAT reg, CIT regime, WHT applicability | read |
| `get_vat_snapshot` | хугацааны output/input VAT nettoc | read |
| `calculate_vat` | invoice-д VAT бодох (exclusive/inclusive) | calc |
| `calculate_cit` | ААНОАТ тооцох | calc |
| `calculate_wht` | WHT rate тогтоон тооцох | calc |
| `get_tax_calendar` | filing due date, overdue-г гаргах | read |
| `run_tax_validation` | VAT/CIT/WHT/eBarimt validation set | validate |
| `generate_tax_return_draft` | VAT/CIT/WHT return draft | draft |

### 4.3 Payroll домэйн

| Tool | Зорилго | Type |
|------|---------|------|
| `get_employee_payroll_profile` | ажилтны payroll profile, rate version | read |
| `get_attendance_summary` | ээлжийн нэгдэл: worked/overtime/leave | read |
| `calculate_social_insurance` | employee/employer SI, cap-тэй | calc |
| `calculate_pit` | PIT bracket + credit | calc |
| `calculate_gross_to_net` | payroll engine-ийн үндсэн tool | calc |
| `generate_payslip_draft` | payslip draft | draft |
| `generate_payroll_journal_draft` | payroll GL journal draft | draft |
| `run_payroll_validation` | attendance/SI cap/PIT/negative-net/journal balance | validate |

---

## 5. Decision workflow (ерөнхий)

```
1. Хэрэглэгчийн хүсэлтийг шинжил
   ├─ Ямар домэйн? (ifrs | tax | payroll)
   └─ Ямар intent? (explain | calculate | validate | draft)

2. Context цуглуул
   ├─ companyId, module, period, record
   ├─ userRole, permissions
   └─ asOfDate (effective-date lookup-д зориулав)

3. Knowledge retrieve (хэрэгтэй бол)
   └─ get_skill({ topic }) — domain-оос холбогдох chunk татах

4. Reference data татах (хэрэгтэй бол)
   └─ rates/bracket/calendar — asOfDate-аар нь

5. Tool дуудах (Read → Calc → Validate → Draft дараалалтай)

6. Guardrail ажиллуул
   ├─ Schema validation
   ├─ Business rule validation (debit==credit, SI cap, effective date)
   └─ Permission check (энэ үйлдлийг энэ хэрэглэгч хийж болох уу)

7. Output contract-ын дагуу хариулах
```

---

## 6. Output contract

**Богино асуулт** → 1-2 өгүүлбэр prose.

**Тайлбар / reasoning** →
```
- Applicable standard/law: <...>
- Conclusion: <...>
- Reasoning: <bullet chain>
- System impact: <module/record-т юу нөлөөлнө>
- Recommended next step: <tool call | user action>
```

**Тооцоолол** →
```
- Input summary
- Calculation
  • базис, rate, effective date
  • intermediate → result
- Risk / exception
- Journal impact (хэрэв GL-д ордог бол)
```

**Draft action** →
```
- Draft ID, type
- Lines (accountCode, debit, credit, memo)
- reviewRequired: true
- "Chat card-аас засаад Post дарна уу" гэсэн товч мэдэгдэл
```

---

## 7. Skill-ийн дүрэм (guardrails)

Нарийн policy `guardrails/` folder-т байна. Гол зарчим:

1. **Draft-first action policy.** Бүх post/update/delete tool зөвхөн proposal буцаана. Шууд DB-д бичихгүй.
2. **Effective date заавал.** Tax/payroll rate, threshold, bracket-ийг `asOfDate` эсвэл `periodId`-аар lookup хийнэ. Тодорхойгүй бол хэрэглэгчээс асууна.
3. **Journal balance.** Draft journal үүсгэх үед `debit total === credit total` заавал. Балансгүй бол reject.
4. **Effective date-тэй rate version.** Config-д `effectiveFrom` талбар байхгүй rate table бүү хэрэглэ.
5. **Domain хольж болохгүй.** Tax treatment-ийг IFRS treatment-тэй эсвэл payroll tax-г business tax-тай бүү андуурууул.
6. **Materiality threshold.** Тодорхойгүй/material uncertainty-тэй кейс дээр `advisor review required` тэмдэглэгээтэй хариулна.
7. **Permission check.** `draft` permission-гүй хэрэглэгчид зөвхөн explain хариу буцаана.
8. **Audit log.** Tool бүр `skill_audit_logs`-д бичилт үлдээнэ: toolName, input summary, result summary, userId, companyId, ts.
9. **Mongolian law citation.** Хууль эсвэл IFRS параграф иш татахдаа яг зүйл/standard дугаарыг заана (жишээ: "ААНОАТ хууль 20.2", "IAS 16.31").

---

## 8. Permission matrix

```ts
type SkillPermission =
  | 'skill.read'       // read-only tool (get_*, snapshot, profile)
  | 'skill.calculate'  // calculation tool (calc_*, determinate)
  | 'skill.validate'   // validation tool (run_*_checks)
  | 'skill.draft'      // draft tool (create_*_draft, generate_*)
  | 'skill.approve'    // proposal approve (chat UI)
  | 'skill.post'       // finalize to DB (strict workflow)
```

Зөвлөсөн эрх хуваарилалт:

| Role | read | calculate | validate | draft | approve | post |
|------|------|-----------|----------|-------|---------|------|
| Accountant | ✓ | ✓ | ✓ | ✓ | — | — |
| Senior accountant | ✓ | ✓ | ✓ | ✓ | — | — |
| Chief accountant | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Finance manager | ✓ | ✓ | ✓ | — | ✓ | — |
| Admin / superadmin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`post` эрх зөвхөн strict workflow-оор олгогдоно — agent шууд хэрэглэхгүй.

---

## 9. Холбогдох docs

- **Backend implementation:** `backEnd/agents/skills/expert-accountant/` (tool implementation, guardrail validator)

---

## 10. Skill versioning

| Ver | Огноо | Өөрчлөлт |
|-----|-------|----------|
| 1.0.0 | 2026-04-19 | 3 legacy skill-ийг нэгтгэж expert-accountant болгов |
