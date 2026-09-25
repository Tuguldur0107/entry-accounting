"""B · дунд жилийн нээлт 2025-06-30: журнал Excel импортоор (вэб), АР/АП MCP batch, ҮХ идэвхжүүлэх, oracle."""
import sys, os, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
from engine import *
from openpyxl import Workbook
o = Org('B'); P = o.P; L = o.L; s = o.s
CUT = P.CUTOFF
opening = {}
def acc_add(a, v):
    opening[a] = r2(opening.get(a, 0) + v)

# 1) АР/АП — MCP batch (нээлт → 44000098)
items = []
for i, (cp, d, amt) in enumerate(P.OPEN_AR):
    items.append(dict(documentType='ar_invoice', counterparty=cp, date=d, description=f'[ОНБ] Авлагын нээлтийн үлдэгдэл — S-25-{700+i}', vatMode='none',
                      externalRef=f'opening-ar:S-25-{700+i}', lines=[dict(account='44000098', amount=amt, description='Нээлтийн үлдэгдэл')]))
for i, (cp, d, amt) in enumerate(P.OPEN_AP):
    items.append(dict(documentType='ap_bill', counterparty=cp, date=d, description=f'[ОНБ] Өглөгийн нээлтийн үлдэгдэл — V-25-{800+i}', vatMode='none',
                      externalRef=f'opening-ap:V-25-{800+i}', lines=[dict(account='44000098', amount=amt, description='Нээлтийн үлдэгдэл')]))
ok, t = o.call('create_arap_invoices_batch', {'items': items}, 'open:arap')
ar_nos = o.docnos(t, 'AR'); ap_nos = o.docnos(t, 'AP')
for k, (cp, d, amt) in enumerate(P.OPEN_AR):
    s['open_ar'].append(dict(no=ar_nos[k] if k < len(ar_nos) else '?', cp=cp, total=amt, bal=amt, date=d, cur='MNT')); acc_add('13110000', amt)
for k, (cp, d, amt) in enumerate(P.OPEN_AP):
    s['open_ap'].append(dict(no=ap_nos[k] if k < len(ap_nos) else '?', cp=cp, total=amt, bal=amt, date=d, cur='MNT')); acc_add('31000001', -amt)
o.note('open', f'arap {len(items)} → AR {len(ar_nos)} AP {len(ap_nos)}')

# 2) ҮХ идэвхжүүлэх; газрыг GL-д (SIM2-001)
ok, t = o.call('list_fixed_assets', {}, 'open:fa')
codes = {l.split(' · ')[1]: l.split(' · ')[0] for l in t.split('\n') if ' · ' in l}
fa_cost = {'20000001': 0.0, '21000001': 0.0}; fa_acc = {'20000002': 0.0, '21000099': 0.0}
for f in P.fa_opening():
    ca, aa = ('21000001', '21000099') if f['intangible'] else ('20000001', '20000002')
    exp = '70000002' if f['rou'] else '70000001'
    fa_cost[ca] += f['cost']; fa_acc[aa] += f['accum']
    if f['life']:
        L.fa_add(f['name'], f['cost'], f['life'], add_months(CUT[:7], 1), accum=f['accum'], salvage=f['salvage'], acc_cost=ca, acc_accum=aa, acc_exp=exp)
    code = codes.get(f['name'])
    if code:
        o.call('activate_fixed_asset', {'assetCode': code}, 'open:fa')
    s['fa'].append(dict(name=f['name'], code=code))

# 3) Нээлтийн журнал — Excel (Баримт № | Огноо | Журналын нэр | Данс | Дебет | Кредит | Мөрийн тайлбар)
rows = []
def ln(acc, amt, desc):
    if abs(amt) < 0.005:
        return
    rows.append(['JE-OPEN', CUT, '[ОНБ] Нээлтийн үлдэгдэл 2025-06-30 (дунд жил, YTD)', acc, amt if amt > 0 else '', -amt if amt < 0 else '', desc])
    acc_add(acc, amt)
for a, v in P.OPENING_BS.items():
    if a in ('13110000', '31000001'):
        continue  # дэд дэвтрээр
    ln(a, v, 'Нээлтийн үлдэгдэл')
ar_tot = sum(a for _, _, a in P.OPEN_AR); ap_tot = sum(a for _, _, a in P.OPEN_AP)
ln('44000098', ar_tot - ap_tot, 'АР/АП дэд дэвтрийн нээлт (нэхэмжлэхээр 0 болно)')
for a, v in fa_cost.items():
    ln(a, v, 'ҮХ өртөг')
for a, v in fa_acc.items():
    ln(a, -v, 'ҮХ хуримтлагдсан элэгдэл')
for a, v in P.OPENING_IS.items():
    ln(a, v, 'YTD 2025-01..06')
plug = -sum((r[4] or 0) - (r[5] or 0) for r in rows)
ln('44000001', plug, 'Хуримтлагдсан ашиг (өмнөх жилүүд, тэнцүүлэлт)')
wb = Workbook(); ws = wb.active; ws.title = 'Журнал'
ws.append(['Баримт №', 'Огноо', 'Журналын нэр', 'Данс', 'Дебет', 'Кредит', 'Мөрийн тайлбар'])
for r in rows:
    ws.append(r)
# 2-р баримт: зориуд алдаатай (тэнцэхгүй + байхгүй данс) — импортын алдааны зам
ws.append(['JE-BAD', CUT, 'Алдаатай тест', '99999999', 1000, '', 'байхгүй данс'])
ws.append(['JE-BAD', CUT, 'Алдаатай тест', '10000001', '', 900, 'тэнцэхгүй'])
xp = os.path.join(ROOT, 'orgs', 'B', 'opening_B.xlsx'); wb.save(xp)
print('xlsx rows', len(rows), 'plug', plug)
opening['44000098'] = 0.0
L.post(CUT, [(a, v if v > 0 else 0, -v if v < 0 else 0) for a, v in opening.items() if abs(v) >= 0.005], 'OPENING')
o.save()
r = subprocess.run(['node', os.path.join(ROOT, 'web', 'excel_import_jv.mjs'), xp, CUT[:7]], capture_output=True, text=True, env=dict(os.environ, SIM_ORG='B'))
print(r.stdout[-3000:], r.stderr[-1500:])
ok, t = o.call('list_journal_vouchers', {'status': 'draft', 'limit': 20}, 'open')
for no in o.jvnos(t):
    s['drafts'].append(dict(kind='jv', no=no, month=CUT[:7], what='opening-excel'))
o.save()
o.call('get_onboarding_guide', {'section': 'status'}, 'open')
