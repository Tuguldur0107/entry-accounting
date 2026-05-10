---
id: guardrail:journal-balance
title: Journal balance guardrail
type: guardrail
severity: error
scope: all_domains
blocks_on: fail
---

# Journal balance guardrail

## Policy

Санхүүгийн бүх GL журналын (proposal эсвэл finalize-д) **дебит нийлбэр = кредит нийлбэр** байх ёстой. Нэг төгрөгийн зөрүү ч гэсэн системд алдаа үүсгэж болно.

## Нарийн шалгалт

1. `abs(sum(debit) − sum(credit)) <= 0.01` — дугуйрлалтын tolerance (1 мөнгө)
2. Нийт дүн > 0 (хоосон журнал биш)
3. Мөр бүр debit эсвэл credit-ийн зөвхөн нэгтэй (хоёуланд зэрэг дүн байж болохгүй)
4. Мөр бүрийн `accountCode` chart of accounts-д байгаа эсэх
5. Мөр бүрийн `debit`/`credit` ≥ 0
6. `periodId` хаагдаагүй байх (эсвэл admin эрхтэй байх — closed-period adjustment)

## Хэрэгжүүлэх цэг

Backend-д `backEnd/agents/skills/expert-accountant/guardrails/validateJournalBalance.js` нь дараах үе шатанд ажиллана:

- `generate_payroll_journal_draft` → return-ийн өмнө
- `create_ifrs_adjustment_draft` → return-ийн өмнө
- `journals_create` proposal → proposal_created болохоос өмнө

## Алдааны дүрэм

```
issue.severity = 'error'
issue.code = 'journal_unbalanced'
issue.message = `Тэнцвэргүй журнал: Dr ${debitSum} ≠ Cr ${creditSum} (зөрүү ${diff})`
issue.blocksDraft = true   // proposal үүсгэхгүй
```

## Хэрэглэгч хэрхэн тайлбарлах

```
"Draft journal тэнцвэрээ хангаагүй байна (Dr 2,519,199₮ ≠ Cr 2,519,200₮).
Journalaa дахин шалгаад дугуйрлалтын зөрүүгээ корректлоорой."
```
