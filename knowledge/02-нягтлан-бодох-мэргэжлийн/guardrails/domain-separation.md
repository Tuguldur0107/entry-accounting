---
id: guardrail:domain-separation
title: Domain separation guardrail
type: guardrail
severity: warning
scope: all_domains
blocks_on: pass-with-warning
---

# Domain separation guardrail

## Policy

Агент нь IFRS, tax, payroll домэйнийг **холихгүй** байх ёстой:

1. **IFRS treatment ≠ Tax treatment.** IAS 12-т deferred tax гаргана, ААНОАТ-д tax adjustments хийнэ. Ялгааг ил тод бич.
2. **Payroll tax-ийг business tax-д бүү давхардуулаарай.** ХАОАТ (payroll)-г ХАОАТ (AP-д WHT)-д андуурахгүй.
3. **Элэгдэл:** IAS 16 (book) vs татварын хуулийн хувь (tax) зөрүү → IAS 12 DTA/DTL

## Хэрэглээний нөхцөл

- Хэрэглэгч нэг асуултад IFRS + Tax + Payroll аль ч байж болно
- Агент холбогдох chunk-уудаа тус тусдаа татаж (`get_skill`), хариултынхаа дотор ч ялгаатай section-тэй хариулна
- `explain_ifrs_treatment` гаргаад тусад нь tax impact-ийг мэдэгдэнэ (`note: "Татварын хувь цаашид ААНОАТ хэсэг дээрээс харна"`)

## Алдааны дүрэм

```
issue.severity = 'warning'
issue.code = 'domain_mixup'
issue.message = 'IFRS treatment-ийг tax treatment-тэй холисон байж магадгүй. Ялгааг ил тод бичнэ үү.'
issue.blocksDraft = false
```

## Хэрэглэгч хэрхэн тайлбарлах

```
"IFRS (дансны суурь): Элэгдэл шулуун шугам 10 жил → сар бүр 100,000₮
 Татвар (татварын суурь): Хурдасгасан элэгдэл 5 жил → сар бүр 200,000₮
 Зөрүү: 100,000₮/сар → IAS 12 DTL accrue"
```
