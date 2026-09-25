# Billing / Entitlement давхарга — санал ба хэрэгжилт

Огноо: 2026-09-20 · Төлөв: **ХЭРЭГЖСЭН (фаз 1)** · Хамаарал:
`docs/ENTRY_PRODUCT_STRATEGY_MN.md` §5 (Standard / Builder багц),
`docs/New model/06-tiers.md` (SAAS / PLATFORM / ENTERPRISE түвшин),
`lib/deployment-mode.ts` (saas | dedicated).

## 1. Зорилго

Нэг кодын сан дээр хоёр төрлийн харилцагчид үйлчилнэ — **хольж хутгахгүй**:

| | SaaS (Entry-ийн үндсэн сервис) | Dedicated (эх код авсан харилцагч) |
|---|---|---|
| Хаана | Railway `entry-accounting`, олон байгууллага нэг DB | Тусдаа сервис + тусдаа DB |
| Хэн төлдөг | Байгууллага бүр багц × суудлаар (сар бүр) | Нэг удаагийн + суудлын subscription (гэрээгээр, Console/лиценз) |
| Entitlement | Энэ давхарга — байгууллага бүрийн `organization_subscriptions` | `dedicated` багц: бүх боломж, хязгааргүй; лиценз (`ENTRY_LICENSE`) л удирдана |

Зарчим (06-tiers.md-ийн батлагдсан санал):

1. **Нэг шалгах цэг** — `requireFeature()`, `assertWritesAllowed()`, `assertSeatAvailable()`
   (`lib/billing/guards.ts`). Код даяар `if plan === "platform"` тараахгүй.
2. **Нягтлан бодох ажлыг дунд нь БЛОКЛОХГҮЙ** — хязгаар хэтэрсэн / төлбөр хоцорсон
   ч тайлан унших, сар хаах, өгөгдлөө экспортлох үргэлж боломжтой. Хатуу хориг
   зөвхөн ШИНЭ бичилт (write/post) ба шинэ суудал/компанид.
3. **Хатуу vs зөөлөн:** суудлын хязгаар, компанийн тоо — хатуу (урилга/үүсгэлт
   зогсоно); төлбөрийн хоцрогдол — зөөлөн (`GRACE_DAYS` = 14 хоног анхааруулга,
   дараа нь read-only); trial дуусах — 7/3/1 хоногийн сануулга, дараа нь read-only.
4. **Trial 14 хоног** — өгөгдөл устгахгүй, зөвхөн бичих эрх хаагдана.
5. **Одоо ажиллаж буй байгууллагууд** — `organization_subscriptions` хүснэгт АНХ
   үүсэхэд бүх байгууллагад `standard` / `active` / суудал = гишүүдийн тоо
   (хугацаагүй) нөхөгдөнө — хэн ч гэнэт read-only болохгүй; platform admin дараа
   нь гараар тааруулна.
6. **Тохиргоо кодод, override DB-д:** багц бүрийн боломж/хязгаар `lib/billing/plans.ts`
   (хувилбартай хамт өөрчлөгдөнө); байгууллага бүрд `overrides` JSON-оор боломж
   нээх/хаах, хязгаар өөрчлөх (нэг харилцагчид API-г онцгойлон нээх г.м.).

## 2. Багцууд ба боломжууд

| Багц | Хэнд | Боломж | Хязгаар |
|---|---|---|---|
| `trial` | Шинэ SaaS байгууллага (14 хоног) | platform-тай ижил (бүгдийг туршина) | суудал 3, компани 1 |
| `standard` | SaaS Standard (default 100,000₮/хэрэглэгч/сар — §5-ийн үнийн давхаргаар тохируулагдана) | ebarimt, ai, mcp | суудал = төлсөн тоо, компани 1 |
| `platform` | Нягтлангийн фирм, интеграцитай | standard + api.rest, multi_company, custom_extensions | суудал = төлсөн, компани 10 |
| `enterprise` | Гэрээт | бүгд | хязгааргүй |
| `dedicated` | Эх код авсан (dedicated deploy) | бүгд, **мэдлэгийн сангаас бусад** | хязгааргүй — энэ давхарга шалгахгүй |
| `skills` | **«AI нягтлан»** — систем ашиглахгүй, мэдлэгийн санг өөрийн ChatGPT / Claude-д MCP-ээр (29,000₮/сар, trial **24 цаг**, 2026-09-24) | `knowledge`, `mcp` л — `accounting` ХААЛТТАЙ | суудал 1, компани 1 |

Боломжийн түлхүүрүүд (`FeatureKey`): `ebarimt` · `ai` · `mcp` · `api.rest` ·
`multi_company` · `custom_extensions` · `knowledge` · `accounting`. Хязгаар (`LimitKey`): `seats` · `companies`.

**Мэдлэгийн сан, «AI нягтлан» (2026-09-24):** `knowledge` нь SaaS-ийн нягтлан
бодох багц бүрд (trial/standard/platform/enterprise) ҮНЭГҮЙ дагалдана;
dedicated-д ОРОХГҮЙ (docs/knowledge D2′). `accounting` = нягтлан бодох систем
өөрөө — зөвхөн `skills` багцад унтраалттай: `requireModuleAction` (уншилт ч),
`ModuleGuard`, AI/MCP tool (`lib/billing/tool-scope.ts` — `tools/list` шүүгдэнэ,
`executeAiTool` хаана) бүгд хаагдаж, нүүр хуудас нь холбох заавар болно.
Мэдлэг нь захиалгын бүтээгдэхүүн тул read-only төлөвт (trial дууссан, төлбөр
хоцорсон…) ХААГДАНА (`featureUsable`). Бүртгэл: `/register?plan=skills` (зөвхөн
saas) → `organization_subscriptions` skills/trialing/+24ц. Trial-ийн дуусалт
ЯГ цагаар (`trialExpired`) — өмнө нь өдрөөр бөөрөнхийлж ~1 өдөр сунгадаг байв.

Статус (`SubscriptionStatus`): `trialing` · `active` · `past_due` · `suspended` ·
`cancelled`. Бичих эрх: `trialing` (хугацаанд), `active`, `past_due` (grace
дотор) → ✓; бусад → read-only.

## 3. Өгөгдөл

```
organization_subscriptions   organizationId (unique) · planId · status · seats ·
                             trialEndsAt · currentPeriodEnd · overrides (JSON:
                             { features?: {key: bool}, limits?: {key: number} }) ·
                             note · updatedBy · createdAt · updatedAt
```

Мөр байхгүй SaaS байгууллага = trial (`organizations.createdAt` + 14 хоног).
Суудлын хэрэглээ = гишүүд + хүлээгдэж буй урилга (үргэлж ШУУД тоологдоно,
кэшгүй).

## 4. Шалгах цэгүүд

| Цэг | Guard | Хориг |
|---|---|---|
| `requireModuleAction(key, "write"\|"post")`, `requireAnyModuleAction` | `assertWritesAllowed` | `[SUBSCRIPTION_READ_ONLY]` — бүх бичилт/батлалт (88+ зам) НЭГ цэгээс |
| `inviteMember` | `assertSeatAvailable` | `[SEAT_LIMIT]` |
| `createOrganization` (вэб + API/MCP) | `requireFeature("multi_company")` + `companies` хязгаар | `[FEATURE_NOT_IN_PLAN]` / `[COMPANY_LIMIT]` |
| REST `/api/v1` | `requireFeature("api.rest")` | HTTP 402 |
| MCP `/api/mcp` | `requireFeature("mcp")` | JSON-RPC -32003 |
| AI чат route | `requireFeature("ai")` | HTTP 402 |
| eBarimt enqueue | `hasFeature("ebarimt")` | илгээлт алгасна (борлуулалт зогсохгүй) |

Хамаарахгүй (үргэлж боломжтой): унших, тайлан, экспорт, сар хаах/нээх
(`requireRole`), байгууллагын удирдлага, өөрөө гарах, багцаа харах.

## 5. Удирдлага

- **Байгууллагын эзэн/админ** — `/settings/billing`: багц, статус, суудал
  (ашиглаж буй / төлсөн), trial-ийн үлдсэн хоног, боломжуудын жагсаалт, холбоо
  барих. Өөрөө багц солихгүй (төлбөрийн гарц фаз 2).
- **Entry Console** (Entry-ийн ажилтан — одоогоор эзэн өөрөө) — апп дотор platform
  admin UI БАЙХГҮЙ; Console `GET/PUT /api/platform/subscriptions` ба
  `GET/POST/DELETE /api/platform/plan-prices` (Bearer
  `ENTRY_PLATFORM_API_KEY`, timing-safe, зөвхөн saas горимд, dedicated-д 404;
  хаалга нь `lib/api/platform-auth.ts`)
  дуудаж бүх байгууллагын жагсаалт (багц, статус, суудал, гишүүд, үүссэн огноо)
  авч subscription засна (багц, статус, суудал, хугацаа, override, тэмдэглэл,
  `actor`). Цөм `lib/billing/platform.ts`; өөрчлөлт сервер логт (аудитын мөр
  users FK-тай тул Console-ийн үйлдэл аудитад ордоггүй — `updated_by` null,
  `note`/лог). Console талын UI тусдаа repo-д.
- **Үнэ — ОГНООТОЙ, ГУРВАН давхарга** (`lib/billing/pricing.ts` ЦЭВЭР, тесттэй;
  доошоо дардаг): ① `plans.ts`-ийн default (кодод, deploy-д л өөрчлөгдөнө) →
  ② `platform_plan_prices` ҮЕҮҮД (Console-оос, БҮХ харилцагчид нэг — deploy хэрэггүй) →
  ③ `organization_subscriptions.price_per_seat_mnt` (тухайн харилцагчийн тусгай
  үнэ: enterprise хэлэлцээр, хөнгөлөлт). `null` = үнэ ТОГТООГООГҮЙ
  (хэлэлцээрээр), **0₮ гэсэн үг БИШ**; хадгалагдсан мөрийн null нь ИЛ
  «цэвэрлэсэн» тул default руу буцахгүй. `/settings/billing`, AI-ийн
  `get_billing_overview`, Console-ийн жагсаалт гурвуулаа `resolveSeatPrice`-ээр
  НЭГ утга хардаг; сарын дүн = төлсөн суудал × үнэ (`monthlyAmountMnt`,
  аль нэг нь тодорхойгүй бол null — таамаглахгүй).
- **Үнийн ТҮҮХ (огноо).** Багцын үе бүр `effectiveFrom … effectiveTo`
  (ХАМРУУЛСАН; хоосон = хугацаагүй) мужтай: анх ямар үнэ тогтоосон нь
  хэвээр үлдэж, ирээдүйн үнийг урьдчилан оруулна. `priceAtDate(огноо)` нь
  тухайн өдрийг хамрах үеийг өгнө; хамрах үе БАЙХГҮЙ (цоорхой, эсвэл эхний
  үеэс өмнөх өдөр) бол кодын default үйлчилнэ — үнэ ЗОХИОХГҮЙ.
  Давхцлыг `planPriceChange` урьдчилж барина: (а) хугацаагүй байсан өмнөх үе
  дээр шинэ үе ХОЖУУ эхэлбэл өмнөхийг автоматаар өмнөх өдрөөр хааж үр дүнд ИЛ
  мэдэгдэнэ; (б) бусад ямар ч давхцлыг мөргөлдсөн үеийг нэрлэж ТАТГАЛЗАНА.
  Буруу оруулсныг `DELETE`-ээр устгана (түүх засах цорын ганц зам).
  API: `GET` (үеүд + өнөөдрийн үнэ + default), `POST` (үе нэмэх),
  `DELETE` (үе устгах).
- **Самбар/мэдэгдэл** — topbar-ийн доор баннер (trial ≤7 хоног, past_due,
  read-only) ба `attention.ts`-ийн `subscription.trial_ending` /
  `subscription.read_only` дохио (нүүр + өдөр тутмын мэдэгдэл, эзэн/админд).

## 6a. Багцаа QPay-ээр ӨӨРӨӨ төлөх — ХЭРЭГЖСЭН (2026-09-25)

Шийдвэр (product owner, 2026-09-25):

| # | Асуудал | Шийдвэр |
|---|---|---|
| P1 | Аль багц | `skills` («AI нягтлан»), `standard`, `platform`. Enterprise = гэрээ, trial/dedicated төлөгдөхгүй |
| P2 | Хугацаа | 1 / 3 / 6 / 12 сар, ХӨНГӨЛӨЛТГҮЙ — дүн = суудал × үнэ × сар |
| P3 | Grace | Төлсөн хугацаа дуусахад `skills` 3 хоног, бусад 14 (`graceDaysFor`) |

Урсгал: `/settings/billing` (эзэн/админ) → багц · суудал · сар → [QPay-ээр
төлөх] → Entry-ийн ӨӨРИЙН qpay-dashboard мерчант дээр нэхэмжлэх (QR + банкны
deeplink) → webhook `POST /api/billing/qpay/webhook?payment=<id>` (HMAC-SHA256,
`ENTRY_BILLING_QPAY_WEBHOOK_SECRET`) ЭСВЭЛ [Шалгах] (10 сек-д нэг) →
`markBillingPaymentPaid` НЭГ транзакцаар: төлбөр `paid` + subscription
`active`, `currentPeriodEnd` сунгагдана. «AI нягтлан»-ы нүүрнээс ч [QPay-ээр
төлөх] линк.

- **Хугацаа үргэлжилнэ:** туршилтын эцэс / ижил багцын `currentPeriodEnd`-ээс
  (эрт төлсөндөө хохирохгүй); хоцорсон, багц сольсон бол ОДООНООС (өнгөрсөнийг
  нөхүүлэхгүй). `addMonths` сарын сүүлийг хавчина
- **Идэвхтэй хугацаанд багц / суудал СОЛИХГҮЙ** — ижил нөхцлөөр л сунгана
  (пропорц тооцоо ЗОХИОХГҮЙ); өөрчлөлт Console-оор. Туршилт / хоцорсон /
  цуцалсан үед Standard ↔ Platform, суудал ≥ ашиглаж буй
- **`active` + `currentPeriodEnd` өнгөрсөн = `past_due`** (entitlements.ts) —
  grace-ийн дараа read-only. `currentPeriodEnd` null (Console-оор гараар
  удирддаг) active хөндөгдөхгүй
- **Үнэ ЗОХИОХГҮЙ:** `resolveSeatPrice` null (хэлэлцээрээр) бол товч идэвхгүй;
  байгууллагын тусгай үнэ зөвхөн ОДООГИЙН багцад
- **Мөнгө хэзээ ч алдагдахгүй:** хугацаа дууссан / цуцалсан нэхэмжлэхэд
  webhook ирвэл `paid` болно; дүн зөрвөл `failed` + шалтгаан (Console-оос
  шийднэ). Нэг байгууллагад нэг нээлттэй нэхэмжлэх (шинийг үүсгэхэд хуучин
  цуцлагдана). Суспенд хийсэн багц өөрөө төлж сэргэхгүй
- **Read-only үед ч ажиллана** — action нь `requireRole("admin")`,
  `requireModuleAction` (assertWritesAllowed) ДАЙРАХГҮЙ; дэмжлэгийн сессээр
  хаалттай
- Аудит `subscription` (`payment_created` / `paid` / `payment_amount_mismatch`
  / `webhook_rejected`); Console `GET /api/platform/organizations?id=` →
  `billingPayments` (сүүлийн 10) ба бүх байгууллагын жагсаалт
  `GET /api/platform/billing-payments[?organizationId=&status=&limit=]`
  (`lib/billing/platform-payments.ts` — QR/нууц буцаахгүй)

```
lib/billing/self-pay.ts        ЦЭВЭР (tests/billing-self-pay.test.ts): selfPayOptions,
                               planBillingPayment, applyPaidSubscription, addMonths
lib/billing/payment-store.ts   DB: env тохиргоо, нэхэмжлэх үүсгэх/шалгах/цуцлах,
                               markBillingPaymentPaid (идемпотент, FOR UPDATE)
lib/actions/billing-payment.ts Server Actions ({ error })
app/api/billing/qpay/webhook   payment.paid webhook
components/settings/billing-self-pay.tsx  форм + QR диалог + түүх
billing_payments               хүснэгт (schema.ts, apply-pending-ddl.mjs 10b)
```

Нээлттэй (дараагийн шат): Entry-ийн ӨӨРИЙН борлуулалтын eBarimt баримт,
хугацаа дуусахаас өмнөх сануулга (`attention.ts`), автомат сунгалт (карт).

## 6. Фаз 2 (энэ PR-д ОРООГҮЙ)

- ~~Төлбөрийн гарц (QPay/карт)~~ — QPay §6a-д хэрэгжсэн; карт / автомат сунгалт үлдсэн
- Usage metering (MCP дуудлага, extension ажиллалт) — үнэ тогтооход
- Нэхэмжлэх үүсгэх (суудал × үнэ) — Entry өөрийн АР-аараа

## 7. Шийдвэр шаардсан асуултууд

1. Trial-ийн боломж platform-тай ижил үү (одоогийн default), эсвэл standard уу?
2. Standard багцын компанийн тоо 1 үү — салбар/охин компани Platform-д л уу?
3. Grace 14 хоног зөв үү (татварын хугацаатай давхцахгүй байх)?
