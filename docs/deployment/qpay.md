# QPay Quick QR — нэвтрүүлэлтийн заавар (dashboard-хаалгын загвар)

Зорилтот уншигч: Entry-г харилцагчид нэвтрүүлж байгаа оператор ба харилцагчийн
нягтлан / кассчин. Дизайн: `docs/pos/04-qpay-integration-plan.md` (D1–D8),
гэрээ `docs/pos/01-implementation-contract.md` §10, dashboard-ын API гэрээ
`Tuguldur0107/qpay-dashboard` → `docs/API.md` (v1 хөлдөөсөн + «Connect»).

> **Гол ойлголт:** Entry нь QPay-тэй ШУУД харьцахгүй. Операторын
> **qpay-dashboard** (ККТТ-тэй ХСН гэрээтэй нэг parent мерчант) нь харилцагч
> бүрийг **sub-merchant** болгож, Entry түүнтэй REST v1 (`x-api-key`)-ээр
> ярина. Төлбөр харилцагчийн ӨӨРИЙН банкны данс руу орно (ККТТ шимтгэл 1%
> гүйлгээний мөчид суутгагдана). Харилцагчид QPay-ийн нэвтрэх эрх, гэрээ
> ХЭРЭГГҮЙ.

## 1. Загвар — нэг dashboard, олон мерчант

```
Оператор (Entry нийлүүлэгч)
└── qpay-dashboard (Railway, parent мерчант — ККТТ ХСН гэрээ)
      ├── Sub-merchant А (харилцагч №1: РД, MCC, банкны данс)  ← Entry апп №1 (x-api-key А)
      ├── Sub-merchant Б (харилцагч №2)                          ← Entry апп №2 (x-api-key Б)
      └── …
```

- Харилцагч бүрд ӨӨРИЙН API key + webhook secret (`pos_settings`-д AES
  шифртэй). Console-д мерчантын нууц ХАДГАЛАГДАХГҮЙ
- Нэхэмжлэх бүр Entry-ийн `callback_url` (`…/api/pos/qpay/webhook?intent=`)-тэй
  үүсдэг тул dashboard дээр webhook URL гараар тохируулах шаардлагагүй

## 2. Харилцагчийг холбох — НЭГ ТОВЧ (харилцагч, ~5 минут)

1. Entry: **Борлуулалт → Тохиргоо → QPay → [QPay холбох]**
2. qpay-dashboard нээгдэнэ: бүртгэлгүй бол **Бүртгүүлэх** → онбординг
   (байгууллага/хувь хүн, РД, MCC, хаяг, утас, **банкны данс** — төлбөр
   энэ данс руу орно). Бүртгэлтэй бол нэвтэрнэ
3. «QPay холболт» consent дэлгэц: *Entry («Байгууллагын нэр») таны мерчантад
   холбогдох хүсэлт* → **[Зөвшөөрч холбох]**
4. Entry рүү автоматаар буцна: API key, webhook secret, мерчант id хадгалагдаж,
   **«QPay» төлбөрийн хэлбэр** (ewallet, провайдер QPay) ба **«QPay түр данс»**
   (банк, GL 11000099) үүсээд QPay **асна**. Ногоон мэдэгдэл гарна
5. Кассын дэлгэц → Төлбөр → QPay → [QR үүсгэх] → 100₮-ийн бодит тест

Дахин холбоход (**[QPay дахин холбох]**) dashboard-ын API key СОЛИГДОНО —
тэр key-г ашигладаг өөр интеграци (MCP г.м.) хүчингүй болно.

**Гар зам** (нийтийн URL байхгүй dedicated суулгацад): dashboard → Merchants →
API хөгжүүлэлт → API key + webhook secret хуулж Entry-ийн QPay табд буулгаад
асаана (API хандалтыг dashboard-ын админ нээж өгнө).

## 2b. Автомат бүртгэл — Entry-ийн мэдээллээр (Partner API, 2026-09-25)

Харилцагч dashboard руу ОГТ орохгүй: Entry-д бүртгэсэн компанийн мэдээлэл
QPay мерчант болно, key/secret эргээд Entry-д ирнэ, данс өөрчлөгдвөл дагаж
шинэчлэгдэнэ. Нөхцөл: Entry-д `QPAY_PARTNER_KEY` (dashboard-ын
`QPAY_PARTNER_KEY`-тэй ижил) тохируулсан — SaaS-д тавьсан; dedicated fork-д
тавиагүй бол §2-ын consent зам хэвээр.

1. **Тохиргоо → Компанийн мэдээлэл** бүрэн бөглөнө: нэр, регистр (ААН 7 орон
   → company; иргэн УБ12345678 → person, нэр «Овог Нэр»), **бизнесийн ангилал
   (MCC)**, **хот/аймаг + дүүрэг/сум** (QPay код, сонгогч), хаяг, утас (8 орон),
   и-мэйл, **банкны данс** (банк жагсаалтаас — QPay код; данс эзэмшигч; IBAN
   сонголтоор; «Үндсэн» = QPay төлбөр орох данс). Код ЗОХИОГДОХГҮЙ — дутуу бол
   QPay табд улаанаар нэрлэгдэнэ (`lib/qpay/provision.ts`, тесттэй)
2. **Борлуулалт → Тохиргоо → QPay → [QPay-д бүртгүүлэх]** → Entry-ийн сервер
   dashboard `POST /api/partner/merchants` (Bearer partner key; `external_id` =
   Entry-ийн байгууллагын ID — ИДЕМПОТЕНТ) → dashboard QPay-д мерчант үүсгэнэ
   (регистрээр байвал дахин ашиглана), dashboard хэрэглэгч (эзний и-мэйл,
   и-мэйл баталгаажсан) + данс + API хандалт → `api_key`, `webhook_secret`
   НЭГ удаа → Entry `pos_settings`-д шифртэй (consent замтай ЯГ ижил),
   «QPay» хэлбэр + «QPay түр данс» seed → асна; `qpay_provisioned_at` тавигдана
3. Эзэнд **«QPay Dashboard — нууц үг тохируулах»** и-мэйл (7 хоног) очно —
   dashboard руу орох боломжтой хэвээр (төлбөрийн түүх, settlement)
4. Компанийн мэдээллийн **данс өөрчилж хадгалахад** Entry → dashboard
   `PUT /api/partner/merchants/{id}/bank-accounts` (Entry эх сурвалж; дутуу
   банкны код бол sync алгасаж анхааруулна, хадгалалт унахгүй). QPay табын
   [Данс sync] гараар мөн
5. [QPay дахин холбох] (партнер зам) = dashboard key СОЛИГДОНО (`rotate`)

Нууц: partner key env-д л; хариуны key/secret зөвхөн шифртэй; аудитад
(`provision_completed` / `provision_synced` / `bank_accounts_synced` /
`bank_accounts_sync_failed`) утга ҮГҮЙ. Dashboard тал: `docs/API.md` «Partner».

## 3. Урсгал (техник)

```
[QPay холбох] → state (AES-GCM: org, user, dashboard URL, 15 мин) → {dashboard}/connect?app=entry&callback&state&org
   → нэвтрэлт / онбординг → consent → POST /api/connect/approve → GET {entry}/api/pos/qpay/connect/callback?state&code
   → Entry сервер POST {dashboard}/api/connect/exchange {code, state} → {api_key, webhook_secret} (НЭГ удаа, 5 мин)
   → pos_settings (encryptSecret) + хэлбэр/данс seed + readiness → асаана → /inventory/pos-settings?section=qpay&qpay=connected

Борлуулалт:  QPay мөр → [QR үүсгэх] → pos_qpay_intents (open, cartSnapshot) → dashboard POST /api/v1/invoices
   → QR + deeplink; диалог Entry DB-ээс 2 сек тутам (QPay-руу polling ҮГҮЙ — ККТТ хориг)
   ← webhook payment.paid (HMAC-SHA256, ТҮҮХИЙ body) ЭСВЭЛ [Шалгах] (10 сек-д нэг) → paid
   → «Төлбөр авах» → createPosSale({ qpayIntentId }) → транзакц дотор finalized
```

- Нууц (key, secret, code) URL, browser, лог, аудитад ХЭЗЭЭ Ч орохгүй
- Intent `paid` ч борлуулалт унавал (D3): жагсаалтын «QPay хүлээгдэж буй»
  баннераас [Борлуулалт болгох] — 10 мин хэтэрвэл `pos.qpay_paid_unfinalized`
  мэдэгдэл (POS бичих эрхтэй гишүүдэд, өдөрт нэг)
- GL өөрчлөлтгүй: QPay = `ewallet` хэлбэрийн түр данс → банкны хуулгаар
  тэгшитгэнэ (шимтгэлийн зөрүү тэнд бичигдэнэ). Буцаалт QPay-ээр БАЙХГҮЙ
  (Quick QR refund-гүй) — бэлэн / дэлгүүрийн кредитээр

## 4. Env

| Тохиргоо | Хаана | Үүрэг |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Entry (Railway) | Нийтийн https URL — webhook + нэг товчны холболтын callback. Байхгүй бол QPay зөвхөн гар key + [Шалгах] товчоор |
| `AUTH_SECRET` | Entry | Нууцын шифр (солибол key/secret дахин холбоно) |
| `QPAY_PARTNER_KEY` | Entry + qpay-dashboard (ижил утга, ≥32 тэмдэгт) | §2b автомат бүртгэл — Entry-ийн сервер dashboard Partner API-д. Байхгүй бол зөвхөн consent / гар зам |
| `PUBLIC_BASE_URL`, `QPAY_QR_*`, `QPAY_INVOICE_CODE`, `WEBHOOK_SECRET` | qpay-dashboard | Parent мерчантын тохиргоо — операторын нууц, харилцагчид өгөхгүй |

## 5. Хяналт

- `GET /api/health` → `qpay`: `enabledOrganizations`, `openIntents`,
  `paidUnfinalized`, `lastPaidAt` — нууц, мерчант id, дүн БАЙХГҮЙ
- Тохиргооны QPay таб / AI `get_qpay_status`: төлөв, бэлэн байдал, мерчант id,
  тоолуур
- Аудит (`pos_settings`): `connect_started` / `connect_completed` /
  `connect_failed`; (`pos_qpay_intent`): `paid` / `webhook_rejected` / …
- Dashboard тал: `audit_log` `connect.approved` / `connect.exchanged` /
  `connect.exchange_rejected`

## 6. Асуудал шийдвэрлэх

| Шинж | Шалтгаан / арга |
|---|---|
| [QPay холбох] идэвхгүй, «Нийтийн URL тохируулаагүй» | Entry-д `NEXT_PUBLIC_APP_URL` алга → env нэмж deploy, эсвэл гар зам |
| Буцахад «холболтын хугацаа дууссан» | state 15 мин / code 5 мин хэтэрсэн (онбординг удсан) — [QPay холбох] дахин |
| «dashboard-тай нууц солилцож чадсангүй» | Entry сервер → dashboard руу гарах сүлжээ / dashboard унтарсан — `/api/health` (dashboard) шалга, дахин оролд |
| Consent дэлгэц «мерчантын эзэн … админ биш» | dashboard-д админ эрхээр нэвтэрсэн — гарч хэрэглэгчийн эрхээр |
| QR гарахгүй, `[QPAY_DASHBOARD] 409` | Мерчантад банкны данс холбоогүй — dashboard онбординг / Account → банкны данс |
| «Төлөгдсөн ч бүртгэгдээгүй» тоолуур > 0 | Борлуулалт finalize унасан (хасах үлдэгдэл, период хаалттай …) — баннераас [Борлуулалт болгох], шалтгаан нь алдаанд |
| Webhook ирэхгүй, [Шалгах]-аар л төлөгддөг | `NEXT_PUBLIC_APP_URL` буруу / https биш / dashboard-аас хүрэхгүй — readiness анхааруулга |
| eBarimt асаахад «QPay хэлбэрт eBarimt код алга» | ТЕГ-ийн албан кодыг (plan T1) Төлбөрийн хэлбэр табд оноох |
