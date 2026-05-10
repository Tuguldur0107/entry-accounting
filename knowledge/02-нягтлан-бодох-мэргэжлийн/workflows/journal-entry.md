---
id: workflow:journal-entry
title: GL журнал бичилт үүсгэх workflow
type: workflow
applies_to: [gl]
---

# GL журнал бичилт — workflow

Үндсэн зарчим: агент шууд post хийхгүй, `journals_create` tool-оор **proposal/draft** үүсгэж, хэрэглэгч UI card-аас Post дарна.

## Дараалал

```
1. Context цуглуул
   • companyId, periodId, userId, module
   • asOfDate (effective date-ийг сонгоход)
   • subjectType (transaction | report_line | adjustment)

2. Knowledge татах (шаардлагатай бол)
   • IFRS standard: get_skill({ topic: 'ifrs:ias-xx' })
   • Tax treatment: get_skill({ topic: 'tax:vat' | 'tax:cit' | 'tax:wht' })

3. Account mapping
   • 8 оронтой дансны код ашиглах
   • Domain-оос хамаарч холбогдох код:
     - Хөрөнгө: 1XXXXXXX / 2XXXXXXX
     - Өр: 3XXXXXXX
     - Эздийн өмч: 4XXXXXXX
     - Орлого: 5XXXXXXX
     - COGS: 6XXXXXXX
     - Зардал: 7XXXXXXX
     - Санхүүгийн: 8XXXXXXX

4. Мөр бэлдэх (lines)
   • accountCode, debit/credit, memo, cost_center?
   • Дебит Total = Кредит Total шалгах (validate_journal_balance guardrail)

5. Draft journal proposal үүсгэх
   • journals_create tool → proposal_created: true
   • reviewRequired: true

6. Хариулах
   • "Draft үүслээ — UI card-аас засаад Post дарна уу"
   • Draft ID, lines, Dr/Cr total-ийн summary
```

## Output contract

```
- Applicable standard/law: <IAS/IFRS/хууль>
- Conclusion: <нэг өгүүлбэр — яагаад ингэж бичих вэ>
- Reasoning: <bullet chain>
- Lines:
    Dr <account> — <amount> — <memo>
    Cr <account> — <amount> — <memo>
- Draft ID: <uuid> (reviewRequired: true)
- Next step: "UI card-ийг нээж засах / Post дарах"
```

## Guardrail

- `debit_total === credit_total` (заавал)
- accountCode exists in chart of accounts (DB lookup)
- periodId not closed
- Amount > 0
- userId-д `skill.draft` permission байгаа
- Материаллаг дүн (threshold-ээс дээш) → `human-in-the-loop` required

Нарийн validator: [guardrails/journal-balance.md](../guardrails/journal-balance.md), [guardrails/human-in-the-loop.md](../guardrails/human-in-the-loop.md).
