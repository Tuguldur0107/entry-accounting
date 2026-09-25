"""B · сар тус бүрийн онцгой сценари. early(o,m,R) — ops-оос өмнө; late — ops-ын дараа."""
import re
from engine import *
from issues import add as issue


def early(o, m, R):
    P = o.P
    if m == '2025-08':  # сарын дунд ажилд орсон (08-18) — бүтэн сарын цалин олгох ёсгүй
        ok, t = o.call('create_employee', dict(name='Шинэ-Инженер', lastName='Овог', position='Программ хангамжийн инженер', department='Технологи', baseSalary=3000000, hireDate='2025-08-18', registerNo='УБ87019999', employmentType='primary'), f'{m}:hire')
        P.EMPLOYEES.append(dict(name='Шинэ-Инженер', baseSalary=3000000, employerSiPercent=12.5))
        # хүлээлт: 8-р сард 10/21 ажлын өдөр ≈ 0.476 → 1,428,571 (хуанлийн хоногоор 14/31)
        o.s['employees']['Шинэ-Инженер'] = dict(hire='2025-08-18', salary=3000000, extra=True, override={'2025-08': round(3000000 * 10 / 21)})
    if m == '2025-09':  # 09-15-нд ажлаас гарсан
        ok, t = o.call('update_employee', {'employee': 'Багш06', 'terminationDate': '2025-09-15'}, f'{m}:term')
        o.s['employees']['Багш06'] = dict(term='2025-09-15', override={'2025-09': round(next(e['baseSalary'] for e in P.EMPLOYEES if e['name'] == 'Багш06') * 11 / 22)})
        ok, t = o.call('list_employees', {}, f'{m}:term')
        if 'Багш06' in t and 'идэвхгүй' not in t.split('Багш06')[1][:120]:
            o.note(m, 'Багш06 terminationDate өгсөн ч идэвхтэй хэвээр')
    if m == '2025-10':  # инженерүүдийн цалин +10%
        for e in P.EMPLOYEES:
            if e.get('position') == 'Программ хангамжийн инженер' and e['name'].startswith('Инженер'):
                new = int(e['baseSalary'] * 1.1)
                o.call('update_employee', {'employee': e['name'], 'baseSalary': new}, f'{m}:raise')
                o.s['employees'].setdefault(e['name'], {})['salary'] = new
    if m == '2026-02':  # ажилтны зээл 3 сая → цалингаас 500k/сар суутгах (feature байхгүй → гар журнал)
        o.call('create_cash_transactions_batch', {'items': [dict(documentType='payment', date=day(m, 5), cashAccount='Хаан банк MNT', counterAccount='12000004', amount=3000000, description='Ажилтны зээл — Тэмүүжин', externalRef=f'sim:{m}:EMPLOAN', cashFlowCode='1105')]}, f'{m}:loan')
        o.L.post(day(m, 5), [('12000004', 3000000, 0), ('11000001', 0, 3000000)], 'EMPLOAN')
        o.s['emp_loan'] = 3000000
    if m == '2026-04':  # хаагдсан сарыг дахин нээж зардлын ангилал засах (2026-02: маркетинг → сургалт)
        ok, t = o.call('reopen_period', {'code': '2026-02'}, f'{m}:reopen')
        ok, t2 = o.call('create_journal_voucher', {'date': '2026-02-28', 'description': '[ЗАЛРУУЛГА] 2026-02 маркетингийн зардлыг сургалт руу', 'externalRef': 'sim:2026-02:RECLASS',
                                                  'lines': [dict(account='73100012', debit=1000000, credit=0), dict(account='73100005', debit=0, credit=1000000)]}, f'{m}:reopen')
        o.L.post('2026-02-28', [('73100012', 1000000, 0), ('73100005', 0, 1000000)], 'RECLASS')
        ok, t3 = o.call('close_period', {'code': '2026-02'}, f'{m}:reopen')
        ok, t4 = o.call('get_trial_balance', {'from': '2026-03-01', 'to': '2026-03-31'}, f'{m}:reopen')
        if not ok or 'олдсонгүй' in t2:
            o.note(m, 'reopen/reclass: ' + t2[:200])


def late(o, m, R):
    P = o.P
    if m == '2025-12':  # найдваргүй авлага гар журналаар хасах (ENT-065 хойшлогдсон) — хяналтын дансанд бичихэд анхааруулга гарах ёстой
        for cp, amt in [('Стартап Хаб ХХК', 3300000), ('Дижитал Солюшн ХХК', 2200000)]:
            docs = [d for d in o.s['open_ar'] if d['cp'] == cp]
            ok, t = o.call('create_journal_voucher', {'date': eom(m), 'description': f'Найдваргүй авлага хасах — {cp}', 'externalRef': f'sim:{m}:BADDEBT:{cp[:6]}',
                                                     'lines': [dict(account='87000002', debit=amt, credit=0), dict(account='13110000', debit=0, credit=amt)]}, f'{m}:baddebt')
            o.L.post(eom(m), [('87000002', amt, 0), ('13110000', 0, amt)], f'BADDEBT:{cp}')
            for d in docs:
                d['bal'] = 0
            if 'анхааруулга' not in t.lower() and 'хяналтын' not in t.lower():
                o.note(m, f'BADDEBT manual journal to 13110000 accepted without warning: {t[:150]}')
        o.s['open_ar'] = [d for d in o.s['open_ar'] if d['bal'] > 0]
        # 13-р сарын урамшуулал: гар журнал (НДШ/ХХОАТ автоматаар бодогдохгүй — feature gap)
        bonus = 20000000
        o.call('create_journal_voucher', {'date': eom(m), 'description': 'Жилийн урамшуулал (13-р сар) — нийт', 'externalRef': f'sim:{m}:BONUS',
                                          'lines': [dict(account='72100000', debit=bonus, credit=0), dict(account='31500001', debit=0, credit=bonus)]}, f'{m}:bonus')
        o.L.post(eom(m), [('72100000', bonus, 0), ('31500001', 0, bonus)], 'BONUS')
        o.s['bonus_payable'] = bonus
    if m == '2026-01' and o.s.get('bonus_payable'):
        b = o.s.pop('bonus_payable')
        o.call('create_cash_transactions_batch', {'items': [dict(documentType='payment', date=day(m, 8), cashAccount='Хаан банк MNT', counterAccount='31500001', amount=b, description='Урамшуулал олгов', externalRef=f'sim:{m}:BONUSPAY', cashFlowCode='1103')]}, f'{m}:bonus')
        o.L.post(day(m, 8), [('31500001', b, 0), ('11000001', 0, b)], 'BONUSPAY')
    if m in ('2025-09', '2025-12', '2026-03', '2026-06'):  # ААНОАТ улирлын урьдчилгаа (энгийн: 1.5 сая/улирал) — татварын модуль
        o.call('create_journal_voucher', {'date': eom(m), 'description': f'ААНОАТ улирлын тооцоо {m}', 'externalRef': f'sim:{m}:CIT',
                                          'lines': [dict(account='70000004', debit=1500000, credit=0), dict(account='31000003', debit=0, credit=1500000)]}, f'{m}:cit')
        o.L.post(eom(m), [('70000004', 1500000, 0), ('31000003', 0, 1500000)], f'CIT:{m}')
    if m == '2026-05':  # ҮХ борлуулах (Хёндай Соната 45 сая, НӨАТ-тай) + шинэ ноутбук АП-аар авах
        code = next((f['code'] for f in o.s['fa'] if 'Соната' in f['name']), None)
        ok, t = o.call('create_arap_invoice', dict(documentType='ar_invoice', counterparty='Хүрд Авто ХХК' if False else 'Батболд (хувь хүн)', date=day(m, 12), vatMode='exclusive', description='ҮХ борлуулалт — Хёндай Соната',
                                                   externalRef=f'sim:{m}:FASALE', lines=[dict(account='87000004', amount=45000000, description='Хёндай Соната борлуулсан үнэ')]), f'{m}:fasale')
        no = (o.docnos(t, 'AR') or ['?'])[0]
        o.s['open_ar'].append(dict(no=no, cp='Батболд (хувь хүн)', total=49500000, bal=49500000, date=day(m, 12), cur='MNT'))
        o.L.post(day(m, 12), [('13110000', 49500000, 0), ('87000004', 0, 45000000), ('31410000', 0, 4500000)], 'FASALE')
        if code:
            ok, t = o.call('dispose_fixed_asset', {'assetCode': code, 'disposalType': 'sale', 'date': day(m, 12), 'proceeds': 0, 'gainLossAccount': '87000004'}, f'{m}:fasale')
            nbv, gl = o.L.fa_dispose('Хёндай Соната', day(m, 12), proceeds=0, gl_acc='87000004')
            o.note(m, f'FA dispose Соната nbv {nbv} → 87000004 net = {45000000 - nbv}')
        ok, t = o.call('create_arap_invoice', dict(documentType='ap_bill', counterparty='Ай Ти Парк ХХК', date=day(m, 20), vatMode='exclusive', description='Шинэ ноутбук ×6 (ҮХ)', externalRef=f'sim:{m}:FABUY',
                                                   lines=[dict(account='20000099', amount=24000000, description='MacBook Air ×6')]), f'{m}:fabuy')
        no = (o.docnos(t, 'AP') or ['?'])[0]
        o.s['open_ap'].append(dict(no=no, cp='Ай Ти Парк ХХК', total=26400000, bal=26400000, date=day(m, 20), cur='MNT'))
        o.L.post(day(m, 20), [('20000099', 24000000, 0), ('13620000', 2400000, 0), ('31000001', 0, 26400000)], 'FABUY')
        ok, t = o.call('create_fixed_asset', dict(name='Ноутбук MacBook Air ×6', acquisitionDate=day(m, 20), cost=24000000, usefulLifeMonths=36, custodian='Мөнхбат', depreciationStartMonth='2026-06'), f'{m}:fabuy')
        code2 = (re.findall(r'FA-\d{8}-[0-9A-F]{6}', t) or [None])[0]
        if code2:
            ok, t = o.call('activate_fixed_asset', {'assetCode': code2}, f'{m}:fabuy')
            o.note(m, 'activate new FA: ' + t[:200])
        o.L.post(day(m, 20), [('20000001', 24000000, 0), ('20000099', 0, 24000000)], 'FACAP')
        o.L.fa_add('Ноутбук MacBook Air ×6', 24000000, 36, '2026-06')
        o.s['fa'].append(dict(name='Ноутбук MacBook Air ×6', code=code2))
    if m == '2026-06':  # зээлийн үндсэн төлбөр 20 сая
        o.call('create_cash_transactions_batch', {'items': [dict(documentType='payment', date=day(m, 15), cashAccount='Хаан банк MNT', counterAccount='32000001', amount=20000000, description='Зээлийн үндсэн төлбөр', externalRef=f'sim:{m}:LOANPAY', cashFlowCode='3102')]}, f'{m}:loan')
        o.L.post(day(m, 15), [('32000001', 20000000, 0), ('11000001', 0, 20000000)], 'LOANPAY')
