"""Oracle 2.0 — бие даасан сүүдрийн дэвтэр.
GL + бараа (сарын жигнэсэн дундаж, бараа×агуулах) + FX (сарын тэгшитгэл) + ҮХ (шулуун шугам, нээлтийн хуримтлагдсантай)
+ цалин (lib/payroll/calc.ts-ийн дүрэм) + НӨАТ. Бүх дүн ₮; бутархай 2 орон.
"""
import json, os, calendar, datetime
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def r2(x):
    return float(round(x + 1e-9, 2))


def eom(m):
    y, mm = map(int, m.split('-'))
    return f'{m}-{calendar.monthrange(y, mm)[1]:02d}'


def day(m, d):
    y, mm = map(int, m.split('-'))
    return f'{m}-{min(d, calendar.monthrange(y, mm)[1]):02d}'


def add_months(m, k):
    y, mm = map(int, m.split('-'))
    n = y * 12 + mm - 1 + k
    return f'{n // 12}-{n % 12 + 1:02d}'


PIT_CREDITS = [(500000, 20000), (1000000, 18000), (1500000, 16000), (2000000, 14000), (2500000, 12000), (3000000, 10000)]
SI_CAP = 792000 * 10


def payroll_calc(earn, employer_pct=12.5, si_exempt=False):
    cap = min(earn, SI_CAP)
    esi = 0 if si_exempt else round(cap * 0.085) + round(cap * 0.008) + round(cap * 0.002) + round(cap * 0.02)
    ersi = 0 if si_exempt else round(cap * employer_pct / 100)
    taxable = max(0, earn - esi)
    credit = next((cr for up, cr in PIT_CREDITS if taxable <= up), 0)
    pit = max(0, round(taxable * 0.1) - credit)
    return dict(earn=earn, esi=esi, ersi=ersi, pit=pit, net=earn - esi - pit)


class Ledger:
    def __init__(self, org):
        self.org = org
        self.path = os.path.join(ROOT, 'orgs', org, 'oracle.jsonl')
        self.lines = []  # dict(date, acc, dr, cr, ref)
        self.fc = defaultdict(lambda: [0.0, 0.0])  # acc -> [FC balance, MNT book]
        self.inv = {}  # (item, wh) -> dict(qty, val)  (сарын эхний үлдэгдэл, батлагдсан)
        self.inv_moves = defaultdict(list)  # month -> list of moves
        self.fa = []  # dict(name, cost, life, accum, salvage, start_month, disposed)
        if os.path.exists(self.path):
            for l in open(self.path):
                self.lines.append(json.loads(l))

    # ── GL ──────────────────────────────────────────────────────────
    def post(self, date, entries, ref=''):
        tot = 0
        for acc, dr, cr in entries:
            dr, cr = r2(dr), r2(cr)
            tot += dr - cr
            row = dict(date=date, acc=acc, dr=dr, cr=cr, ref=ref)
            self.lines.append(row)
            open(self.path, 'a').write(json.dumps(row, ensure_ascii=False) + '\n')
        assert abs(tot) < 0.05, f'oracle unbalanced {ref}: {tot}'

    def tb(self, frm, to):
        net = defaultdict(float)
        for l in self.lines:
            if frm <= l['date'] <= to:
                net[l['acc']] += l['dr'] - l['cr']
        return {k: r2(v) for k, v in net.items() if abs(v) > 0.004}

    def balance(self, acc, to):
        return r2(sum(l['dr'] - l['cr'] for l in self.lines if l['acc'] == acc and l['date'] <= to))

    # ── FX (валютын мөнгөн данс) ────────────────────────────────────
    def fc_move(self, acc, fc_amt, mnt_amt):
        self.fc[acc][0] += fc_amt
        self.fc[acc][1] += mnt_amt

    def fx_reval(self, m, acc, rate, gain_acc='51800001', loss_acc='87000003'):
        fc, book = self.fc[acc]
        target = r2(fc * rate)
        diff = r2(target - book)
        if abs(diff) < 0.01:
            return 0
        d = eom(m)
        if diff > 0:
            self.post(d, [(acc, diff, 0), (gain_acc, 0, diff)], f'FX:{m}:{acc}')
        else:
            self.post(d, [(loss_acc, -diff, 0), (acc, 0, -diff)], f'FX:{m}:{acc}')
        self.fc[acc][1] = target
        return diff

    # ── Бараа (сарын жигнэсэн дундаж) ──────────────────────────────
    def inv_receipt(self, m, item, wh, qty, unit_cost, ref):
        self.inv_moves[m].append(dict(t='in', item=item, wh=wh, qty=qty, cost=r2(qty * unit_cost), ref=ref))

    def inv_landed(self, m, item, wh, amount, ref):
        self.inv_moves[m].append(dict(t='in', item=item, wh=wh, qty=0, cost=r2(amount), ref=ref))

    def inv_issue(self, m, item, wh, qty, ref, debit_acc='61100000'):
        self.inv_moves[m].append(dict(t='out', item=item, wh=wh, qty=qty, ref=ref, acc=debit_acc))

    def inv_transfer(self, m, item, src, dst, qty, ref):
        self.inv_moves[m].append(dict(t='xfer', item=item, wh=src, to=dst, qty=qty, ref=ref))

    def inv_close(self, m, inv_acc='14000001', clearing='14000099'):
        """Сар хаалт: бараа×агуулах бүрт avg = (нээлт + орлого)/(тоо); зарлага avg-аар; шилжүүлэг avg-аар.
        Буцаана: dict((item,wh)->avg), нийт COGS. GL: Dr зарлагын данс / Cr 14000001; орлого Dr 14000001 / Cr 14000099."""
        moves = self.inv_moves.get(m, [])
        keys = set(self.inv.keys()) | {(x['item'], x['wh']) for x in moves} | {(x['item'], x['to']) for x in moves if x['t'] == 'xfer'}
        avg = {}
        d = eom(m)
        out_by_acc = defaultdict(float)
        # 1) орлого капиталжуулах
        for x in moves:
            if x['t'] == 'in':
                b = self.inv.setdefault((x['item'], x['wh']), dict(qty=0.0, val=0.0))
                b['qty'] += x['qty']; b['val'] += x['cost']
                if x['cost']:
                    self.post(d, [(inv_acc, x['cost'], 0), (clearing, 0, x['cost'])], f'RCV:{x["ref"]}')
        # 2) дундаж (шилжүүлгийн эх агуулахаас хүлээн авагч руу нэг удаа тооцно)
        for k in keys:
            b = self.inv.setdefault(k, dict(qty=0.0, val=0.0))
            avg[k] = r2(b['val'] / b['qty']) if b['qty'] > 0 else 0.0
        for x in moves:
            if x['t'] == 'xfer':
                a = avg[(x['item'], x['wh'])]
                v = r2(a * x['qty'])
                s = self.inv[(x['item'], x['wh'])]; t = self.inv.setdefault((x['item'], x['to']), dict(qty=0.0, val=0.0))
                s['qty'] -= x['qty']; s['val'] -= v; t['qty'] += x['qty']; t['val'] += v
                avg[(x['item'], x['to'])] = r2(t['val'] / t['qty']) if t['qty'] > 0 else 0.0
        # 3) зарлага
        for x in moves:
            if x['t'] == 'out':
                a = avg[(x['item'], x['wh'])]
                v = r2(a * x['qty'])
                b = self.inv[(x['item'], x['wh'])]
                b['qty'] -= x['qty']; b['val'] -= v
                out_by_acc[x['acc']] += v
        for acc, v in out_by_acc.items():
            if v:
                self.post(d, [(acc, v, 0), (inv_acc, 0, v)], f'COGS:{m}:{acc}')
        # 4) тооллогын тохируулга (илүүдэл 51800003 / дутагдал 87100004) — дунджаар
        for x in moves:
            if x['t'] == 'adj':
                a = avg[(x['item'], x['wh'])]
                v = r2(a * abs(x['qty']))
                b = self.inv[(x['item'], x['wh'])]
                b['qty'] += x['qty']; b['val'] += v if x['qty'] > 0 else -v
                if v:
                    self.post(d, [(inv_acc, v, 0), (x.get('gain_acc', '51800003'), 0, v)] if x['qty'] > 0 else [(x.get('loss_acc', '87100004'), v, 0), (inv_acc, 0, v)], f'ADJ:{x["ref"]}')
        return avg, r2(sum(out_by_acc.values()))

    def remove(self, pred):
        """pred(line)->bool байх мөрүүдийг устгаж файлыг дахин бичнэ; устгасан тоог буцаана."""
        n = len(self.lines)
        self.lines = [l for l in self.lines if not pred(l)]
        open(self.path, 'w').write(''.join(json.dumps(l, ensure_ascii=False) + '\n' for l in self.lines))
        return n - len(self.lines)

    def inv_rebuild(self):
        """Барааны oracle-г бүх сарын хөдөлгөөнөөс дахин тооцно (RCV/COGS/ADJ мөрүүдийг устгаж дахин бичнэ)."""
        import re as _re
        self.lines = [l for l in self.lines if not _re.match(r'(RCV|COGS|ADJ):', l['ref'])]
        open(self.path, 'w').write(''.join(json.dumps(l, ensure_ascii=False) + '\n' for l in self.lines))
        self.inv = {}
        for m in sorted(self.inv_moves):
            self.inv_close(m)

    def stock(self):
        return {k: round(v['qty'], 3) for k, v in self.inv.items() if abs(v['qty']) > 0.0005}

    def inv_value(self):
        return r2(sum(v['val'] for v in self.inv.values()))

    # ── ҮХ ─────────────────────────────────────────────────────────
    def fa_add(self, name, cost, life, start_month, accum=0.0, salvage=0.0, acc_cost='20000001', acc_accum='20000002', acc_exp='70000001'):
        self.fa.append(dict(name=name, cost=cost, life=life, start=start_month, accum=accum, salvage=salvage, disposed=None, acc=(acc_cost, acc_accum, acc_exp)))

    def fa_dep(self, m):
        tot = 0
        for f in self.fa:
            if f['disposed'] or m < f['start']:
                continue
            base = f['cost'] - f['salvage']
            monthly = r2(base / f['life'])
            remaining = r2(base - f['accum'])
            if remaining <= 0:
                continue
            amt = min(monthly, remaining)
            f['accum'] = r2(f['accum'] + amt)
            self.post(eom(m), [(f['acc'][2], amt, 0), (f['acc'][1], 0, amt)], f'DEP:{m}:{f["name"]}')
            tot += amt
        return r2(tot)

    def fa_dispose(self, name, date, proceeds=0.0, proceeds_acc='13110000', gl_acc='87000004'):
        f = next(x for x in self.fa if x['name'] == name and not x['disposed'])
        nbv = r2(f['cost'] - f['accum'])
        gl = r2(proceeds - nbv)
        ent = [(f['acc'][1], f['accum'], 0), (f['acc'][0], 0, f['cost'])]
        if proceeds:
            ent.append((proceeds_acc, proceeds, 0))
        if gl < 0:
            ent.append((gl_acc, -gl, 0))
        elif gl > 0:
            ent.append((gl_acc, 0, gl))
        self.post(date, ent, f'DISP:{name}')
        f['disposed'] = date
        return nbv, gl

    def save_state(self):
        json.dump(dict(fc=dict(self.fc), inv={f'{k[0]}|{k[1]}': v for k, v in self.inv.items()}, fa=self.fa,
                       inv_moves={k: v for k, v in self.inv_moves.items()}),
                  open(os.path.join(ROOT, 'orgs', self.org, 'oracle_state.json'), 'w'), ensure_ascii=False, indent=1)

    def load_state(self):
        p = os.path.join(ROOT, 'orgs', self.org, 'oracle_state.json')
        if not os.path.exists(p):
            return
        s = json.load(open(p))
        for k, v in s['fc'].items():
            self.fc[k] = v
        self.inv = {tuple(k.split('|')): v for k, v in s['inv'].items()}
        self.fa = s['fa']
        self.inv_moves = defaultdict(list, {k: v for k, v in s['inv_moves'].items()})
