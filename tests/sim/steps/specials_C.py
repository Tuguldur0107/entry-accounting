"""C · сар тус бүрийн онцгой сценари (шүүмжлэлтэй шалгалтууд). early/late/preclose."""
import re
from engine import *
from issues import add as issue
import month_C as MC


def early(o, m, R):
    s = o.s
    if m == '2025-02':  # захиалга цуцлах зам + илүү хүлээн авах оролдлого ([OVER_RECEIVED])
        rate = o.rate('USD', day(m, 3))
        ok, t = o.call('create_purchase_order', dict(supplier='Shenzhen Tools Ltd', date=day(m, 3), currency='USD', exchangeRate=rate, warehouseCode='WH-01', description='Цуцлагдах захиалга (тест)', externalRef=f'sim:{m}:PO:CANCEL',
                                                     lines=[dict(itemCode='IMP-081', quantity=10, unitPrice=38.5)]), f'{m}:cancel')
        no = (re.findall(r'PO-\d{4}-\d{3}', t) or [None])[0]
        if no:
            ok, t2 = o.call('cancel_purchase_order', {'purchaseOrderId': no, 'reason': 'Нийлүүлэгч хүргэж чадахгүй'}, f'{m}:cancel')
            ok, t3 = o.call('create_goods_receipt', dict(purchaseOrderId=no, date=day(m, 10)), f'{m}:cancel')
            if ok:
                issue('S2', 'Хангамж', 'MCP', 'Логик', 'Цуцлагдсан захиалгаас хүлээн авалт үүсгэж болж байна', t3[:300], 'Цуцлагдсан PO-д GR хориглох [PO_CANCELLED]', t3[:200], 'PO статус шалгалт create_goods_receipt-д', f'orgs/C/mcplog.jsonl {m}:cancel', 'C')


def late(o, m, R):
    s = o.s
    if m in ('2025-02', '2025-03'):  # илүү хүлээн авах оролдлого
        po = next((p for p in s['po'] if p['status'] == 'open' and any(l.get('rcv', 0) < l['quantity'] for l in p['lines'])), None)
        if po:
            l = next(l for l in po['lines'] if l.get('rcv', 0) < l['quantity'])
            ok, t4 = o.call('create_goods_receipt', dict(purchaseOrderId=po['no'], date=day(m, 5), lines=[dict(itemCode=l['itemCode'], quantity=l['quantity'] - l.get('rcv', 0) + 5)]), f'{m}:over')
            if ok and 'OVER_RECEIVED' not in t4:
                issue('S2', 'Хангамж', 'MCP', 'Логик', 'Захиалснаас илүү тоогоор хүлээн авалт үүсгэж болж байна ([OVER_RECEIVED] гарахгүй)', t4[:300], '[OVER_RECEIVED] алдаа', t4[:200], '', f'orgs/C/mcplog.jsonl {m}:over', 'C')
                gr = (re.findall(r'GR-\d{4}-\d{3}', t4) or [None])[0]
                # буцаах: ноорог GR-ийг reverse_goods_receipt-оор
                if gr:
                    o.call('reverse_goods_receipt', {'receiptId': gr, 'reason': 'тест — илүү хүлээн авалт'}, f'{m}:over')
    if m == '2025-08':  # эргэлтийн хөрөнгийн зээл 500M (харилцах данс хасах үлдэгдэлтэй болсон) — санхүүгийн үйл ажиллагааны ангилал 3101
        ok, t = o.call('create_cash_transaction', dict(documentType='receipt', date=day(m, 4), cashAccount='Хаан банк MNT', counterAccount='32000001', amount=500000000, counterparty='Хаан банк', description='Эргэлтийн хөрөнгийн зээл — Хаан банк (12 сар, 1.5%)', externalRef=f'sim:{m}:LOAN500', cashFlowCode='3101'), f'{m}:loan')
        o.L.post(day(m, 4), [('11000001', 500000000, 0), ('32000001', 0, 500000000)], 'LOAN500')
        if 'ноорог' in t:
            o.note(m, 'зээлийн орлого ноорог — вэбээр батлагдана')
    if m == '2025-10':  # ENT-043 регресс: өртөггүй гар орлого (илүүдэл олдсон бараа) → тухайн бараа блоклогдох ч бусад нь үнэлэгдэх ёстой; дараа нь вэбээс өртөг оруулна
        ok, t = o.call('create_inventory_movement', dict(movementType='receipt', date=day(m, 10), itemCode='IMP-021', warehouseCode='WH-01', quantity=3, description='Тооллогоор илүү олдсон (эх баримтгүй)'), f'{m}:ent043')
        mid = (re.findall(r'ID ([0-9a-f]{8})', t) or [None])[0]
        if mid:
            o.call('confirm_inventory_movement', {'movementId': mid}, f'{m}:ent043')
        o.s['ent043'] = dict(mid=mid, item='IMP-021', qty=3, cost=210000)
        o.L.inv_receipt(m, 'IMP-021', 'WH-01', 3, 210000, 'ENT043'); MC.stock_add('IMP-021', 'WH-01', 3)
    if m == '2025-11':  # барааны түр дансны үлдэгдлийг цэвэрлэх: илүү олдсон бараа 630,000 → тооллогын илүүдэл; нээлтийн 516,080 → нээлтийн зөрүү
        o.call('create_journal_voucher', {'date': day(m, 5), 'description': 'Бараа материалын түр данс цэвэрлэгээ (илүү олдсон бараа, нээлтийн зөрүү)', 'externalRef': f'sim:{m}:CLR99',
                                          'lines': [dict(account='14000099', debit=1146080, credit=0), dict(account='51800003', debit=0, credit=630000), dict(account='44000098', debit=0, credit=516080)]}, f'{m}:clr99')
        o.L.post(day(m, 5), [('14000099', 1146080, 0), ('51800003', 0, 630000), ('44000098', 0, 516080)], 'CLR99')
    if m in ('2025-03', '2025-06', '2025-09', '2025-12'):  # ААНОАТ улирлын урьдчилгаа
        o.call('create_journal_voucher', {'date': eom(m), 'description': f'ААНОАТ улирлын тооцоо {m}', 'externalRef': f'sim:{m}:CIT', 'lines': [dict(account='70000004', debit=2500000, credit=0), dict(account='31000003', debit=0, credit=2500000)]}, f'{m}:cit')
        o.L.post(eom(m), [('70000004', 2500000, 0), ('31000003', 0, 2500000)], f'CIT:{m}')


def preclose(o, m, R):
    """Хаалтын өмнөх: 2025-01 — хэсэгчилсэн хүлээн авалттай PO сар хаалтыг хориглодог эсэхийг баримтжуулсан (SIM2-023). Бүх сард: нээлттэй PO-г дуусгах."""
    MC.po_finalize_all(m, R)
