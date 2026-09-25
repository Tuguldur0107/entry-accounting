"""C сарын бүтэн цикл. python3 steps/run_month_C.py 2025-01 [--noclose] [--from=STEP]"""
import sys, os, random, subprocess, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import *
import closing as C
import month_C as MC
import specials_C as SC
m = sys.argv[1]; noclose = '--noclose' in sys.argv
frm = next((a.split('=')[1] for a in sys.argv if a.startswith('--from=')), None)
o = MC.o; s = o.s; L = o.L
R = random.Random(int(m.replace('-', '')) * 11)
FXACC = [('Голомт USD', '11000003', 'USD'), ('Голомт CNY', '11000004', 'CNY'), ('ХХБ EUR', '11000005', 'EUR')]


def web_po_approve():
    for po in s['po']:
        if po['status'] == 'draft':
            out = C.node('C', 'po_action.mjs', po['no'], m, 'approve', f'po-approve-{po["no"]}')
            if 'батлагдлаа' in out:
                po['status'] = 'open'
    o.save()


def web_gr_confirm():
    for po in s['po']:
        for g in po['gr']:
            if not g['confirmed']:
                out = C.node('C', 'gr_confirm.mjs', g['no'], m, f'gr-{g["no"]}')
                if not ('капиталж' in out or 'батлагд' in out):  # аль хэдийн батлагдсан байж болно — жагсаалтаас шалгах
                    ok, lst = o.call('list_inventory_movements', {'from': g['date'], 'to': g['date'], 'movementType': 'receipt', 'limit': 200}, f'{m}:grchk')
                    if re.search(g['no'] + r'\S* [^\n]*confirmed', lst):
                        out = 'батлагдсан'
                if 'капиталж' in out or 'батлагд' in out:
                    g['confirmed'] = True
                    mm = re.search(r'ханшаар \(([\d,\.]+)\)', out)
                    if mm and abs(float(mm.group(1).replace(',', '')) - g['rate']) > 0.01:
                        o.note(m, f'GR {g["no"]} вэб ханш {mm.group(1)} vs oracle {g["rate"]}')
        for g in po['gr']:
            if g['confirmed'] and not g.get('oracle'):
                MC.po_oracle_receipt(po, g, m)
    o.save()


def po_closes():
    """Бүрэн хүлээн авсан + нэхэмжилсэн + хуваарилсан захиалгуудыг хаана (MCP ≤10M, том бол вэб)."""
    for po in s['po']:
        if po['status'] != 'open':
            continue
        full = all(l.get('rcv', 0) >= l['quantity'] and l.get('inv', 0) >= l['quantity'] for l in po['lines']) and all(g['confirmed'] for g in po['gr']) and all(c['allocated'] for c in po['cost'])
        if not full:
            continue
        ok = MC.po_close(po, m)
        if po['status'] == 'closing-web':
            out = C.node('C', 'po_action.mjs', po['no'], m, 'close', f'po-close-{po["no"]}')
            po['status'] = 'closed' if ('хаагд' in out.lower()) else 'closing-web'
    o.save()


def costing_step():
    ok, t = o.call('run_monthly_costing', {'period': m}, f'{m}:costing')
    if 'блок' in t.lower():
        o.note(m, 'costing blocked: ' + t[:300])
        e = s.get('ent043')
        if e and e.get('cost'):
            import json as _j
            _j.dump({f"{e['item']}|{e['qty']}": e['cost']}, open(os.path.join(ROOT, 'orgs', 'C', 'costmap.json'), 'w'))
            C.node('C', 'costing_fill.mjs', m, f'costfill-{m}')
            ok, t = o.call('run_monthly_costing', {'period': m}, f'{m}:costing')
            if 'блок' not in t.lower():
                s.pop('ent043', None)
    ok2, t2 = o.call('post_cost_entries', {'month': m}, f'{m}:costing')
    if not ok2 or 'AMOUNT_LIMIT' in t2 or 'хязгаар' in t2:
        C.node('C', 'bulk_post.mjs', '/costing/entries', m, f'cost-{m}')
    ok3, t3 = o.call('list_cost_entries', {'month': m, 'status': 'draft', 'limit': 5}, f'{m}:costing')
    if 'draft' in t3:
        o.note(m, 'өртгийн ноорог үлдсэн: ' + t3[:200])


STEPS = ['early', 'imports', 'approve', 'cycle', 'grweb', 'cycle2', 'sales', 'movements', 'purchases', 'collections', 'misc', 'late', 'arap_web', 'moves', 'cash', 'cycle3', 'payroll', 'drafts', 'paypay', 'fa', 'preclose', 'grweb2', 'arap_web2', 'moves2', 'costing', 'poclose', 'fx', 'vat', 'drafts2', 'cash2', 'oracle_close', 'check', 'compare', 'close']
start = STEPS.index(frm) if frm else 0
print(f'######## C {m} from {STEPS[start]}', flush=True)
for st in STEPS[start:]:
    print(f'---- {st}', flush=True)
    if st == 'early': MC.snapshot_bom(m); SC.early(o, m, R)
    elif st == 'imports': MC.imports(m, R)
    elif st == 'approve': web_po_approve()
    elif st in ('cycle', 'cycle2', 'cycle3'): MC.imports_cycle(m, R)
    elif st in ('grweb', 'grweb2'): web_gr_confirm()
    elif st in ('sales', 'movements', 'purchases', 'collections', 'misc'): getattr(MC, st)(m, R)
    elif st == 'late': SC.late(o, m, R)
    elif st == 'preclose': SC.preclose(o, m, R)
    elif st in ('arap_web', 'arap_web2'):
        C.node('C', 'post_arap_all.mjs', 'receivables', m, f'ar-{m}'); C.node('C', 'post_arap_all.mjs', 'payables', m, f'ap-{m}')
        for po in s['po']:
            for i in po['inv']:
                i['posted'] = True
    elif st in ('moves', 'moves2'): MC.confirm_moves(m)
    elif st in ('cash', 'cash2'): C.node('C', 'bulk_post.mjs', '/cash/transactions', m, f'{st}-{m}')
    elif st == 'payroll': C.payroll(o, m)
    elif st in ('drafts', 'drafts2'): C.post_drafts_web(o, m)
    elif st == 'paypay': C.pay_payroll(o, m)
    elif st == 'fa': C.fa_dep(o, m)
    elif st in ('costing', 'costing2'): costing_step()
    elif st in ('poclose', 'poclose2'): po_closes()
    elif st == 'fx':
        C.fx(o, m, [a[0] for a in FXACC])
        for name, acc, cur in FXACC:
            L.fx_reval(m, acc, o.rate(cur, eom(m)))
    elif st == 'vat':
        C.ensure_arap_posted(o, m); C.vat_manual(o, m)
    elif st == 'oracle_close':
        L.inv_rebuild(); o.note(m, f'oracle үнэлгээ {L.inv_value()}')
        s['stock'] = {f'{k[0]}|{k[1]}': round(v['qty'], 3) for k, v in L.inv.items() if v['qty'] > 0.0005}  # oracle = системтэй тулгагдсан
    elif st == 'check': C.check(o, m)
    elif st == 'compare': subprocess.run([sys.executable, os.path.join(ROOT, 'steps', 'compare.py'), 'C', m])
    elif st == 'close':
        if not noclose:
            C.close(o, m)
    o.save()
print(f'######## C {m} DONE', flush=True)
