# -*- coding: utf-8 -*-
"""D · SIM Микро ХХК — жижиг кофе шоп/бэлэг дурсгалын дэлгүүр. НӨАТ төлөгч БИШ (7-р сараас болно). 2025-01-01 шинээр үүссэн, нээлт = 0.
Зөвхөн вэбээр, «нягтлан биш эзэн»-ий нүдээр. 2 ажилтан, 15 бараа, 1 агуулах, 1 ҮХ."""
import random
R = random.Random(2604)
ORG = 'D'; NAME = 'SIM Микро ХХК'; REG = '6934567'; VAT_PAYER = False; VAT_NO = ''
CUTOFF = '2024-12-31'; START = '2025-01'; END = '2025-12'
ACCOUNTS = [("73100002", "Түрээсийн зардал"), ("73100003", "Цахилгаан, ус"), ("73100004", "Банкны шимтгэл"), ("73100005", "Зар сурталчилгаа"), ("73100008", "Интернэт")]
WAREHOUSES = [("WH-01", "Дэлгүүр")]
CASH = [dict(name='Касс', accountType='cash', currency='MNT', glAccount='10000001', openingBalance=0),
        dict(name='Хаан банк', accountType='bank', bankName='Хаан банк', accountNumber='5077889900', currency='MNT', glAccount='11000001', openingBalance=0)]
_items = [("Кофе латте", 2500, 7500), ("Кофе американо", 1800, 6000), ("Капучино", 2600, 7800), ("Цай", 800, 4000), ("Круассан", 2200, 6500), ("Бялуу зүсэм", 3500, 9500),
          ("Ноолууран ороолт", 45000, 95000), ("Монгол дээл (жижиг)", 60000, 140000), ("Ил захидал ×5", 1500, 6000), ("Соёмбо магнит", 2000, 7000), ("Гар урлалын аяга", 9000, 24000),
          ("Ноолууран оймс", 12000, 28000), ("Модон хайрцаг", 15000, 38000), ("Хивсэнцэр", 25000, 65000), ("Морин хуур (мини)", 40000, 110000)]
ITEMS = [dict(code=f"MK-{i+1:02d}", name=n, unit="ш", cost=c, price=p, salesPrice=p, barcode=f"8690000000{i+1:02d}") for i, (n, c, p) in enumerate(_items)]
CUSTOMERS = [dict(name="Жуулчны Бааз Тэрэлж ХХК", counterpartyType='customer', entityKind='organization', code='C5001', registerNo='6200100', paymentTermsDays=14, currency='MNT'),
             dict(name="Оффис Захиалга (хувь хүн)", counterpartyType='customer', entityKind='individual', code='C5002', registerNo='УУ93040100', paymentTermsDays=0, currency='MNT'),
             dict(name="Зочид Буудал Шангри-Ла", counterpartyType='customer', entityKind='organization', code='C5003', registerNo='6200103', paymentTermsDays=30, currency='MNT')]
SUPPLIERS = [dict(name='Кофе Импорт ХХК', code='S5001', registerNo='6211001', paymentTermsDays=7), dict(name='Гобь ХК (ноолуур)', code='S5002', registerNo='6211008', paymentTermsDays=14),
             dict(name='Талх Чихэр ХК', code='S5003', registerNo='6211015', paymentTermsDays=3), dict(name='Түрээслүүлэгч Дорж (хувь хүн)', code='S5004', registerNo='УБ80010101', paymentTermsDays=0, entityKind='individual'),
             dict(name='УБЦТС ТӨХК', code='S5005', registerNo='2011001', paymentTermsDays=15), dict(name='Юнивишн ХХК', code='S5006', registerNo='5911036', paymentTermsDays=15)]
for s in SUPPLIERS:
    s.setdefault('counterpartyType', 'supplier'); s.setdefault('currency', 'MNT'); s.setdefault('entityKind', 'organization')
EMPLOYEES = [dict(name="Номин", lastName="Бат", position="Эзэн-менежер", department="Удирдлага", baseSalary=2000000, hireDate="2025-01-01", registerNo="УБ90010101", bankName="Хаан банк", bankAccountNo="5011112222", employerSiPercent=12.5),
             dict(name="Ану", lastName="Сүх", position="Бариста-худалдагч", department="Дэлгүүр", baseSalary=1300000, hireDate="2025-01-15", registerNo="УБ99010102", bankName="Хаан банк", bankAccountNo="5033334444", employerSiPercent=12.5)]
FA = [("Кофе машин La Marzocco", "2025-01-10", 18500000, 60, 0)]
OPENING = {}  # тэг нээлт; 2025-01-05 эздийн өмч 30 сая ₮ оруулна
