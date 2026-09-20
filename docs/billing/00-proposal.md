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
| `standard` | SaaS Standard (100,000₮/хэрэглэгч/сар) | ebarimt, ai, mcp | суудал = төлсөн тоо, компани 1 |
| `platform` | Нягтлангийн фирм, интеграцитай | standard + api.rest, multi_company, custom_extensions | суудал = төлсөн, компани 10 |
| `enterprise` | Гэрээт | бүгд | хязгааргүй |
| `dedicated` | Эх код авсан (dedicated deploy) | бүгд | хязгааргүй — энэ давхарга шалгахгүй |

Боломжийн түлхүүрүүд (`FeatureKey`): `ebarimt` · `ai` · `mcp` · `api.rest` ·
`multi_company` · `custom_extensions`. Хязгаар (`LimitKey`): `seats` · `companies`.

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
  admin UI БАЙХГҮЙ; Console `GET/PUT /api/platform/subscriptions` (Bearer
  `ENTRY_PLATFORM_API_KEY`, timing-safe, зөвхөн saas горимд, dedicated-д 404)
  дуудаж бүх байгууллагын жагсаалт (багц, статус, суудал, гишүүд, үүссэн огноо)
  авч subscription засна (багц, статус, суудал, хугацаа, override, тэмдэглэл,
  `actor`). Цөм `lib/billing/platform.ts`; өөрчлөлт сервер логт (аудитын мөр
  users FK-тай тул Console-ийн үйлдэл аудитад ордоггүй — `updated_by` null,
  `note`/лог). Console талын UI тусдаа repo-д.
- **Самбар/мэдэгдэл** — topbar-ийн доор баннер (trial ≤7 хоног, past_due,
  read-only) ба `attention.ts`-ийн `subscription.trial_ending` /
  `subscription.read_only` дохио (нүүр + өдөр тутмын мэдэгдэл, эзэн/админд).

## 6. Фаз 2 (энэ PR-д ОРООГҮЙ)

- Төлбөрийн гарц (QPay/карт) — статусыг автоматаар `active`/`past_due` болгох
- Usage metering (MCP дуудлага, extension ажиллалт) — үнэ тогтооход
- Console талын UI (жагсаалт + засах форм) — `entry-console` repo-д, дээрх API-гаар
- Нэхэмжлэх үүсгэх (суудал × үнэ) — Entry өөрийн АР-аараа

## 7. Шийдвэр шаардсан асуултууд

1. Trial-ийн боломж platform-тай ижил үү (одоогийн default), эсвэл standard уу?
2. Standard багцын компанийн тоо 1 үү — салбар/охин компани Platform-д л уу?
3. Grace 14 хоног зөв үү (татварын хугацаатай давхцахгүй байх)?
