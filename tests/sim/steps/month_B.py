"""B · SIM Сервис — сарын үйл ажиллагаа. python3 steps/month_B.py 2025-07 [steps]"""
import sys, os, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
from engine import *
o = Org('B'); P = o.P; L = o.L; s = o.s
ORG_CUST = [c_['name'] for c_ in P.CUSTOMERS if c_['entityKind'] == 'organization']
IND_CUST = [c_['name'] for c_ in P.CUSTOMERS if c_['entityKind'] == 'individual']
CONTRACTS = {  # сар бүрийн IT аутсорсингийн гэрээ (цэвэр ₮)
    "Монгол Даатгал ХК": 18000000, "Юнител ХХК": 22000000, "Оюу Толгой ХХК": 42000000, "Хас Банк": 30000000, "Голомт Банк": 25000000, "Мобиком Корпораци": 18000000,
    "Эрдэнэс Тавантолгой": 20000000, "АПУ ХК": 15000000, "Ард Санхүүгийн Нэгдэл": 12500000, "Энержи Ресурс": 14000000, "Таван Богд Групп": 11000000, "Петровис ХХК": 9000000,
    "Номин Холдинг": 8500000, "Ганзам ХХК": 10000000, "Гоби ХК": 8000000, "Скайтел ХХК": 6500000, "Улаанбаатар Хотын Банк": 16000000, "Монголын Алт МАК": 13000000}


def sales(m, R):
    items = []
    d1 = day(m, 1)
    for k, (cp, amt) in enumerate(CONTRACTS.items()):
        if R.random() < 0.05:
            continue  # заримдаа гэрээ түр зогсоно
        items.append(dict(documentType='ar_invoice', counterparty=cp, date=day(m, R.randint(1, 5)), vatMode='exclusive', description=f'IT аутсорсинг — {m}',
                          externalRef=f'sim:{m}:AR:C{k:02d}', lines=[dict(account='51100002', amount=amt, description=f'{m} сарын үйлчилгээ')]))
    for k in range(R.randint(6, 14)):  # нэг удаагийн төслүүд
        cp = R.choice(ORG_CUST)
        items.append(dict(documentType='ar_invoice', counterparty=cp, date=day(m, R.randint(3, 27)), vatMode='exclusive', description=f'Төслийн ажил {m}',
                          externalRef=f'sim:{m}:AR:P{k:02d}', lines=[dict(account='51100002', amount=R.choice([1500000, 2400000, 3600000, 4800000, 7200000, 9600000]), description='Хөгжүүлэлт, дэмжлэг')]))
    for k in range(R.randint(4, 10)):  # сургалт — НӨАТ-гүй (чөлөөлөгдсөн)
        cp = R.choice(ORG_CUST + IND_CUST)
        items.append(dict(documentType='ar_invoice', counterparty=cp, date=day(m, R.randint(3, 27)), vatMode='none', description=f'Сургалт {m} (НӨАТ-гүй)',
                          externalRef=f'sim:{m}:AR:T{k:02d}', lines=[dict(account='51100003', amount=R.choice([450000, 900000, 1350000, 2700000]), description='Сургалтын төлбөр')]))
    if m[-2:] in ('09', '12', '03', '06'):
        for k, cp in enumerate(["Хас Банк", "Оюу Толгой ХХК", "Ай Ти Парк ХХК"]):
            items.append(dict(documentType='ar_invoice', counterparty=cp, date=day(m, 15), vatMode='exclusive', description=f'Лицензийн улирлын төлбөр {m}',
                              externalRef=f'sim:{m}:AR:L{k}', lines=[dict(account='51100004', amount=R.choice([9000000, 12000000, 15000000]), description='Програм хангамжийн лиценз')]))
    nos = []
    for i in range(0, len(items), 100):
        ok, t = o.call('create_arap_invoices_batch', {'items': items[i:i + 100]}, f'{m}:sales')
        nos += o.docnos(t, 'AR')
    for it, no in zip(items, nos):
        net = sum(l['amount'] for l in it['lines']); vat = round(net * VAT) if it['vatMode'] == 'exclusive' else 0; tot = net + vat
        s['open_ar'].append(dict(no=no, cp=it['counterparty'], total=tot, bal=tot, date=it['date'], cur='MNT'))
        L.post(it['date'], [('13110000', tot, 0)] + [(l['account'], 0, l['amount']) for l in it['lines']] + ([('31410000', 0, vat)] if vat else []), no)
    if len(nos) != len(items):
        o.note(m, f'sales {len(items)} items, {len(nos)} numbers')


def purchases(m, R):
    util = R.randint(600, 950) * 1000
    items = [dict(documentType='ap_bill', counterparty='Оффис Түрээс ХХК', date=day(m, 1), vatMode='exclusive', description=f'Оффисын түрээс {m}', externalRef=f'sim:{m}:RENT', lines=[dict(account='73100002', amount=9000000)]),
             dict(documentType='ap_bill', counterparty='Батсүх (хувь хүн, түрээслүүлэгч)', date=day(m, 1), vatMode='none', description=f'Зогсоолын түрээс (хувь хүн, суутган 10%) {m}', externalRef=f'sim:{m}:RENT2', lines=[dict(account='73100002', amount=2500000)]),
             dict(documentType='ap_bill', counterparty='УБЦТС ТӨХК', date=eom(m), vatMode='inclusive', description=f'Цахилгаан {m}', externalRef=f'sim:{m}:UTIL', lines=[dict(account='73100003', amount=util)]),
             dict(documentType='ap_bill', counterparty='Юнивишн ХХК', date=eom(m), vatMode='inclusive', description=f'Интернэт {m}', externalRef=f'sim:{m}:NET', lines=[dict(account='73100008', amount=440000)]),
             dict(documentType='ap_bill', counterparty='Клауд Хостинг ХХК', date=day(m, 5), vatMode='exclusive', description=f'Cloud хостинг {m}', externalRef=f'sim:{m}:CLOUD', lines=[dict(account='73100008', amount=R.randint(2800, 3600) * 1000)])]
    if m[-2:] in ('03', '06', '09', '12'):
        items.append(dict(documentType='ap_bill', counterparty='Аудит Партнерс ХХК', date=day(m, 20), vatMode='exclusive', description=f'Улирлын аудит, зөвлөгөө {m}', externalRef=f'sim:{m}:AUDIT', lines=[dict(account='73100011', amount=6000000)]))
    if m == '2026-01':
        items.append(dict(documentType='ap_bill', counterparty='Монгол Даатгал ХК', date=day(m, 10), vatMode='none', description='Жилийн даатгал 2026 (урьдчилж төлсөн)', externalRef=f'sim:{m}:INS', lines=[dict(account='18000001', amount=14400000)]))
    ok, t = o.call('create_arap_invoices_batch', {'items': items}, f'{m}:purchases')
    nos = o.docnos(t, 'AP')
    for it, no in zip(items, nos):
        g = sum(l['amount'] for l in it['lines'])
        if it['vatMode'] == 'exclusive':
            net, vat = g, round(g * VAT)
        elif it['vatMode'] == 'inclusive':
            vat = round(g * 10 / 110, 2); net = round(g - vat, 2)
        else:
            net, vat = g, 0
        tot = net + vat
        s['open_ap'].append(dict(no=no, cp=it['counterparty'], total=tot, bal=tot, date=it['date'], cur='MNT', wht=(250000 if 'RENT2' in it['externalRef'] else 0)))
        L.post(it['date'], [('31000001', 0, tot), (it['lines'][0]['account'], net, 0)] + ([('13620000', vat, 0)] if vat else []), no)


def collections(m, R):
    items = []
    cutoff = f'{m}-01'
    for doc in [d for d in s['open_ar'] if d['date'] < cutoff and d['bal'] > 0]:
        r = R.random()
        if r < 0.15:
            continue
        amt = doc['bal'] if r > 0.25 else round(doc['bal'] / 2)
        dt = day(m, R.randint(3, 28)); acct = R.choice(['Хаан банк MNT', 'Хаан банк MNT', 'ХХБ MNT'])
        items.append(dict(documentType='receipt', date=dt, cashAccount=acct, counterAccount='13110000', amount=amt, counterparty=doc['cp'], description=f'Төлбөр {doc["no"]}',
                          externalRef=f'sim:{m}:RC:{doc["no"]}', applyTo=[dict(documentId=doc['no'], amount=amt)], cashFlowCode='1101'))
        doc['bal'] -= amt
        L.post(dt, [('11000001' if acct.startswith('Хаан') else '11000003', amt, 0), ('13110000', 0, amt)], doc['no'])
    for doc in [d for d in s['open_ap'] if d['date'] < cutoff and d['bal'] > 0]:
        dt = day(m, R.randint(5, 25)); amt = doc['bal'] - doc.get('wht', 0)
        items.append(dict(documentType='payment', date=dt, cashAccount='Хаан банк MNT', counterAccount='31000001', amount=amt, counterparty=doc['cp'], description=f'Төлбөр {doc["no"]}',
                          externalRef=f'sim:{m}:PY:{doc["no"]}', applyTo=[dict(documentId=doc['no'], amount=amt)], cashFlowCode='1102'))
        L.post(dt, [('31000001', amt, 0), ('11000001', 0, amt)], doc['no'])
        if doc.get('wht'):
            # суутган татвар 10% — өглөгийн үлдэгдлийг татварын өглөг рүү (гар журнал)
            ok, t = o.call('create_journal_voucher', {'date': dt, 'description': f'Суутган татвар 10% — хувь хүний түрээс {doc["no"]}', 'externalRef': f'sim:{m}:WHT:{doc["no"]}',
                                                      'lines': [dict(account='31000001', debit=doc['wht'], credit=0), dict(account='31000004', debit=0, credit=doc['wht'])]}, f'{m}:wht')
            L.post(dt, [('31000001', doc['wht'], 0), ('31000004', 0, doc['wht'])], f'WHT:{doc["no"]}')
            s['open_ap_wht_settle'] = s.get('open_ap_wht_settle', []) + [dict(no=doc['no'], amt=doc['wht'])]
        doc['bal'] = 0
    for i in range(0, len(items), 100):
        o.call('create_cash_transactions_batch', {'items': items[i:i + 100]}, f'{m}:collections')
    s['open_ar'] = [d for d in s['open_ar'] if d['bal'] > 0]
    s['open_ap'] = [d for d in s['open_ap'] if d['bal'] > 0]


def misc(m, R):
    """Зээлийн хүү, IFRS16 түрээс, урьдчилж төлсөн даатгал, урьдчилж орсон орлого, суутган татвар төлөлт, банкны шимтгэл, томилолт."""
    d = eom(m)
    jv = []
    jv.append(('Зээлийн хүү 1.5% (80 сая)', [('87000005', 1200000, 0), ('32000002', 0, 1200000)]))
    jv.append(('IFRS 16 түрээсийн хүү (72 сая × 1%)', [('87000001', 720000, 0), ('33000001', 0, 720000)]))
    jv.append(('Урьдчилж төлсөн даатгалын сарын зардал', [('73100010', 1200000, 0), ('18000001', 0, 1200000)]))
    jv.append(('Урьдчилж орсон орлого хүлээн зөвшөөрөх (36 сая / 12)', [('32000004', 3000000, 0), ('51100004', 0, 3000000)]))
    for desc, lines in jv:
        o.call('create_journal_voucher', {'date': d, 'description': f'{desc} — {m}', 'externalRef': f'sim:{m}:JV:{desc[:12]}', 'lines': [dict(account=a, debit=dr, credit=cr) for a, dr, cr in lines]}, f'{m}:misc-jv')
        L.post(d, lines, f'JV:{m}:{desc[:12]}')
    cash = [dict(documentType='payment', date=day(m, 25), cashAccount='Хаан банк MNT', counterAccount='32000002', amount=1200000, description=f'Зээлийн хүү төлөв {m}', externalRef=f'sim:{m}:INT', cashFlowCode='3103'),
            dict(documentType='payment', date=day(m, 25), cashAccount='Хаан банк MNT', counterAccount='33000001', amount=4500000, description=f'Түрээсийн төлбөр (IFRS16) {m}', externalRef=f'sim:{m}:LEASE', cashFlowCode='3102'),
            dict(documentType='payment', date=eom(m), cashAccount='Хаан банк MNT', counterAccount='73100004', amount=R.randint(40, 90) * 1000, description=f'Банкны шимтгэл {m}', externalRef=f'sim:{m}:FEE'),
            dict(documentType='payment', date=day(m, R.randint(8, 20)), cashAccount='Касс MNT', counterAccount='73100006', amount=R.randint(300, 900) * 1000, description=f'Томилолт, такси {m}', externalRef=f'sim:{m}:TRIP'),
            dict(documentType='payment', date=day(m, R.randint(5, 20)), cashAccount='Касс MNT', counterAccount='73100007', amount=R.randint(80, 250) * 1000, description=f'Бичиг хэрэг {m}', externalRef=f'sim:{m}:OFFICE'),
            dict(documentType='transfer', date=day(m, 2), cashAccount='Хаан банк MNT', toCashAccount='Касс MNT', amount=2000000, description=f'Банкнаас касс {m}', externalRef=f'sim:{m}:TRF')]
    if m[-2:] in ('07', '10', '01', '04'):
        cash.append(dict(documentType='payment', date=day(m, 12), cashAccount='ХХБ MNT', counterAccount='73100005', amount=3000000, description=f'Маркетинг, LinkedIn {m}', externalRef=f'sim:{m}:MKT'))
    wht = s.pop('open_ap_wht_settle', [])
    if wht:
        tot = sum(x['amt'] for x in wht)
        cash.append(dict(documentType='payment', date=day(m, 10), cashAccount='Хаан банк MNT', counterAccount='31000004', amount=tot, description=f'Суутган татвар төлөв {m}', externalRef=f'sim:{m}:WHTPAY', cashFlowCode='1104'))
    for it in cash:
        if it['documentType'] == 'transfer':
            L.post(it['date'], [('10000001', it['amount'], 0), ('11000001', 0, it['amount'])], it['externalRef'])
        else:
            src = {'Хаан банк MNT': '11000001', 'ХХБ MNT': '11000003', 'Касс MNT': '10000001'}[it['cashAccount']]
            L.post(it['date'], [(it['counterAccount'], it['amount'], 0), (src, 0, it['amount'])], it['externalRef'])
    o.call('create_cash_transactions_batch', {'items': cash}, f'{m}:misc-cash')


if __name__ == '__main__':
    m = sys.argv[1]
    steps = sys.argv[2].split(',') if len(sys.argv) > 2 else ['sales', 'purchases', 'collections', 'misc']
    R = random.Random(int(m.replace('-', '')) * 7)
    for st in steps:
        globals()[st](m, R)
        o.save()
