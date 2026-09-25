"""C · POS тохиргоо: карт клирингийн данс, төлбөрийн хэлбэрүүд, POS тохиргоо."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
from engine import *
o = Org('C')
o.call('create_cash_account', dict(name='Карт клиринг (Голомт)', accountType='bank', bankName='Голомт банк', accountNumber='1105009900', currency='MNT', glAccount='12000005'), 'pos:setup')
for code, name, kind, acct, extra in [('CASH', 'Бэлэн — дэлгүүр №1', 'cash', 'Касс дэлгүүр №1', {}), ('CASH2', 'Бэлэн — дэлгүүр №2', 'cash', 'Касс дэлгүүр №2', {}),
                                      ('CARD', 'Карт (POS терминал)', 'card', 'Карт клиринг (Голомт)', dict(requiresReference=True, feePercent=1.0)),
                                      ('QPAY', 'QPay', 'ewallet', 'Хаан банк MNT', {}), ('CREDIT', 'Зээлээр (харилцагч)', 'credit', None, {})]:
    a = dict(code=code, name=name, kind=kind, allowsRefund=True, isActive=True, **extra)
    if acct:
        a['cashAccount'] = acct
    o.call('save_pos_payment_method', a, 'pos:setup')
o.call('update_pos_settings', dict(allowNegativeStock=False, provisionalCogs=True, discountPosting='net', maxManualDiscountPercent=10, cashRoundingUnit=0, revenueAccount='51100005', receiptHeader='SIM Импорт ХХК — Дэлгүүр', receiptFooter='Баярлалаа!'), 'pos:setup')
o.call('get_pos_status', {}, 'pos:setup')
o.save()
