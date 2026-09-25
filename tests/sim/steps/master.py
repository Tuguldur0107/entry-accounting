"""1-р шат: master data — профайлаас MCP-ээр. python3 steps/master.py B"""
import sys, os, json, importlib, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'common')); sys.path.insert(0, os.path.join(ROOT, 'profiles'))
from mcp import Client
from issues import add as issue
org = sys.argv[1]
P = importlib.import_module(org)
c = Client(org)
res = []


def call(n, a, tag='master'):
    ok, t = c.call(n, a, tag=tag)
    print(f'== {n} ok={ok}\n{t[:1500]}\n', flush=True)
    res.append((n, ok, t[:3000]))
    return ok, t


call('get_company_settings', {})
call('update_company_settings', dict(name=P.NAME, registerNo=P.REG, vatPayerNo=P.VAT_NO, address='Улаанбаатар, Сүхбаатар дүүрэг, 1-р хороо', phone='77001122', email=os.environ.get('SIM_EMAIL') or json.load(open(f'{ROOT}/orgs/{org}/creds.json'))['email']))
call('create_gl_accounts_batch', {'items': [{'number': a, 'name': b} for a, b in P.ACCOUNTS]})
for code, name in P.WAREHOUSES:
    call('create_warehouse', {'code': code, 'name': name})
curs = sorted({x.get('currency', 'MNT') for x in P.CASH} | {s.get('currency', 'MNT') for s in P.SUPPLIERS} | {x.get('currency', 'MNT') for x in P.CUSTOMERS})
curs = [x for x in curs if x != 'MNT']
if curs:
    call('sync_exchange_rates', {'from': P.CUTOFF[:8] + '01', 'to': __import__('datetime').date.today().isoformat(), 'currencies': curs})
    for cu in curs:
        call('get_exchange_rate', {'currency': cu, 'date': P.CUTOFF})
for ca in P.CASH:
    a = dict(ca)
    if a.get('openingBalance'):
        a['openingDate'] = P.CUTOFF
    call('create_cash_account', a)
cps = P.CUSTOMERS + P.SUPPLIERS
for i in range(0, len(cps), 100):
    call('create_counterparties_batch', {'items': cps[i:i + 100]})
items = [{k: v for k, v in it.items() if k not in ('cost', 'price', 'category', 'service')} for it in P.ITEMS]
for i in range(0, len(items), 100):
    if items[i:i + 100]:
        call('create_inventory_items_batch', {'items': items[i:i + 100]})
for i in range(0, len(P.EMPLOYEES), 100):
    call('create_employees_batch', {'items': P.EMPLOYEES[i:i + 100]})
fa = []
for f in (P.fa_opening() if hasattr(P, 'fa_opening') else []):
    d = dict(name=f['name'], acquisitionDate=f['acq'], cost=f['cost'], usefulLifeMonths=f['life'] or 0, salvageValue=f['salvage'], custodian='Ганбат', depreciationStartMonth=f['start'],
             openingAccumulatedDepreciation=f['accum'], openingAsOf=P.CUTOFF)
    if f.get('intangible'):
        d.update(assetAccountNumber='21000001', accumDepAccountNumber='21000099', depExpenseAccountNumber='70000001')
    elif f.get('rou'):
        d.update(assetAccountNumber='20000001', accumDepAccountNumber='20000002', depExpenseAccountNumber='70000002')
    else:
        d.update(assetAccountNumber='20000001', accumDepAccountNumber='20000002', depExpenseAccountNumber='70000001')
    fa.append(d)
if fa:
    call('create_fixed_assets_batch', {'items': fa})
if hasattr(P, 'FA') and org == 'D':
    for name, acq, cost, life, salv in P.FA:
        call('create_fixed_asset', dict(name=name, acquisitionDate=acq, cost=cost, usefulLifeMonths=life, custodian='Номин', depreciationStartMonth=acq[:7]))
if P.WAREHOUSES:
    call('save_cost_component', {'code': 'CUSTOMS', 'name': 'Гаалийн татвар', 'classification': 'import'})
    call('save_cost_component', {'code': 'FREIGHT', 'name': 'Тээвэр, карго', 'classification': 'import'})
    call('save_cost_component', {'code': 'BROKER', 'name': 'Гаалийн зуучлал', 'classification': 'import'})
    call('save_issue_type', {'code': 'SALE', 'name': 'Борлуулалт', 'debitAccountSource': 'item_cogs'})
    call('save_issue_type', {'code': 'WRITEOFF', 'name': 'Акт, гэмтэл', 'debitAccountSource': 'fixed', 'debitAccount': '87100004', 'destinationClass': 'Бараа материалын хорогдол'})
    call('save_issue_type', {'code': 'INTERNAL', 'name': 'Дотоод хэрэгцээ', 'debitAccountSource': 'fixed', 'debitAccount': '73100007', 'destinationClass': 'Үйл ажиллагааны зардал'})
    call('save_issue_type', {'code': 'SAMPLE', 'name': 'Үнэгүй дээж, маркетинг', 'debitAccountSource': 'fixed', 'debitAccount': '73100005', 'destinationClass': 'Үйл ажиллагааны зардал'})
    call('get_costing_settings', {})
call('get_onboarding_guide', {'section': 'status'})
call('list_fixed_assets', {})
json.dump(res, open(f'{ROOT}/orgs/{org}/master_res.json', 'w'), ensure_ascii=False, indent=1)
