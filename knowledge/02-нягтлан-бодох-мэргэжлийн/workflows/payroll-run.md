---
id: workflow:payroll-run
title: Цалин бодолтын бүрэн workflow
type: workflow
applies_to: [payroll, gl]
---

# Payroll run — workflow

## Дараалал (Status lifecycle)

```
draft → calculated → posted
  ↑         ↓
  └─── (дахин засвал draft руу буцна)
```

## Алхмууд

### 1. Create Run

```
POST /api/payroll-runs
→ Бүх идэвхтэй ажилтнууд автомат нэмэгдэнэ
→ Статус: draft
```

### 2. Edit lines

- Ажлын цаг, илүү цаг, урамшуулал, бусад суутгал
- Employee-specific override
- Статус: **draft** хэвээр

### 3. Calculate

Tool дараалал:

```
get_employee_payroll_profile   (эхлээд — base data)
  ↓
get_attendance_summary         (worked/overtime/leave)
  ↓
calculate_social_insurance     (employee + employer SI, cap)
  ↓
calculate_pit                  (bracket + credit)
  ↓
calculate_gross_to_net         (final per-employee)
```

- Статус: **calculated**
- Per-employee detail хадгалагдана

### 4. Validate

```
run_payroll_validation({
  validationSet: ['attendance', 'si_cap', 'pit', 'negative_net', 'journal_balance']
})
```

- issues severity: info | warning | error
- error байвал posting-т явахгүй

### 5. Generate payslip draft

- `generate_payslip_draft` per employee
- PDF / print output
- Хэрэглэгчид review хийх боломжтой

### 6. GL Posting

```
generate_payroll_journal_draft({ payrollRunId, periodId })
  → 7 мөрийн журнал draft (Dr=Cr checked)
  → reviewRequired: true
  → journal_balance guardrail pass-тай байх ёстой

Хэрэглэгч UI-ээс Post дарах үед:
  → Статус: posted (цаашид засах боломжгүй)
  → Disbursement list бэлэн
```

## Output contract

```
- Period: <YYYY-MM>
- Employees: <count>
- Totals:
    Gross: <amount>
    Deductions: SI <x>, PIT <y>, other <z>
    Net: <amount>
    Employer cost: <amount>
    Total labor: <Gross + Employer>
- Journal impact:
    Draft ID, 7 lines, Dr = Cr = <amount>
- Next step: "UI card дээр засаад Post дарах"
```
