---
id: workflow:period-close
title: Сарын / жилийн хаалт workflow
type: workflow
applies_to: [gl, reports]
---

# Период хаалт (Period close) — workflow

## Сарын хаалтын дараалал

1. Бүх гүйлгээ бүртгэсэн эсэхийг шалгах
2. Банкны тулгалт хийх (bank reconciliation)
3. Элэгдэл бодох (FA — IAS 16)
4. Урьдчилсан зардал хуваарилах (prepayments)
5. Ханшийн revaluation (IAS 21)
6. Inventory NRV шалгалт (IAS 2)
7. ECL тооцоолол (IFRS 9)
8. НӨАТ тайлан бэлдэх
9. НДШ / ЭМД тайлагнах
10. Trial balance шалгах
11. Хугацаа хаах (GL period close)

## Жилийн хаалтын нэмэлт

- Хойшлогдсон татвар тооцоолол (IAS 12)
- Хөрөнгийн impairment шалгалт (IAS 36)
- Нөөц шинэчлэлт (IAS 37)
- Санхүүгийн тайлан бэлдэх (IAS 1)
- Ашгийг хуримтлагдсан ашигт шилжүүлэх (closing entry)
- ААНОАТ жилийн тооцоо (IAS 12 + Монгол хууль)
- Аудит (3 тэрбум+ активтай бол)

## Timeline — жилийн хуанли

```
Сар бүр:
  5-нд:  НДШ тайлан + төлбөр
  10-нд: ХАОАТ суутгалын тайлан + НӨАТ тайлан + төлбөр
  15-нд: GL period close

Улирал бүр:
  25-нд: ААНОАТ урьдчилгаа (4/25, 7/25, 10/25, 1/25)

Жилийн эхэн:
  1/15: НӨАТ жилийн тайлан
  2/10: ААНОАТ жилийн тайлан + төлбөр
  2/15: НДШ жилийн тайлан + ХАОАТ ТТ-11
  3/01: Санхүүгийн тайлан (ТЕГ)
  4/01: Аудит (шаардлагатай бол)
```

## Tool дараалал (automation)

```
run_tax_validation({ validationSet: 'vat_return' })
  ↓
run_payroll_validation({ validationSet: ['attendance', 'si_cap', 'pit'] })
  ↓
calculate_vat-ын snapshot → draft VAT return
  ↓
run_ifrs_checks({ checkSet: 'ias1_reports' })
  ↓
run_ifrs_checks({ checkSet: 'ias7_cashflow' })
  ↓
(жилд нэг удаа) run_ifrs_checks({ checkSet: 'ias36_impairment' })
  ↓
calculate_cit({ fiscalYear }) — жилийн эцэст
  ↓
generate_tax_return_draft({ taxType: 'cit' })
```

## Guardrails

- `gl_periods.status = 'closed'` болмогц дахин нээлгүйгээр засварын журнал бичнэ (IAS 8)
- Хаагдсан хугацаанд засвар хийх эрх → зөвхөн `admin` / `superadmin`
- Жилийн хаалтын алхам бүр audit log-тэй байх
