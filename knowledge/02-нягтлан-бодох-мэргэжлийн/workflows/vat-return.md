---
id: workflow:vat-return
title: НӨАТ тайлан бэлдэх workflow
type: workflow
applies_to: [ar, ap, pos, gl]
---

# НӨАТ тайлан (VAT return) — workflow

## Дараалал

```
1. Context:
   • companyId, periodId (сар)
   • VAT registration status (get_taxpayer_profile)

2. get_vat_snapshot({ companyId, periodId }):
   → outputVat (gaarlтын НӨАТ — AR + POS)
   → inputVat (оролтын НӨАТ — AP)
   → invoice count

3. calculate_vat-ийг шалгах transactions:
   → Exclusive vs inclusive зөв таглагдсан
   → Export (zero-rated) 0%-д ангилагдсан
   → Чөлөөлөгдсөн үйлчилгээнд НӨАТ ногдохгүй

4. run_tax_validation({ validationSet: 'vat_return' }):
   → Deductible: 50% restriction hotel/restaurant
   → E-баримтгүй input VAT-г ногдуулаагүй эсэх
   → Missing e-baгимт warnings

5. Тооцоо:
   payableVat = outputVat − inputVat
   if payableVat < 0: refundableVat = |payableVat|

6. generate_tax_return_draft({ taxType: 'vat', periodId }):
   → draft_id, totals summary
   → reviewRequired: true

7. GL-д posting draft журнал:
   (төлөх) Dr 31000003 НӨАТ өглөг (output)
           Cr 12000002 НӨАТ авлага (input)
           Cr 11000001 Банк (зөрүү)
```

## Deadline

Дараа сарын **10-нд** тайлан + төлбөр. Хоцорвол 0.1%/хоног алданги.

## Output contract

```
- Tax type: НӨАТ
- Period: <YYYY-MM>
- Basis:
    Output VAT: <amount> (<invoice count> нэхэмжлэл)
    Input VAT:  <amount>
- Calculation:
    Payable: <amount>  / Refundable: <amount>
- Risks/exceptions:
    • <missing e-baгимт, deductibility issues>
- Next filing action:
    • Draft ID: <uuid>, due: YYYY-MM-10
    • "UI-ээс засаад Post дарах"
```
