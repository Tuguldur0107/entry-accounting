"""C · нээлт 2024-12-31 MCP batch-аар: касс (fix_cash_opening_balance), АР/АП (₮ + валют), бараа (тоо), нээлтийн журнал НЭГ."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
from engine import *
o = Org('C'); P = o.P; L = o.L; s = o.s
CUT = P.CUTOFF
rates = {cu: o.rate(cu, CUT) for cu in ['USD', 'CNY', 'EUR']}
print('rates', rates)
opening = {}  # oracle: acc -> net (Dr+)

def acc_add(a, v):
    opening[a] = r2(opening.get(a, 0) + v)

# 1) касс — fix_cash_opening_balance (ноорог журнал, counter 44000098)
diff98 = 0.0
for ca in P.CASH:
    fc = ca['openingBalance']
    mnt = fc if ca['currency'] == 'MNT' else r2(fc * rates[ca['currency']])
    args = {'cashAccount': ca['name'], 'counterAccount': '44000098', 'date': CUT}
    if ca['currency'] != 'MNT':
        args['exchangeRate'] = rates[ca['currency']]
        L.fc_move(ca['glAccount'], fc, mnt)
    ok, t = o.call('fix_cash_opening_balance', args, 'open:cash')
    for no in o.jvnos(t):
        s['drafts'].append(dict(kind='jv', no=no, month='2024-12', what=f'cash-open:{ca["name"]}'))
    acc_add(ca['glAccount'], mnt); diff98 -= mnt

# 2) АР/АП
items = []
for i, (cp, d, amt) in enumerate(P.OPEN_AR):
    if amt <= 0:
        continue
    items.append(dict(documentType='ar_invoice', counterparty=cp, date=d, description=f'[ОНБ] Авлагын нээлтийн үлдэгдэл — INV-24-{600+i}', vatMode='none',
                      externalRef=f'opening-ar:INV-24-{600+i}', lines=[dict(account='44000098', amount=amt, description='Нээлтийн үлдэгдэл')]))
for i, (cp, d, fc) in enumerate(P.OPEN_AR_USD):
    items.append(dict(documentType='ar_invoice', counterparty=cp, date=d, description=f'[ОНБ] Авлагын нээлт USD — EXP-24-{i+1}', vatMode='none', currency='USD', exchangeRate=rates['USD'],
                      externalRef=f'opening-ar-usd:EXP-24-{i+1}', lines=[dict(account='44000098', amount=fc, description='Нээлтийн үлдэгдэл USD')]))
for i, (cp, d, amt) in enumerate(P.OPEN_AP):
    if amt <= 0:
        continue
    items.append(dict(documentType='ap_bill', counterparty=cp, date=d, description=f'[ОНБ] Өглөгийн нээлтийн үлдэгдэл — B-24-{900+i}', vatMode='none',
                      externalRef=f'opening-ap:B-24-{900+i}', lines=[dict(account='44000098', amount=amt, description='Нээлтийн үлдэгдэл')]))
for i, (cp, d, fc, cu) in enumerate(P.OPEN_AP_FC):
    items.append(dict(documentType='ap_bill', counterparty=cp, date=d, description=f'[ОНБ] Өглөгийн нээлт {cu} — IMP-24-{i+1}', vatMode='none', currency=cu, exchangeRate=rates[cu],
                      externalRef=f'opening-ap-fc:IMP-24-{i+1}', lines=[dict(account='44000098', amount=fc, description=f'Нээлтийн үлдэгдэл {cu}')]))
ok, t = o.call('create_arap_invoices_batch', {'items': items}, 'open:arap')
nos = o.docnos(t, 'AR') + o.docnos(t, 'AP')
ar_nos = o.docnos(t, 'AR'); ap_nos = o.docnos(t, 'AP')
k = 0
for cp, d, amt in P.OPEN_AR:
    if amt <= 0:
        continue
    s['open_ar'].append(dict(no=ar_nos[k] if k < len(ar_nos) else '?', cp=cp, total=amt, bal=amt, date=d, cur='MNT')); k += 1
    acc_add('13110000', amt); diff98 -= amt
for cp, d, fc in P.OPEN_AR_USD:
    mnt = r2(fc * rates['USD'])
    s['open_ar'].append(dict(no=ar_nos[k] if k < len(ar_nos) else '?', cp=cp, total=fc, bal=fc, date=d, cur='USD', mnt=mnt)); k += 1
    acc_add('13110000', mnt); diff98 -= mnt
k = 0
for cp, d, amt in P.OPEN_AP:
    if amt <= 0:
        continue
    s['open_ap'].append(dict(no=ap_nos[k] if k < len(ap_nos) else '?', cp=cp, total=amt, bal=amt, date=d, cur='MNT')); k += 1
    acc_add('31000001', -amt); diff98 += amt
for cp, d, fc, cu in P.OPEN_AP_FC:
    mnt = r2(fc * rates[cu])
    s['open_ap'].append(dict(no=ap_nos[k] if k < len(ap_nos) else '?', cp=cp, total=fc, bal=fc, date=d, cur=cu, mnt=mnt)); k += 1
    acc_add('31000001', -mnt); diff98 += mnt
o.note('open', f'arap items {len(items)} → AR {len(ar_nos)} AP {len(ap_nos)}')

# 3) бараа — тоо хэмжээ (receipt), өртөг нь costing-д "үнэ хүлээж" → oracle-д шууд
stock_val = 0.0
st = P.opening_stock()
s['opening_stock'] = st
for code, wh, q, uc in st:
    ok, t = o.call('create_inventory_movement', {'movementType': 'receipt', 'date': CUT, 'itemCode': code, 'warehouseCode': wh, 'quantity': q, 'description': '[ОНБ] Нээлтийн үлдэгдэл'}, 'open:stock')
    s['stock'][f'{code}|{wh}'] = s['stock'].get(f'{code}|{wh}', 0) + q
    L.inv_receipt('2024-12', code, wh, q, uc, f'OPEN:{code}:{wh}')
    stock_val += q * uc
stock_val = r2(stock_val)
s['opening_stock_value'] = stock_val
o.save()

# 4) ҮХ идэвхжүүлэх + oracle
fa_cost = {'20000001': 0.0, '21000001': 0.0}; fa_acc = {'20000002': 0.0, '21000099': 0.0}
ok, t = o.call('list_fixed_assets', {}, 'open:fa')
codes = {l.split(' · ')[1]: l.split(' · ')[0] for l in t.split('\n') if ' · ' in l}
for f in P.fa_opening():
    ca, aa = ('21000001', '21000099') if f['intangible'] else ('20000001', '20000002')
    fa_cost[ca] += f['cost']; fa_acc[aa] += f['accum']
    L.fa_add(f['name'], f['cost'], f['life'], add_months(CUT[:7], 1), accum=f['accum'], salvage=f['salvage'], acc_cost=ca, acc_accum=aa, acc_exp='70000001')
    code = codes.get(f['name'])
    if code and code != 'FA-20240301-8F206E':
        o.call('activate_fixed_asset', {'assetCode': code}, 'open:fa')
    s['fa'].append(dict(name=f['name'], code=code))

# 5) нээлтийн журнал
lines = []
def ln(acc, amt, desc):
    if abs(amt) < 0.005:
        return
    lines.append(dict(account=acc, debit=amt if amt > 0 else 0, credit=-amt if amt < 0 else 0, description=desc))
    acc_add(acc, amt)
ln('18000001', 9000000, 'Урьдчилж төлсөн даатгал')
for a, v in fa_cost.items():
    ln(a, v, 'ҮХ өртөг (карт бүртгэлтэй)')
for a, v in fa_acc.items():
    ln(a, -v, 'ҮХ хуримтлагдсан элэгдэл')
ln('14000099', stock_val, 'Бараа материалын нээлт (тоо дэд дэвтэрт, өртөг costing-оор капиталжина)')
ln('44000098', -diff98, 'Касс/АР/АП дэд дэвтрийн нээлт (fix_cash_opening_balance + нэхэмжлэх → 0 болно)')
ln('31410000', -6420000, 'НӨАТ өглөг'); ln('31420000', -9870000, 'НДШ өглөг'); ln('31430000', -3210000, 'ХХОАТ өглөг')
ln('32000001', -60000000, 'Богино хугацаат зээл ₮'); usd_loan = r2(50000 * rates['USD']); ln('32000003', -usd_loan, 'USD зээл 50,000 USD'); L.fc_move('32000003', -50000, -usd_loan)
ln('31900001', -5000000, 'Нөөц өр төлбөр'); ln('41000001', -420000000, 'Эздийн өмч')
plug = -sum(l['debit'] - l['credit'] for l in lines)
# 44000098 мөр журналд байгаа тул тэнцүүлэлт нь хуримтлагдсан ашиг
ln('44000001', plug, 'Хуримтлагдсан ашиг (тэнцүүлэлт)')
ok, t = o.call('create_journal_voucher', {'date': CUT, 'description': '[ОНБ] Нээлтийн үлдэгдэл 2024-12-31', 'externalRef': f'opening-balance:{CUT}', 'lines': lines}, 'open:jv')
for no in o.jvnos(t):
    s['drafts'].append(dict(kind='jv', no=no, month='2024-12', what='opening'))
# oracle: нээлтийн цэвэр (14000099 → costing дараа 14000001 болно; oracle-д шууд 14000001)
opening['44000098'] = 0.0
L.post(CUT, [(a, v if v > 0 else 0, -v if v < 0 else 0) for a, v in opening.items() if abs(v) >= 0.005], 'OPENING')
L.inv_close('2024-12')  # нээлтийн орлого капиталжина: Dr 14000001 / Cr 14000099
o.save()
o.call('get_onboarding_guide', {'section': 'status'}, 'open')
