"""C · SIM Импорт — сарын үйл ажиллагаа (импорт PO, бөөний борлуулалт, экспорт, шилжүүлэг/тооллого/акт, дотоод худалдан авалт, төлбөр, валют, зээл).
python3 steps/month_C.py 2025-01 [steps]   (POS нь бодит цагийн модуль тул тусдаа фазаар — pos_C.py)"""
import sys, os, random, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
from engine import *
o = Org('C'); P = o.P; L = o.L; s = o.s
ORG_CUST = [c_['name'] for c_ in P.CUSTOMERS if c_['entityKind'] == 'organization' and 'Экспорт' not in c_['name']]
BANK = {'Хаан банк MNT': '11000001', 'Голомт USD': '11000003', 'Голомт CNY': '11000004', 'ХХБ EUR': '11000005', 'Касс MNT': '10000001'}
FCBANK = {'USD': 'Голомт USD', 'CNY': 'Голомт CNY', 'EUR': 'ХХБ EUR'}
GOODS = [i for i in P.ITEMS if not i.get('service') and i['code'] != 'IMP-EXP']
BYCAT = {}
for i in GOODS:
    BYCAT.setdefault(i['category'], []).append(i)
SUP_CAT = {'Guangzhou Home Appliance Co': ('USD', 'Цахилгаан хэрэгсэл'), 'Shenzhen Tools Ltd': ('USD', 'Барилгын материал'), 'Yiwu Household Trading': ('CNY', 'Гэр ахуй'),
           'Hangzhou Auto Parts': ('CNY', 'Авто сэлбэг'), 'Berlin Kinder GmbH': ('EUR', 'Хүүхдийн бараа')}
LIMIT = 10_000_000
s.setdefault('po', []); s.setdefault('fx_pay_markup', 1.004)


def stock(code, wh):
    return s['stock'].get(f'{code}|{wh}', 0)


def avail(code, wh, m):
    """Сарын дотор аюулгүй зарлагадах тоо: одоогийн үлдэгдэл ба сарын эхний үлдэгдэл (энэ сард орсон орлого огноогоор хожуу байж болно) хоёрын бага."""
    bom = s.get('stock_bom', {}).get(m, {})
    return min(stock(code, wh), bom.get(f'{code}|{wh}', 0)) if bom else stock(code, wh)


def snapshot_bom(m):
    s.setdefault('stock_bom', {})[m] = dict(s['stock'])
    for k in [k for k in s['stock_bom'] if k < add_months(m, -1)]:
        s['stock_bom'].pop(k)


def stock_add(code, wh, q):
    s['stock'][f'{code}|{wh}'] = round(stock(code, wh) + q, 3)
    if q < 0:
        for bom in s.get('stock_bom', {}).values():
            if f'{code}|{wh}' in bom:
                bom[f'{code}|{wh}'] = round(bom[f'{code}|{wh}'] + q, 3)


def fc_price(item, cur, R):
    """Импортын нэгж үнэ валютаар: MNT лавлах өртгийн ~78% (гааль+тээвэр дараа нэмэгдэнэ) / ханш, ±4%."""
    ref = {'USD': 3450.0, 'CNY': 470.0, 'EUR': 3600.0}[cur]
    p = item['cost'] * 0.78 * R.uniform(0.96, 1.04) / ref
    return round(p, 2) if cur != 'CNY' else round(p, 1)


# ─────────────────────────── ИМПОРТ (PO → GR → нэхэмжлэх → гааль/тээвэр → хуваарилалт → хаалт) ───────────────────────────
def imports(m, R):
    """Сард 2-3 захиалга: USD (том), CNY (том, хэсэгчилсэн хүлээн авалттай), улирал бүр EUR; 1 жижиг (<10M) MCP-only."""
    plan = [('Guangzhou Home Appliance Co', 6, (18, 40), 'full'), ('Yiwu Household Trading' if m[-2:] in ('01', '03', '05', '07', '09', '11') else 'Hangzhou Auto Parts', 5, (40, 120), 'partial'),
            ('Shenzhen Tools Ltd', 3, (20, 40), 'small')]
    if m[-2:] in ('02', '05', '08', '11'):
        plan.append(('Berlin Kinder GmbH', 4, (10, 25), 'full'))
    for k, (sup, nl, qr, mode) in enumerate(plan):
        cur, cat = SUP_CAT[sup]
        items = R.sample(BYCAT[cat], nl)
        lines = []
        for it in items:
            q = R.randint(*qr) if it['cost'] < 150000 else R.randint(6, 16)
            pr = fc_price(it, cur, R)
            if mode == 'small':
                q = max(5, q // 3)
            lines.append(dict(itemCode=it['code'], quantity=q, unitPrice=pr))
        d0 = day(m, R.randint(1, 8)); rate0 = o.rate(cur, d0)
        tot_fc = r2(sum(l['quantity'] * l['unitPrice'] for l in lines))
        ok, t = o.call('create_purchase_order', dict(supplier=sup, date=d0, expectedDate=day(m, min(28, R.randint(15, 27))), currency=cur, exchangeRate=rate0, warehouseCode='WH-01',
                                                     description=f'Импорт {cat} — {m}', externalRef=f'sim:{m}:PO:{k}', lines=lines), f'{m}:po')
        no = (re.findall(r'PO-\d{4}-\d{3}', t) or [None])[0]
        if not no:
            o.note(m, f'PO {sup} үүсээгүй: {t[:120]}'); continue
        big = tot_fc * rate0 > LIMIT
        if 'ноорог' in t:
            if big:
                s['po'].append(dict(no=no, sup=sup, cur=cur, m=m, mode=mode, lines=lines, status='draft', tot_fc=tot_fc, gr=[], inv=[], cost=[]))
                continue  # вэбээр батлагдана (po_action approve)
            o.call('approve_purchase_order', {'purchaseOrderId': no, 'exchangeRate': rate0}, f'{m}:po')
        s['po'].append(dict(no=no, sup=sup, cur=cur, m=m, mode=mode, lines=lines, status='open', tot_fc=tot_fc, gr=[], inv=[], cost=[]))
    o.save()


def po_receive(po, m, R, frac=1.0, date=None):
    """Хүлээн авалт (бүтэн/хэсэгчилсэн): GR ноорог → confirm (≤10M MCP; том бол вэб gr_confirm)."""
    d = date or day(m, R.randint(12, 26))
    rate = o.rate(po['cur'], d)
    rl = []
    for l in po['lines']:
        rem = l['quantity'] - l.get('rcv', 0)
        if rem <= 0:
            continue
        q = rem if frac >= 1 else max(1, int(rem * frac))
        rl.append(dict(itemCode=l['itemCode'], quantity=q)); l['_q'] = q
    if not rl:
        return None
    ok, t = o.call('create_goods_receipt', dict(purchaseOrderId=po['no'], date=d, description=f'Хүлээн авалт {po["no"]}', lines=rl), f'{m}:gr')
    gr = (re.findall(r'GR-\d{4}-\d{3}', t) or [None])[0]
    if not gr:
        o.note(m, f'GR {po["no"]} үүсээгүй: {t[:150]}'); return None
    mnt = r2(sum(l['_q'] * l['unitPrice'] for l in po['lines'] if l.get('_q')) * rate)
    rec = dict(no=gr, date=d, rate=rate, mnt=mnt, lines=[(l['itemCode'], l['_q'], l['unitPrice']) for l in po['lines'] if l.get('_q')], confirmed=False)
    if mnt <= LIMIT:
        ok, t = o.call('confirm_goods_receipt', {'receiptId': gr}, f'{m}:gr')
        mm = re.search(r'ханш ([\d,\.]+) → капиталжсан дүн ([\d,\.]+)₮', t)
        if mm:
            sysrate = float(mm.group(1).replace(',', '')); sysmnt = float(mm.group(2).replace(',', ''))
            if abs(sysrate - rate) > 0.01:
                o.note(m, f'GR {gr} ханш систем {sysrate} vs oracle {rate}')
                rec['rate'] = sysrate; rec['mnt'] = sysmnt
        rec['confirmed'] = ok
    po['gr'].append(rec)
    for l in po['lines']:
        if l.get('_q'):
            l['rcv'] = l.get('rcv', 0) + l['_q']; l.pop('_q')
    return rec


def po_oracle_receipt(po, rec, m):
    """Oracle: батлагдсан GR → бараа орлого (нэгж өртөг = үнэ × ханш)."""
    for code, q, pr in rec['lines']:
        L.inv_receipt(m, code, 'WH-01', q, r2(pr * rec['rate']), rec['no']); stock_add(code, 'WH-01', q)
    rec['oracle'] = True


def po_invoice(po, m, R, date=None):
    """Нийлүүлэгчийн нэхэмжлэх — хүлээн авсан боловч нэхэмжлээгүй тоогоор (Dr 31000099 / Cr 31000001), ханш нэхэмжлэхийн өдрийнх."""
    d = date or day(m, R.randint(12, 27))
    rate = o.rate(po['cur'], d)
    il = [dict(itemCode=l['itemCode'], quantity=l.get('rcv', 0) - l.get('inv', 0)) for l in po['lines'] if l.get('rcv', 0) - l.get('inv', 0) > 0]
    if not il:
        return None
    fc = r2(sum(x['quantity'] * next(l['unitPrice'] for l in po['lines'] if l['itemCode'] == x['itemCode']) for x in il))
    ok, t = o.call('create_ap_invoice_from_po', dict(purchaseOrderId=po['no'], date=d, exchangeRate=rate, description=f'{po["sup"]} нэхэмжлэх {po["no"]}', externalRef=f'sim:{m}:POINV:{po["no"]}:{len(po["inv"])}', lines=il), f'{m}:poinv')
    no = (o.docnos(t, 'AP') or [None])[0]
    if not no:
        o.note(m, f'PO нэхэмжлэх {po["no"]} үүсээгүй: {t[:150]}'); return None
    mnt = r2(fc * rate)
    posted = 'батлагдсан' in t or 'GL-д' in t
    if not posted and mnt <= LIMIT:
        ok, t2 = o.call('post_arap_document', {'documentId': no, 'exchangeRate': rate}, f'{m}:poinv'); posted = ok
    L.post(d, [('31000099', mnt, 0), ('31000001', 0, mnt)], f'POINV:{no}')
    s['open_ap'].append(dict(no=no, cp=po['sup'], total=fc, bal=fc, date=d, cur=po['cur'], mnt=mnt, rate=rate, po=po['no']))
    po['inv'].append(dict(no=no, fc=fc, mnt=mnt, rate=rate, date=d, posted=posted))
    for x in il:
        l = next(l for l in po['lines'] if l['itemCode'] == x['itemCode']); l['inv'] = l.get('inv', 0) + x['quantity']
    return no


def po_costs(po, m, R, date=None):
    """Гааль (5% + импортын НӨАТ 10%), карго тээвэр, зуучлал — өөр харилцагчийн нэхэмжлэх (бүрэлдэхүүнтэй мөр → 31000099), дараа нь value суурьтай хуваарилалт."""
    d = date or day(m, R.randint(14, 27))
    d = max([d] + [g['date'] for g in po['gr'] if g['confirmed']])
    base = r2(sum(g['mnt'] for g in po['gr'] if g['confirmed']) - sum(c['base'] for c in po['cost']))
    if base <= 0:
        return
    customs = round(base * 0.05); ivat = round((base + customs) * 0.10)
    freight = round(base * R.uniform(0.04, 0.08) / 1000) * 1000; broker = round(R.uniform(250, 600)) * 1000
    bills = [('Гаалийн ерөнхий газар', 'sim:%s:CUST:%s:%d', [dict(amount=customs, costComponentCode='CUSTOMS', description='Гаалийн татвар 5%'), dict(amount=ivat, account='13620000', description='Импортын НӨАТ 10%')], customs, ivat, 'none'),
             ('Монгол Карго Логистик', 'sim:%s:FRT:%s:%d', [dict(amount=freight, costComponentCode='FREIGHT', description='Карго тээвэр Эрээн—УБ')], freight, round(freight * 0.1), 'exclusive'),
             ('Гаалийн Зуучлагч Мон ХХК', 'sim:%s:BRK:%s:%d', [dict(amount=broker, costComponentCode='BROKER', description='Гаалийн бүрдүүлэлт')], broker, round(broker * 0.1), 'exclusive')]
    for cp, ref, lines, comp, vat, vm in bills:
        ok, t = o.call('create_arap_invoice', dict(documentType='ap_bill', counterparty=cp, date=d, purchaseOrder=po['no'], vatMode=vm, description=f'{cp} — {po["no"]}', externalRef=ref % (m, po['no'], len(po['cost'])), lines=lines), f'{m}:pocost')
        no = (o.docnos(t, 'AP') or [None])[0]
        if not no:
            o.note(m, f'зардлын нэхэмжлэх {cp} {po["no"]}: {t[:150]}'); continue
        tot = comp + vat
        if not ('батлагдсан' in t) and tot <= LIMIT:
            o.call('post_arap_document', {'documentId': no}, f'{m}:pocost')
        L.post(d, [('31000099', comp, 0), ('13620000', vat, 0), ('31000001', 0, tot)], f'POCOST:{no}')
        s['open_ap'].append(dict(no=no, cp=cp, total=tot, bal=tot, date=d, cur='MNT'))
        po['cost'].append(dict(no=no, cp=cp, comp=comp, base=base, date=d, allocated=False))


def po_allocate(po, m):
    """Хуваарилагдаагүй бүрэлдэхүүн мөрүүдийг get_purchase_order-оос уншиж value суурьтай хуваарилна; oracle: landed → орлогын мөрүүд рүү үнийн дүнгээр."""
    ok, t = o.call('get_purchase_order', {'purchaseOrderId': po['no']}, f'{m}:alloc')
    sec = t.split('ХУВААРИЛАГДААГҮЙ НЭМЭЛТ ЗАРДАЛ')[1] if 'ХУВААРИЛАГДААГҮЙ НЭМЭЛТ ЗАРДАЛ' in t else ''
    for apno, comp_name, amt, lid in re.findall(r'(AP-\d{8}-[0-9A-F]{6}) · ([^·]+) · дүн ([\d,\.]+)₮ · хуваарилсан [\d,\.]+₮ · үлдэгдэл [\d,\.]+₮ · мөрийн ID ([0-9a-f]{8})', sec):
        amount = float(amt.replace(',', ''))
        c = next((c for c in po['cost'] if c['no'] == apno and not c['allocated']), None)
        if not c:
            continue
        ok, t2 = o.call('create_cost_allocation', dict(allocationBase='value', sourceLine=lid, date=c['date'], description=f'{comp_name.strip()} хуваарилалт {po["no"]}'), f'{m}:alloc')
        if ok:
            c['allocated'] = True
            # oracle: батлагдсан орлогуудад үнийн дүнгээр
            grs = [g for g in po['gr'] if g['confirmed']]
            tot = sum(g['mnt'] for g in grs)
            for g in grs:
                for code, q, pr in g['lines']:
                    share = r2(c['comp'] * (q * pr * g['rate']) / tot) if tot else 0
                    if share:
                        L.inv_landed(m, code, 'WH-01', share, f'ALLOC:{apno}:{code}')
        else:
            o.note(m, f'хуваарилалт {po["no"]} {apno}: {t2[:150]}')


def po_close(po, m, date=None):
    """PO хаалт: Dr 14000099 (GR+landed) / Cr 31000099 (нэхэмжлэх+зардал), зөрүү → ханшийн олз/гарз. ≤10M MCP, том бол вэб."""
    d = date or eom(m)
    ok, t = o.call('close_purchase_order', {'purchaseOrderId': po['no'], 'closeDate': d}, f'{m}:poclose')
    if ok and 'хаагд' in t.lower():
        po['status'] = 'closed'
    elif 'AMOUNT_LIMIT' in t or 'хязгаар' in t or '10 сая' in t:
        po['status'] = 'closing-web'
    else:
        o.note(m, f'PO хаалт {po["no"]}: {t[:200]}'); return False
    inv_side = r2(sum(g['mnt'] for g in po['gr'] if g['confirmed']) + sum(c['comp'] for c in po['cost']))
    ap_side = r2(sum(i['mnt'] for i in po['inv']) + sum(c['comp'] for c in po['cost']))
    diff = r2(inv_side - ap_side)
    ent = [('14000099', inv_side, 0), ('31000099', 0, ap_side)]
    if diff > 0:
        ent.append(('51800001', 0, diff))
    elif diff < 0:
        ent.append(('87000003', -diff, 0))
    L.post(d, ent, f'POCLOSE:{po["no"]}')
    po['close_date'] = d
    return True


def imports_cycle(m, R):
    """Нээлттэй PO-уудын хүлээн авалт/нэхэмжлэх/зардал/хуваарилалт. mode=partial: энэ сард 60%, дараа сард үлдсэн."""
    for po in s['po']:
        if po['status'] in ('closed', 'closing-web', 'draft', 'hold'):
            continue
        rem = sum(l['quantity'] - l.get('rcv', 0) for l in po['lines'])
        if rem > 0 and po.get('last_rcv_m') != m:  # сард нэг л удаа хүлээн авна
            frac = 0.6 if (po['mode'] == 'partial' and po['m'] == m) else 1.0
            if po_receive(po, m, R, frac):
                po['last_rcv_m'] = m
        for g in po['gr']:
            if g['confirmed'] and not g.get('oracle'):
                po_oracle_receipt(po, g, m)
        if any(l.get('rcv', 0) > l.get('inv', 0) for l in po['lines']):
            po_invoice(po, m, R)
        if po['gr'] and all(g['confirmed'] for g in po['gr']) and sum(c['base'] for c in po['cost']) < sum(g['mnt'] for g in po['gr']) - 1:
            po_costs(po, m, R)
        if any(not c['allocated'] for c in po['cost']):
            po_allocate(po, m)
    o.save()


# ─────────────────────────── БӨӨНИЙ БОРЛУУЛАЛТ + ЭКСПОРТ ───────────────────────────
def sales(m, R):
    items = []
    reserved = {}  # нэг batch-ийн өмнөх нэхэмжлэхүүдэд аль хэдийн зарагдсан тоо (stock_add нь batch-ийн дараа)
    for k in range(R.randint(26, 36)):
        cp = R.choice(ORG_CUST)
        d = day(m, R.randint(2, 27))
        lines = []
        for it in R.sample(GOODS, R.randint(2, 5)):
            av = avail(it['code'], 'WH-01', m) - reserved.get(it['code'], 0) - sum(x['quantity'] for x in lines if x['itemCode'] == it['code'])
            if av < 2:
                continue
            q = min(av, R.randint(4, 24) if it['cost'] < 150000 else R.randint(2, 8))
            lines.append(dict(account='51100000', itemCode=it['code'], quantity=q, warehouseCode='WH-01', unitPrice=it['price'], description=it['name']))
        if not lines:
            continue
        for x in lines:
            reserved[x['itemCode']] = reserved.get(x['itemCode'], 0) + x['quantity']
        if R.random() < 0.3:
            lines.append(dict(account='51100002', amount=60000 * R.randint(1, 4), description='Угсралт, суурилуулалт'))
        items.append(dict(documentType='ar_invoice', counterparty=cp, date=d, vatMode='exclusive', description=f'Бөөний борлуулалт {m}', externalRef=f'sim:{m}:AR:{k:02d}', lines=lines))
    nos = []
    for i in range(0, len(items), 50):
        ok, t = o.call('create_arap_invoices_batch', {'items': items[i:i + 50]}, f'{m}:sales')
        nos += o.docnos(t, 'AR')
    for it, no in zip(items, nos):
        net = r2(sum(l.get('amount') or l['quantity'] * l['unitPrice'] for l in it['lines'])); vat = r2(net * VAT); tot = r2(net + vat)
        s['open_ar'].append(dict(no=no, cp=it['counterparty'], total=tot, bal=tot, date=it['date'], cur='MNT'))
        ent = [('13110000', tot, 0), ('31410000', 0, vat)]
        for l in it['lines']:
            ent.append((l['account'], 0, l.get('amount') or r2(l['quantity'] * l['unitPrice'])))
            if l.get('itemCode'):
                L.inv_issue(m, l['itemCode'], 'WH-01', l['quantity'], no); stock_add(l['itemCode'], 'WH-01', -l['quantity'])
        L.post(it['date'], ent, no)
    if len(nos) != len(items):
        o.note(m, f'sales {len(items)} items, {len(nos)} numbers')
    # экспорт — USD, НӨАТ 0%
    q = R.randint(40, 90)
    if avail('IMP-EXP', 'WH-01', m) >= q:
        d = day(m, R.randint(8, 20)); rate = o.rate('USD', d); price = 42.0
        ok, t = o.call('create_arap_invoice', dict(documentType='ar_invoice', counterparty='Экспорт Хятад ХХК', date=d, currency='USD', exchangeRate=rate, vatMode='none', description=f'Экспорт ноолуур {m} (НӨАТ 0%)', externalRef=f'sim:{m}:EXP',
                                                   lines=[dict(account='51100000', itemCode='IMP-EXP', quantity=q, warehouseCode='WH-01', unitPrice=price, description='Ноолуур экспорт')]), f'{m}:export')
        no = (o.docnos(t, 'AR') or ['?'])[0]
        fc = r2(q * price); mnt = r2(fc * rate)
        s['open_ar'].append(dict(no=no, cp='Экспорт Хятад ХХК', total=fc, bal=fc, date=d, cur='USD', mnt=mnt, rate=rate))
        L.post(d, [('13110000', mnt, 0), ('51100000', 0, mnt)], no)
        L.inv_issue(m, 'IMP-EXP', 'WH-01', q, no); stock_add('IMP-EXP', 'WH-01', -q)
    o.save()


def confirm_moves(m):
    """Батлагдсан нэхэмжлэхээс үүссэн ноорог хөдөлгөөнүүдийг (зарлага/орлого) баталгаажуулна."""
    done = []
    for _ in range(3):
        ok, t = o.call('list_inventory_movements', {'status': 'draft', 'from': f'{m}-01', 'to': eom(m), 'limit': 200}, f'{m}:moves')
        ids = [i for i in re.findall(r'· ID ([0-9a-f]{8})', t) if i not in done]
        if not ids:
            break
        for i in ids:
            ok2, t2 = o.call('confirm_inventory_movement', {'movementId': i}, f'{m}:moves')
            done.append(i)
            if not ok2 and 'хасах' in t2.lower():  # огноогоор үлдэгдэл хүрэхгүй → сарын эцэс рүү шилжүүлж дахин оролдох
                o.call('update_inventory_movement', {'movementId': i, 'date': eom(m)}, f'{m}:moves')
                o.call('confirm_inventory_movement', {'movementId': i}, f'{m}:moves')
    return done


# ─────────────────────────── ШИЛЖҮҮЛЭГ / АКТ / ДОТООД ХЭРЭГЦЭЭ / ТООЛЛОГО ───────────────────────────
def movements(m, R):
    # дэлгүүрүүдийг нөхөх: 6 шилжүүлэг WH-01→WH-02/03, 2 нь транзитаар (WH-01→WH-TR→WH-0x)
    for k in range(6):
        it = R.choice(GOODS); q = min(avail(it['code'], 'WH-01', m), R.randint(3, 10))
        if q < 1:
            continue
        dst = R.choice(['WH-02', 'WH-03']); d = day(m, R.randint(3, 24))
        if k < 2:
            for src, to, dd in [('WH-01', 'WH-TR', d), ('WH-TR', dst, day(m, min(28, int(d[-2:]) + 2)))]:
                ok, t = o.call('create_inventory_movement', dict(movementType='transfer', date=dd, itemCode=it['code'], warehouseCode=src, toWarehouseCode=to, quantity=q, description=f'Шилжүүлэг {src}→{to}'), f'{m}:xfer')
                if ok:
                    L.inv_transfer(m, it['code'], src, to, q, f'XFER:{k}'); stock_add(it['code'], src, -q); stock_add(it['code'], to, q)
        else:
            ok, t = o.call('create_inventory_movement', dict(movementType='transfer', date=d, itemCode=it['code'], warehouseCode='WH-01', toWarehouseCode=dst, quantity=q, description=f'Дэлгүүр нөхөлт {dst}'), f'{m}:xfer')
            if ok:
                L.inv_transfer(m, it['code'], 'WH-01', dst, q, f'XFER:{k}'); stock_add(it['code'], 'WH-01', -q); stock_add(it['code'], dst, q)
    # акт (гэмтэл) 1-2, дотоод хэрэгцээ 1, маркетингийн дээж 1
    for kind, acc, n in [('Акт, гэмтэл', '87100004', R.randint(1, 2)), ('Дотоод хэрэгцээ', '73100007', 1), ('Үнэгүй дээж, маркетинг', '73100005', 1 if m[-2:] in ('03', '06', '09', '12') else 0)]:
        for _ in range(n):
            it = R.choice(GOODS); q = min(avail(it['code'], 'WH-01', m), R.randint(1, 3))
            if q < 1:
                continue
            d = day(m, R.randint(5, 26))
            ok, t = o.call('create_inventory_movement', dict(movementType='issue', date=d, itemCode=it['code'], warehouseCode='WH-01', quantity=q, issueType=kind, description=f'{kind} {it["name"]}'), f'{m}:issue')
            if ok:
                L.inv_issue(m, it['code'], 'WH-01', q, f'{kind}:{it["code"]}', debit_acc=acc); stock_add(it['code'], 'WH-01', -q)
    # улирал бүр дэлгүүр №1 тооллого: 2 зөрүү (−1, +1)
    if m[-2:] in ('03', '06', '09', '12'):
        wh = 'WH-02'; d = eom(m)
        have = [(k.split('|')[0], v) for k, v in s['stock'].items() if k.endswith('|' + wh) and v > 0]
        pick = R.sample(have, min(6, len(have)))
        counts = []
        for i, (code, q) in enumerate(pick):
            delta = -1 if i == 0 else (1 if i == 1 else 0)
            counts.append(dict(itemCode=code, countedQty=q + delta))
            if delta:
                L.inv_moves[m].append(dict(t='adj', item=code, wh=wh, qty=delta, ref=f'COUNT:{code}')); stock_add(code, wh, delta)
        ok, t = o.call('record_inventory_count', dict(date=d, warehouseCode=wh, counts=counts), f'{m}:count')
    o.save()


# ─────────────────────────── ДОТООД ХУДАЛДАН АВАЛТ (АП) ───────────────────────────
def purchases(m, R):
    util = R.randint(1800, 2900) * 1000
    items = [dict(documentType='ap_bill', counterparty='Их Дэлгүүр Түрээс ХХК', date=day(m, 1), vatMode='inclusive', description=f'Дэлгүүр №1 түрээс {m}', externalRef=f'sim:{m}:RENT1', lines=[dict(account='73100002', amount=8800000)]),
             dict(documentType='ap_bill', counterparty='Хан-Уул Түрээс ХХК', date=day(m, 1), vatMode='inclusive', description=f'Дэлгүүр №2 түрээс {m}', externalRef=f'sim:{m}:RENT2', lines=[dict(account='73100002', amount=6600000)]),
             dict(documentType='ap_bill', counterparty='УБЦТС ТӨХК', date=eom(m), vatMode='inclusive', description=f'Цахилгаан {m}', externalRef=f'sim:{m}:UTIL', lines=[dict(account='73100003', amount=util)]),
             dict(documentType='ap_bill', counterparty='Юнивишн ХХК', date=eom(m), vatMode='inclusive', description=f'Интернэт {m}', externalRef=f'sim:{m}:NET', lines=[dict(account='73100008', amount=330000)]),
             dict(documentType='ap_bill', counterparty='Петровис ХХК', date=day(m, 20), vatMode='exclusive', description=f'Шатахуун картын тооцоо {m}', externalRef=f'sim:{m}:FUEL', lines=[dict(account='73100009', amount=R.randint(2200, 3400) * 1000)])]
    if m[-2:] in ('02', '05', '08', '11'):
        items.append(dict(documentType='ap_bill', counterparty='Авто Сервис Плюс', date=day(m, 12), vatMode='exclusive', description=f'Ачааны машины засвар {m}', externalRef=f'sim:{m}:REPAIR', lines=[dict(account='73100010', amount=R.randint(900, 2400) * 1000)]))
    if m[-2:] in ('03', '06', '09', '12'):
        items.append(dict(documentType='ap_bill', counterparty='Юнивишн ХХК', date=day(m, 15), vatMode='exclusive', description=f'ТВ сурталчилгаа {m}', externalRef=f'sim:{m}:ADS', lines=[dict(account='73100005', amount=4500000)]))
    # дотоод нийлүүлэгчээс бараа (АП бараатай мөр → орлогын ноорог хөдөлгөөн)
    picks = R.sample(BYCAT['Гэр ахуй'], 3)
    glines = [dict(itemCode=it['code'], quantity=R.randint(10, 30), warehouseCode='WH-01', unitPrice=round(it['cost'] * 1.05 / 100) * 100, description=it['name']) for it in picks]
    items.append(dict(documentType='ap_bill', counterparty='Дотоод Нийлүүлэгч Мон ХХК', date=day(m, R.randint(6, 18)), vatMode='exclusive', description=f'Дотоод бараа нийлүүлэлт {m}', externalRef=f'sim:{m}:DOM', lines=glines))
    ok, t = o.call('create_arap_invoices_batch', {'items': items}, f'{m}:purchases')
    nos = o.docnos(t, 'AP')
    for it, no in zip(items, nos):
        g = r2(sum(l.get('amount') or l['quantity'] * l['unitPrice'] for l in it['lines']))
        if it['vatMode'] == 'exclusive':
            net, vat = g, r2(g * VAT)
        elif it['vatMode'] == 'inclusive':
            vat = r2(g * 10 / 110); net = r2(g - vat)
        else:
            net, vat = g, 0
        tot = r2(net + vat)
        s['open_ap'].append(dict(no=no, cp=it['counterparty'], total=tot, bal=tot, date=it['date'], cur='MNT'))
        if it['lines'][0].get('itemCode'):
            ent = [('31000001', 0, tot), ('13620000', vat, 0)]
            for l in it['lines']:
                uc = l['unitPrice'] if it['vatMode'] != 'inclusive' else r2(l['unitPrice'] / 1.1)
                L.inv_receipt(m, l['itemCode'], 'WH-01', l['quantity'], uc, no); stock_add(l['itemCode'], 'WH-01', l['quantity'])
                ent.append(('14000099', r2(l['quantity'] * uc), 0))
            L.post(it['date'], ent, no)
        else:
            L.post(it['date'], [('31000001', 0, tot), (it['lines'][0]['account'], net, 0)] + ([('13620000', vat, 0)] if vat else []), no)
    if len(nos) != len(items):
        o.note(m, f'purchases {len(items)} items, {len(nos)} numbers')
    o.save()


# ─────────────────────────── ТӨЛБӨР ТООЦОО (MNT + валют) ───────────────────────────
def collections(m, R):
    items = []; cutoff = f'{m}-01'
    for doc in [d for d in s['open_ar'] if d['date'] < cutoff and d['bal'] > 0]:
        r = R.random()
        if r < 0.12:
            continue
        amt = doc['bal'] if r > 0.3 else r2(doc['bal'] / 2)
        dt = day(m, R.randint(3, 28))
        if doc.get('cur', 'MNT') == 'USD':
            rate = o.rate('USD', dt); mnt = r2(amt * rate); book = r2(amt * doc['rate']) if doc.get('rate') else r2(doc['mnt'] * amt / doc['total'])
            items.append(dict(documentType='receipt', date=dt, cashAccount='Голомт USD', counterAccount='13110000', amount=amt, exchangeRate=rate, counterparty=doc['cp'], description=f'Экспортын төлбөр {doc["no"]}',
                              externalRef=f'sim:{m}:RC:{doc["no"]}', applyTo=[dict(documentId=doc['no'], amount=amt)], cashFlowCode='1101'))
            ent = [('11000003', mnt, 0), ('13110000', 0, book)]
            if mnt > book:
                ent.append(('51800001', 0, r2(mnt - book)))
            elif mnt < book:
                ent.append(('87000003', r2(book - mnt), 0))
            L.post(dt, ent, doc['no']); L.fc_move('11000003', amt, mnt)
        else:
            items.append(dict(documentType='receipt', date=dt, cashAccount='Хаан банк MNT', counterAccount='13110000', amount=amt, counterparty=doc['cp'], description=f'Төлбөр {doc["no"]}',
                              externalRef=f'sim:{m}:RC:{doc["no"]}', applyTo=[dict(documentId=doc['no'], amount=amt)], cashFlowCode='1101'))
            L.post(dt, [('11000001', amt, 0), ('13110000', 0, amt)], doc['no'])
        doc['bal'] = r2(doc['bal'] - amt)
    for doc in [d for d in s['open_ap'] if d['date'] < cutoff and d['bal'] > 0 and d.get('cur', 'MNT') == 'MNT']:
        if R.random() < 0.1:
            continue
        dt = day(m, R.randint(5, 25)); amt = doc['bal']
        items.append(dict(documentType='payment', date=dt, cashAccount='Хаан банк MNT', counterAccount='31000001', amount=amt, counterparty=doc['cp'], description=f'Төлбөр {doc["no"]}',
                          externalRef=f'sim:{m}:PY:{doc["no"]}', applyTo=[dict(documentId=doc['no'], amount=amt)], cashFlowCode='1102'))
        L.post(dt, [('31000001', amt, 0), ('11000001', 0, amt)], doc['no']); doc['bal'] = 0
    for i in range(0, len(items), 60):
        o.call('create_cash_transactions_batch', {'items': items[i:i + 60]}, f'{m}:collections')
    # валютын өглөг — pay_arap_document, арилжааны ханш = албан × 1.004; дутвал валют худалдан авна
    for doc in [d for d in s['open_ap'] if d['date'] < cutoff and d['bal'] > 0 and d.get('cur', 'MNT') != 'MNT']:
        if R.random() < 0.15:
            continue
        cur = doc['cur']; bank = FCBANK[cur]; acc = BANK[bank]; dt = day(m, R.randint(6, 26))
        rate = r2(o.rate(cur, dt) * s['fx_pay_markup'])
        fc = doc['bal']
        if L.fc[acc][0] < fc + 1000:
            buy_fx(m, cur, r2(fc - L.fc[acc][0] + R.choice([5000, 10000, 20000])), day(m, max(1, int(dt[-2:]) - 2)))
        ok, t = o.call('pay_arap_document', dict(documentId=doc['no'], cashAccount=bank, date=dt, amount=fc, exchangeRate=rate), f'{m}:fcpay')
        if not ok:
            o.note(m, f'FC төлбөр {doc["no"]}: {t[:150]}'); continue
        paid_mnt = r2(fc * rate); book = r2(fc * doc['rate']) if doc.get('rate') else r2(doc['mnt'] * fc / doc['total'])
        ent = [('31000001', book, 0), (acc, 0, paid_mnt)]
        if paid_mnt > book:
            ent.append(('87000003', r2(paid_mnt - book), 0))
        elif paid_mnt < book:
            ent.append(('51800001', 0, r2(book - paid_mnt)))
        L.post(dt, ent, doc['no']); L.fc_move(acc, -fc, -paid_mnt); doc['bal'] = 0
    s['open_ar'] = [d for d in s['open_ar'] if d['bal'] > 0]
    s['open_ap'] = [d for d in s['open_ap'] if d['bal'] > 0]
    o.save()


def buy_fx(m, cur, fc, dt):
    """Хаан банк MNT → валютын данс шилжүүлэг (валют худалдан авалт), ханш = албан × 1.006."""
    bank = FCBANK[cur]; acc = BANK[bank]; rate = r2(o.rate(cur, dt) * 1.006); mnt = r2(fc * rate)
    # Өөр валюттай данс хооронд transfer дэмжигдэхгүй (SIM2-021) → 2 баримт: MNT зарлага → 11000099 түр данс → валютын орлого (ханштай)
    ok, t = o.call('create_cash_transactions_batch', {'items': [
        dict(documentType='payment', date=dt, cashAccount='Хаан банк MNT', counterAccount='11000099', amount=mnt, description=f'Валют худалдан авалт {fc} {cur} @ {rate} (MNT тал)', externalRef=f'sim:{m}:FXBUY:{cur}:{dt}:M'),
        dict(documentType='receipt', date=dt, cashAccount=bank, counterAccount='11000099', amount=fc, exchangeRate=rate, description=f'Валют худалдан авалт {fc} {cur} @ {rate} ({cur} тал)', externalRef=f'sim:{m}:FXBUY:{cur}:{dt}:F')]}, f'{m}:fxbuy')
    if ok and 'алдаатай 0' in t:
        L.post(dt, [(acc, mnt, 0), ('11000001', 0, mnt)], f'FXBUY:{cur}:{dt}'); L.fc_move(acc, fc, mnt)
    else:
        o.note(m, f'FX buy {cur}: {t[:200]}')
    return ok, t


# ─────────────────────────── БУСАД (зээл, даатгал, шимтгэл, USD зээлийн тэгшитгэл) ───────────────────────────
def misc(m, R):
    d = eom(m)
    o.call('create_journal_voucher', {'date': d, 'description': f'Урьдчилж төлсөн даатгалын сарын зардал {m}', 'externalRef': f'sim:{m}:INS', 'lines': [dict(account='73100003', debit=750000, credit=0), dict(account='18000001', debit=0, credit=750000)]}, f'{m}:misc-jv')
    L.post(d, [('73100003', 750000, 0), ('18000001', 0, 750000)], f'INS:{m}')
    cash = [dict(documentType='payment', date=day(m, 25), cashAccount='Хаан банк MNT', counterAccount='87000005', amount=900000, description=f'Зээлийн хүү ₮ (60M × 1.5%) {m}', externalRef=f'sim:{m}:INT', cashFlowCode='3103'),
            dict(documentType='payment', date=d, cashAccount='Хаан банк MNT', counterAccount='73100004', amount=R.randint(60, 140) * 1000, description=f'Банкны шимтгэл {m}', externalRef=f'sim:{m}:FEE'),
            dict(documentType='payment', date=day(m, R.randint(8, 20)), cashAccount='Касс MNT', counterAccount='73100006', amount=R.randint(400, 900) * 1000, description=f'Дотоод тээвэр, ачигч {m}', externalRef=f'sim:{m}:TRIP'),
            dict(documentType='payment', date=day(m, R.randint(5, 20)), cashAccount='Касс MNT', counterAccount='73100007', amount=R.randint(60, 200) * 1000, description=f'Бичиг хэрэг {m}', externalRef=f'sim:{m}:OFFICE'),
            dict(documentType='transfer', date=day(m, 2), cashAccount='Хаан банк MNT', toCashAccount='Касс MNT', amount=1500000, description=f'Банкнаас касс {m}', externalRef=f'sim:{m}:TRF')]
    for it in cash:
        if it['documentType'] == 'transfer':
            L.post(it['date'], [('10000001', it['amount'], 0), ('11000001', 0, it['amount'])], it['externalRef'])
        else:
            L.post(it['date'], [(it['counterAccount'], it['amount'], 0), (BANK[it['cashAccount']], 0, it['amount'])], it['externalRef'])
    o.call('create_cash_transactions_batch', {'items': cash}, f'{m}:misc-cash')
    # USD зээлийн хүү 0.75%/сар — Голомт USD-ээс (ханштай зарлага)
    dt = day(m, 26); rate = o.rate('USD', dt); fc = 375.0; mnt = r2(fc * rate)
    ok, t = o.call('create_cash_transaction', dict(documentType='payment', date=dt, cashAccount='Голомт USD', counterAccount='87000005', amount=fc, exchangeRate=rate, description=f'USD зээлийн хүү {m}', externalRef=f'sim:{m}:USDINT', cashFlowCode='3103'), f'{m}:usdint')
    if ok:
        L.post(dt, [('87000005', mnt, 0), ('11000003', 0, mnt)], f'USDINT:{m}'); L.fc_move('11000003', -fc, -mnt)
    # USD зээлийн ханшийн тэгшитгэл — гар журнал (run_fx_revaluation зөвхөн мөнгөн дансанд)
    r_eom = o.rate('USD', d)
    diff = L.fx_reval(m, '32000003', r_eom)  # өр: fc сөрөг → target сөрөг
    if diff:
        # L.fx_reval: diff>0 → Dr acc / Cr gain (өрийн хувьд MNT дүн буурсан = олз) — ижил логикоор системд бичнэ
        lines = [dict(account='32000003', debit=diff, credit=0), dict(account='51800001', debit=0, credit=diff)] if diff > 0 else [dict(account='87000003', debit=-diff, credit=0), dict(account='32000003', debit=0, credit=-diff)]
        o.call('create_journal_voucher', {'date': d, 'description': f'USD зээлийн ханшийн тэгшитгэл {m} (50,000 USD @ {r_eom})', 'externalRef': f'sim:{m}:LOANFX', 'lines': lines}, f'{m}:loanfx')
    o.save()


if __name__ == '__main__':
    m = sys.argv[1]
    steps = sys.argv[2].split(',') if len(sys.argv) > 2 else ['imports', 'imports_cycle', 'sales', 'movements', 'purchases', 'collections', 'misc']
    R = random.Random(int(m.replace('-', '')) * 11)
    for st in steps:
        globals()[st](m, R)
        o.save()


def po_finalize_all(m, R, post_costs=True):
    """Сар хаалтын өмнө: хүлээн авалттай нээлттэй PO бүрийг сарын эцсийн өдрөөр бүтэн хүлээн авч, нэхэмжилж, зардал, хуваарилалт хийж хаана (SIM2-023 хориг)."""
    d = eom(m)
    for po in s['po']:
        if po['status'] not in ('open', 'hold'):
            continue
        po['status'] = 'open'
        if any(l['quantity'] > l.get('rcv', 0) for l in po['lines']):
            po_receive(po, m, R, 1.0, date=d)
        for g in po['gr']:
            if g['confirmed'] and not g.get('oracle'):
                po_oracle_receipt(po, g, m)
        if any(l.get('rcv', 0) > l.get('inv', 0) for l in po['lines']):
            po_invoice(po, m, R, date=d)
        if po['gr'] and all(g['confirmed'] for g in po['gr']) and sum(c['base'] for c in po['cost']) < sum(g['mnt'] for g in po['gr']) - 1:
            po_costs(po, m, R, date=d)
        if any(not c['allocated'] for c in po['cost']):
            po_allocate(po, m)
    o.save()
