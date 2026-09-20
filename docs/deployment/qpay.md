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

## 3. Урсгал (техник)

```
[QPay холбох] → state (AES-GCM: org, user, dashboard URL, 15 мин) → {dashboard}/connect?app=entry&callback&state&org
   → нэвтрэлт / онбординг → consent → POST /api/connect/approve → GET {entry}/api/pos/qpay/connect/callback?state&code
   → Entry сервер POST {dashboard}/api/connect/exchange {code, state} → {api_key, webhook_secret} (НЭГ удаа, 5 мин)
   → pos_settings (encryptSecret) + хэлбэр/данс seed + readiness → асаана → /inventory/sales?tab=settings&section=qpay&qpay=connected

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
