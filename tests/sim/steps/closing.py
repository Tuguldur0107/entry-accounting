"""Сар хаалтын алхмууд (бүх байгууллагад нийтлэг): payroll, pay_payroll, fa_dep, costing, vat, fx, check, close."""
import sys, os, re, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
from engine import *
from issues import add as issue


def node(org, script, *args):
    r = subprocess.run(['node', os.path.join(ROOT, 'web', script), *args], capture_output=True, text=True, env=dict(os.environ, SIM_ORG=org))
    out = (r.stdout + r.stderr)[-2500:]
    print(f'[web] {script} {" ".join(args)}\n{out}', flush=True)
    return out


def payroll_expected(o, m):
    """Идэвхтэй ажилтны хүлээгдэж буй бодолт — s['employees'] override (цалин өөрчлөлт, гарсан/орсон)."""
    rows = []
    extra = [dict(name=n, baseSalary=v['salary'], employerSiPercent=12.5) for n, v in o.s['employees'].items() if v.get('extra') and not any(e['name'] == n for e in o.P.EMPLOYEES)]
    for e in list(o.P.EMPLOYEES) + extra:
        ov = o.s['employees'].get(e['name'], {})
        if ov.get('term') and ov['term'] < f'{m}-01':
            continue
        if ov.get('hire') and ov['hire'] > eom(m):
            continue
        earn = ov.get('salary', e['baseSalary'])
        earn = ov.get('override', {}).get(m, earn)
        rows.append(dict(name=e['name'], **payroll_calc(earn, e.get('employerSiPercent', 12.5))))
    tot = {k: sum(r[k] for r in rows) for k in ('earn', 'esi', 'ersi', 'pit', 'net')}
    return rows, tot


def payroll(o, m):
    o.call('run_payroll', {'period': m}, f'{m}:payroll')
    ok, summ = o.call('get_payroll_summary', {'period': m}, f'{m}:payroll')
    ok, t = o.call('create_payroll_voucher', {'period': m}, f'{m}:payroll')
    rows, tot = payroll_expected(o, m)
    d = eom(m)
    o.L.post(d, [('72100000', tot['earn'], 0), ('72100002', tot['ersi'], 0), ('31420000', 0, tot['esi'] + tot['ersi']), ('31430000', 0, tot['pit']), ('31500001', 0, tot['net'])], f'PAY-{m}')
    o.s.setdefault('payroll', {})[m] = dict(expected=tot, summary=summ[:2000])
    for no in re.findall(r'(PAY-\d\d-\d{6})', t):
        o.s['drafts'].append(dict(kind='jv', no=no, month=m, what='payroll'))
    # системийн нийт дүнг oracle-той тулгах
    mm = re.search(r'[Нн]ийт.*?цалин[^\d]*([\d,\.]+)', summ)
    return tot


def pay_payroll(o, m, bank='Хаан банк MNT', bank_gl='11000001'):
    tot = payroll_expected(o, m)[1]
    prev = o.s.get('payroll', {}).get(add_months(m, -1), {}).get('expected')
    items = [dict(documentType='payment', date=eom(m), cashAccount=bank, counterAccount='31500001', amount=tot['net'], description=f'Цалин олгосон {m}', externalRef=f'sim:{m}:NET', cashFlowCode='1103')]
    o.L.post(eom(m), [('31500001', tot['net'], 0), (bank_gl, 0, tot['net'])], f'sim:{m}:NET')
    if prev:
        for acc, amt, nm, cf in [('31420000', prev['esi'] + prev['ersi'], 'НДШ', '1103'), ('31430000', prev['pit'], 'ХХОАТ', '1104')]:
            if amt <= 0:
                continue
            items.append(dict(documentType='payment', date=day(m, 10), cashAccount=bank, counterAccount=acc, amount=amt, description=f'{nm} төлсөн (өмнөх сар)', externalRef=f'sim:{m}:{nm}', cashFlowCode=cf))
            o.L.post(day(m, 10), [(acc, amt, 0), (bank_gl, 0, amt)], f'sim:{m}:{nm}')
    return o.call('create_cash_transactions_batch', {'items': items}, f'{m}:payroll-pay')


def fa_dep(o, m):
    o.call('run_fa_depreciation', {'month': m}, f'{m}:fa')
    ok, t = o.call('post_fa_depreciation', {'month': m}, f'{m}:fa')
    exp = o.L.fa_dep(m)
    mm = re.search(r'([\d,\.]+)₮', t)
    sysv = float(mm.group(1).replace(',', '')) if mm else None
    if sysv is not None and abs(sysv - exp) > 1:
        o.note(m, f'FA dep system {sysv} vs oracle {exp}')
    if 'AMOUNT_LIMIT' in t or not ok:
        node(o.org, 'fa_post.mjs', m, f'fa-{m}')
    return t


def vat_manual(o, m, bank='Хаан банк MNT', bank_gl='11000001'):
    """НӨАТ тооцоо (системийн логикийг тусгасан): out = сарын гаралт; credit = 13620000-ийн үлдэгдэл (өмнөх сарын шилжсэн орно).
    net>0: Dr 31410000 out / Cr 13620000 credit / Cr банк net.  net≤0: Dr 31410000 out / Cr 13620000 out (үлдэх кредит дараа сард)."""
    ok, t = o.call('get_vat_return', {'period': m}, f'{m}:vat')
    ok2, t2 = o.call('create_vat_settlement', {'period': m, 'cashAccount': bank}, f'{m}:vat')
    out = r2(sum(l['cr'] for l in o.L.lines if l['acc'] == '31410000' and f'{m}-01' <= l['date'] <= eom(m) and not l['ref'].startswith('VATSET')))
    inp = r2(sum(l['dr'] for l in o.L.lines if l['acc'] == '13620000' and f'{m}-01' <= l['date'] <= eom(m) and not l['ref'].startswith('VATSET')))
    credit = o.L.balance('13620000', eom(m))
    net = r2(out - credit)
    if out <= 0 and inp <= 0:
        return t, t2
    if net > 0:
        ent = [('31410000', out, 0), ('13620000', 0, credit), (bank_gl, 0, net)]
    else:
        ent = [('31410000', out, 0), ('13620000', 0, out)]
    o.L.post(eom(m), ent, f'VATSET:{m}')
    o.s.setdefault('vat', {})[m] = dict(out=out, inp=inp, credit=credit, net=net, system=t[:1500])
    return t, t2


def fx(o, m, accounts):
    out = []
    for acc in accounts:
        ok, t = o.call('run_fx_revaluation', {'valuationDate': eom(m), 'cashAccount': acc}, f'{m}:fx')
        out.append(t)
        for no in re.findall(r'(FX-\d\d-\d{6})', t):
            o.s['drafts'].append(dict(kind='jv', no=no, month=m, what='fx'))
    return out


def costing(o, m):
    ok, t = o.call('run_monthly_costing', {'period': m}, f'{m}:costing')
    ok2, t2 = o.call('post_cost_entries', {'month': m}, f'{m}:costing')
    return t, t2


def check(o, m):
    o.call('reconcile_modules', {'from': f'{m}-01', 'to': eom(m)}, f'{m}:check')
    ok, t = o.call('get_month_end_checklist', {'period': m}, f'{m}:check')
    return t


def close(o, m):
    ok, t = o.call('close_period', {'code': m}, f'{m}:close')
    if not ok and 'ноорог' in t:
        # GL журналаас үүссэн «сүүдэр» кассын ноорог (SIM2-011) — устгах; бусад ноорог → вэбээр батлах
        ok2, lst = o.call('list_cash_documents', {'status': 'draft', 'from': f'{m}-01', 'to': eom(m), 'limit': 100}, f'{m}:close-drafts')
        shadow = re.findall(r'(GL-\d{8}-[0-9A-F]{6}) ·[^\n]*· ID ([0-9a-f]{8})', lst)
        for no, did in shadow:
            o.call('delete_cash_document', {'documentId': did}, f'{m}:close-shadow')
            o.note(m, f'сүүдэр кассын ноорог устгав {no}')
        if 'олдсонгүй' not in lst and len(shadow) < lst.count('· draft ·') // 2:
            node(o.org, 'bulk_post.mjs', '/cash/transactions', m, f'cash-close-{m}')
        post_drafts_web(o, m)
        ok, t = o.call('close_period', {'code': m}, f'{m}:close')
    if not ok and 'өмнөх тайлант үе нээлттэй' in t:
        # Дараалсан хаалт: нээлтийн баримтууд (cut-off-оос өмнөх огноотой АР/АП,
        # нээлтийн журнал) байгаа тул өмнөх саруудыг эхнээс нь хаана.
        for k in range(12, 0, -1):
            o.call('close_period', {'code': add_months(m, -k)}, f'{m}:close-prev')
        ok, t = o.call('close_period', {'code': m}, f'{m}:close')
    if ok:
        o.s['months_done'].append(m)
    return ok, t


def ensure_arap_posted(o, m, rounds=2):
    """НӨАТ тооцооноос ӨМНӨ тухайн сарын АР/АП ноорог үлдээгүйг баталгаажуулна (SIM2-015 давтагдахаас сэргийлнэ)."""
    for _ in range(rounds):
        ok, t = o.call('list_arap_documents', {'status': 'draft', 'from': f'{m}-01', 'to': eom(m), 'limit': 100}, f'{m}:arap-guard')
        if 'олдсонгүй' in t:
            return True
        node(o.org, 'post_arap_all.mjs', 'receivables', m, f'ar-guard-{m}')
        node(o.org, 'post_arap_all.mjs', 'payables', m, f'ap-guard-{m}')
    o.note(m, 'АР/АП ноорог үлдсэн — НӨАТ тооцоо дутуу байж болзошгүй')
    return False


def post_drafts_web(o, m):
    """Ноорог журналуудыг вэбээс батлах (цалин, FX, НӨАТ, том дүн)."""
    ok, t = o.call('list_journal_vouchers', {'status': 'draft', 'limit': 100}, f'{m}:drafts')
    pairs = sorted(set(re.findall(r'(\d{4}-\d{2})-\d{2} · ((?:GL|CM|PAY|FX|COST|CL|YE|VAT)-\d\d-\d{6})', t)))
    for ym, no in pairs:
        node(o.org, 'post_jv.mjs', ym, no, f'{ym}-{no}')
    return [p[1] for p in pairs]
