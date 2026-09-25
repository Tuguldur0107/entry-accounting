"""C · POS фаз (бодит цагийн — өнөөдрийн сард): 2 дэлгүүр × ээлж, холимог төлбөр, буцаалт, зээл, хөнгөлөлт, картын клиринг, ээлжийн зөрүү.
python3 steps/pos_C.py [--nocost]  → oracle 2026-09-д бичнэ, дараа нь compare."""
import sys, os, re, random, datetime, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import *
from issues import add as issue
import closing as C
o = Org('C'); P = o.P; L = o.L; s = o.s
R = random.Random(2609)
TODAY = datetime.date.today().isoformat(); m = TODAY[:7]
STORES = [('WH-02', 'Касс дэлгүүр №1', 'CASH', '10000001'), ('WH-03', 'Касс дэлгүүр №2', 'CASH2', '10000001')]
ITEM = {i['code']: i for i in P.ITEMS}
CLEAR = '12000005'; REV = '51100005'; VATACC = '31410000'; AR = '13110000'


def store_stock(wh):
    return {k[0]: v['qty'] for k, v in L.inv.items() if k[1] == wh and v['qty'] >= 1 and k[0] in ITEM and not ITEM[k[0]].get('service')}


def rec_sale(lines, pays, wh, cash_gl, ref, customer=None, credit=False):
    """oracle: Dr касс/клиринг/авлага / Cr орлого (net) + НӨАТ; бараа зарлага."""
    gross = r2(sum(q * p for _, q, p in lines)); net = r2(gross / 1.1); vat = r2(gross - net)
    ent = [(REV, 0, net), (VATACC, 0, vat)]
    for meth, amt in pays:
        acc = {'CASH': cash_gl, 'CASH2': cash_gl, 'CARD': CLEAR, 'QPAY': '11000001', 'CREDIT': AR}[meth]
        ent.append((acc, amt, 0))
    L.post(TODAY, ent, ref)
    for code, q, _ in lines:
        L.inv_issue(m, code, wh, q, ref)
    s.setdefault('pos_sales', []).append(dict(ref=ref, gross=gross, wh=wh, lines=lines, pays=pays))
    return gross


def run_store(wh, cash, cashmeth, cash_gl, k):
    ok, t = o.call('open_pos_shift', dict(cashAccount=cash, warehouseCode=wh, openingFloat=300000, note=f'Сим ээлж {k}'), 'pos:open')
    sh = (re.findall(r'SH-\d{4}-\d{3}', t) or [None])[0]
    st = store_stock(wh); codes = list(st)
    if len(codes) < 3:
        o.note(m, f'{wh} бараа хүрэлцэхгүй {len(codes)}'); return
    cash_in = 0.0; sales = []
    for i in range(8):
        picks = R.sample(codes, min(len(codes), R.randint(1, 3)))
        lines = []
        for c in picks:
            q = min(int(st[c]), R.randint(1, 2))
            if q >= 1:
                lines.append((c, q, ITEM[c]['salesPrice'])); st[c] -= q
        if not lines:
            continue
        gross = r2(sum(q * p for _, q, p in lines))
        kind = i % 4
        args = dict(lines=[dict(itemCode=c, quantity=q) for c, q, _ in lines], warehouseCode=wh, skipEbarimt=True)
        if kind == 0:   # бэлэн
            pays = [(cashmeth, gross)]; args['payments'] = [dict(method=cashmeth, amount=gross)]
        elif kind == 1:  # карт
            pays = [('CARD', gross)]; args['payments'] = [dict(method='CARD', amount=gross, reference=f'SLIP{R.randint(100000, 999999)}')]
        elif kind == 2:  # холимог бэлэн + QPay
            a = r2(min(gross, 20000 * R.randint(1, 3))); pays = [(cashmeth, a), ('QPAY', r2(gross - a))]
            args['payments'] = [dict(method=cashmeth, amount=a), dict(method='QPAY', amount=r2(gross - a), reference='QP' + str(R.randint(10 ** 7, 10 ** 8)))]
        else:            # зээлээр бүртгэлтэй харилцагчид
            pays = [('CREDIT', gross)]; args['payments'] = [dict(method='CREDIT', amount=gross)]; args['customer'] = 'Батсайхан (хувь хүн)'
        ok, t = o.call('create_pos_sale', args, f'pos:sale:{wh}')
        no = (re.findall(r'POS-\d{4}-\d{4}', t) or [None])[0]
        if not ok or not no:
            o.note(m, f'POS sale fail {wh}: {t[:150]}')
            for c, q, _ in lines: st[c] += q
            continue
        rec_sale(lines, pays, wh, cash_gl, no)
        cash_in += sum(a for mth, a in pays if mth == cashmeth)
        sales.append((no, lines, pays))
    # хөнгөлөлт: менежерийн зөвшөөрөлгүй 15% → [APPROVAL_REQUIRED] хүлээгдэнэ; дараа нь managerApproval=true
    if codes:
        c = codes[0]; q = 1 if st[c] >= 1 else 0
        if q:
            ok, t = o.call('create_pos_sale', dict(lines=[dict(itemCode=c, quantity=1, discountPercent=15)], payments=[dict(method=cashmeth, amount=r2(ITEM[c]['salesPrice'] * 0.85))], warehouseCode=wh, skipEbarimt=True), f'pos:disc:{wh}')
            if ok and 'APPROVAL' not in t:
                issue('S3', 'POS', 'MCP', 'Хяналт', 'Гар хөнгөлөлтийн дээд хувь (10%) давсан борлуулалт менежерийн зөвшөөрөлгүй батлагдана', t[:200], '[APPROVAL_REQUIRED]', t[:120], '', 'orgs/C/mcplog.jsonl pos:disc', 'C')
                no = (re.findall(r'POS-\d{4}-\d{4}', t) or ['?'])[0]; g = r2(ITEM[c]['salesPrice'] * 0.85); rec_sale([(c, 1, g)], [(cashmeth, g)], wh, cash_gl, no); cash_in += g; st[c] -= 1
            else:
                ok, t = o.call('create_pos_sale', dict(lines=[dict(itemCode=c, quantity=1, discountPercent=15)], payments=[dict(method=cashmeth, amount=r2(ITEM[c]['salesPrice'] * 0.85))], warehouseCode=wh, skipEbarimt=True, managerApproval=True), f'pos:disc:{wh}')
                no = (re.findall(r'POS-\d{4}-\d{4}', t) or [None])[0]
                if no:
                    g = r2(ITEM[c]['salesPrice'] * 0.85); rec_sale([(c, 1, g)], [(cashmeth, g)], wh, cash_gl, no); cash_in += g; st[c] -= 1
    # буцаалт: эхний бэлэн борлуулалтын 1 мөр
    cash_sale = next((x for x in sales if x[2][0][0] == cashmeth and len(x[2]) == 1), None)
    if cash_sale:
        no, lines, pays = cash_sale; c, q, p = lines[0]
        ok, t = o.call('return_pos_sale', dict(sale=no, lines=[dict(itemCode=c, quantity=1)], reason='Гэмтэлтэй бараа'), f'pos:return:{wh}')
        if ok:
            g = r2(p); net = r2(g / 1.1)
            L.post(TODAY, [(REV, net, 0), (VATACC, r2(g - net), 0), (cash_gl, 0, g)], f'RET:{no}')
            L.inv_moves[m].append(dict(t='out', item=c, wh=wh, qty=-1, ref=f'RET:{no}', acc='61100000'))  # буцаалт = сөрөг зарлага (дунджаар)
            cash_in -= g
            s.setdefault('pos_returns', []).append(dict(no=no, item=c, gross=g))
    # ээлж хаах: 1-р дэлгүүр яг, 2-р дэлгүүр 5,000 илүү
    over = 0 if k == 0 else 5000
    counted = r2(300000 + cash_in + over)
    ok, t = o.call('close_pos_shift', dict(shift=sh, countedCash=counted, note='сим'), f'pos:close:{wh}')
    if over:
        L.post(TODAY, [(cash_gl, over, 0), ('51800002', 0, over)], f'SHIFT:{sh}')
    o.note(m, f'{wh} shift {sh}: sales {len(sales)}, cash {cash_in}, counted {counted} → {t[:120]}')


for k, (wh, cash, meth, gl) in enumerate(STORES):
    run_store(wh, cash, meth, gl, k)
    o.save()
# картын клиринг → банк (шимтгэл 1%)
card = r2(sum(a for x in s.get('pos_sales', []) for mth, a in x['pays'] if mth == 'CARD'))
if card:
    fee = r2(card * 0.01)
    ok, t = o.call('create_cash_transactions_batch', {'items': [
        dict(documentType='transfer', date=TODAY, cashAccount='Карт клиринг (Голомт)', toCashAccount='Хаан банк MNT', amount=r2(card - fee), description='Картын төлбөр банкинд орсон', externalRef=f'sim:{m}:CARDSETTLE'),
        dict(documentType='payment', date=TODAY, cashAccount='Карт клиринг (Голомт)', counterAccount='73100004', amount=fee, description='Картын шимтгэл 1%', externalRef=f'sim:{m}:CARDFEE')]}, 'pos:card')
    L.post(TODAY, [('11000001', r2(card - fee), 0), (CLEAR, 0, r2(card - fee))], 'CARDSETTLE')
    L.post(TODAY, [('73100004', fee, 0), (CLEAR, 0, fee)], 'CARDFEE')
o.save()
if '--nocost' not in sys.argv:
    ok, t = o.call('run_monthly_costing', {'period': m}, 'pos:costing')
    ok2, t2 = o.call('post_cost_entries', {'month': m}, 'pos:costing')
    if not ok2:
        C.node('C', 'bulk_post.mjs', '/costing/entries', m, f'cost-{m}')
    ok, t = o.call('get_pos_sales_report', {'from': f'{m}-01', 'to': eom(m), 'groupBy': 'item'}, 'pos:report')
    L.inv_rebuild(); o.save()
    subprocess.run([sys.executable, os.path.join(ROOT, 'steps', 'compare.py'), 'C', m])
