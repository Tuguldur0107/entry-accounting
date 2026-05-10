---
id: guardrail:human-in-the-loop
title: Human-in-the-loop guardrail
type: guardrail
severity: varies
scope: all_domains
blocks_on: varies
---

# Human-in-the-loop guardrail

## Policy

Агент нь бичилтийг **шууд DB-д Post хийхгүй**. Бүх mutation proposal буюу draft байна. Үүнээс гадна дараах өндөр-эрсдэлт үйлдлүүд хүний зөвшөөрөл шаардана.

## Triggering үйлдлүүд

| Үйлдэл | Шаардлага |
|--------|-----------|
| Том дүнтэй journal (>10M ₮) | chief_accountant approval |
| Тайлант үеийн хаалттай журнал засвар (IAS 8) | admin approval |
| Төсвийн бус зардал бүртгэх | finance_manager approval |
| Hard-delete / GL отрверс | admin approval |
| ААНОАТ тооцооны жилийн шилжүүлэлт | chief_accountant approval |
| Payroll post хийх | chief_accountant эсвэл admin |
| VAT refund claim | chief_accountant approval |

## Materiality threshold-ийн тохиргоо

```json
{
  "journalAmountThresholdMnt": 10000000,
  "payrollTotalThresholdMnt":  50000000,
  "fxRevaluationThresholdMnt":  5000000,
  "ifrsAdjustmentThresholdMnt": 1000000
}
```

`reference-data/materiality-thresholds.json`-д эдгээрийг тохируулна (компани тус бүрээр override хийж болно).

## Workflow — proposal → approve → post

```
1. Агент draft үүсгэнэ (proposal_created: true)
2. UI card-д харагдана — approval-requiring badge-тай
3. Хэрэглэгчийн role-ийг шалгана:
   - role < required → "Та энэ үйлдлийг батлах эрхгүй" гэж харуулна
4. Chat card дээр [Approve] [Edit] [Reject] товч гарна
5. Approve дармагц:
   a. Approval audit log үүсгэнэ
   b. Тохирох tool-ийн real exec (POST) хийгдэнэ
   c. DB-д бичигдэнэ
6. Reject хийвэл proposal archive болно
```

## Permission matrix

Энэ matrix нь дэлгэрэнгүй SKILL.md-н "§ 8. Permission matrix"-д байна. Товчхон:

- `skill.draft` — agent proposal үүсгэх
- `skill.approve` — proposal-ийг батлах (chief_accountant+)
- `skill.post` — batлагдсаныг бодитоор бичих (strict workflow, agent шууд хийхгүй)
