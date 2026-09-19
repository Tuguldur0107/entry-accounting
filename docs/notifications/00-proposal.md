# Мэдэгдлийн систем (Notifications) — Дизайны санал v1

**Төлөв:** **БАТЛАГДСАН (2026-09-19) — D1–D7 бүгд саналын дагуу; фаз 0–1 хэрэгжсэн** · **Огноо:** 2026-09-19
**Хамрах хүрээ:** in-app inbox (хонх) + и-мэйл + өдөр тутмын нэгтгэл (digest) + fork-д зориулсан суваг өргөтгөх цэг (Telegram, webhook). Web push / PWA хожим.
**Суурь:** одоо байгаа `audit_events` (74 бичих цэг), нүүрний самбарын «Анхаарах» / «Ажлын дараалал» дүрмүүд, `lib/tax/calendar.ts`, сар хаалтын checklist, Resend илгээгч — **шинэ модуль биш, байгаа дохиог хэрэглэгчид ХҮРГЭДЭГ давхарга**.

---

## 1. Хураангуй

Систем анхаарал шаардсан зүйлсээ **аль хэдийн мэддэг** — гэхдээ зөвхөн хэрэглэгч нүүр хуудсаа нээсэн агшинд, нэг л удаа тооцоолоод хаядаг (`app/(dashboard)/page.tsx` L450–586). Татварын хугацаа 3 хоног үлдсэн, авлага хэтэрсэн, ноорог батлагдаагүй, лиценз дуусах гэж байгаа — эдгээрийг хэрэглэгч **өөрөө орж ирж хайх** ёстой. Мэдэгдлийн систем үүнийг урвуулна: систем хэрэглэгч рүү очно.

| Асуудал | Одоо | Санал |
|---|---|---|
| Татварын хугацаа (НӨАТ 10, НДШ 5, ХАОАТ 10, ААНОАТ 20) | нүүрэн дээр л харагдана | 7/3/1 хоногийн өмнө + хугацаа өнгөрсөн өдөр мэдэгдэл; и-мэйлээр ч |
| Батлагдахыг хүлээж буй ноорог (журнал, АР/АП, касс, бараа) | тоолуур | батлах эрхтэй хүнд «N ноорог таныг хүлээж байна» — 7 хоногоос дээш хуучирсан бол анхааруулга |
| Хамт олны үйлдэл (батлав, буцаав, хаав, урив) | `audit_events`-д л | тухайн модульд эрхтэй бусад гишүүдэд in-app мэдэгдэл |
| Авлага/өглөгийн хугацаа хэтэрлээ | нүүрний карт | хэтэрсэн ӨДӨР нэг удаа + 7 хоног тутам сануулга |
| Харилцагч нэхэмжлэхийг үзлээ (`viewedAt`) | DB-д л | «Ганбат ХХК нэхэмжлэх INV-… үзлээ» |
| Лиценз / API token дуусах | дуусахад л мэдэгдэнэ (нэвтрэлт таслагдана) | 30/7/1 хоногийн өмнө admin-д |
| Сар хаалт | checklist | сарын 1-нд «N сарын хаалт эхлэх цаг боллоо» + алхам бүрийн төлөв; хаагдмагц бүх гишүүнд |
| AI агент ноорог үүсгэв (MCP/REST-ээс) | чатанд л | батлах эрхтэй хүнд «AI 3 ноорог үүсгэв — шалгана уу» |

Хэмжээ: **M (~9–11 ажлын өдөр)** гурван фазаар; фаз 0 (in-app + гол дүрмүүд) **4–5 өдөр**-т ашиглагдаж эхэлнэ.

Зардал: in-app — 0₮; и-мэйл — Resend-ийн одоогийн түлхүүр, өдрийн digest-ээр 10 гишүүнтэй байгууллага сард ~300 и-мэйл (free tier 3,000/сар); Telegram — үнэгүй bot API. Шинэ инфра (queue, Redis, cron сервис) **шаардлагагүй**.

---

## 2. Зарчим (repo-гийн дүрэмтэй нийцэл)

1. **Мэдэгдэл бизнесийн урсгалыг ХЭЗЭЭ Ч унагахгүй** — `logAuditEvent`-тэй ижил (`lib/audit.ts` L40–42): алдаа залгиж логлоно. Бичилт батлагдсан бол мэдэгдэл алдсан ч бичилт хүчинтэй.
2. **Дүрэм = цэвэр функц, тесттэй.** Ямар үйл явдал хэнд, ямар сувгаар очих нь `lib/notifications/rules.ts` (DB-гүй, `"use server"` биш) — `lib/tax/calendar.ts`, `lib/permissions.ts`-тэй ижил хэв маяг.
3. **Нэг эх сурвалж.** Нүүрний «Анхаарах»/«Ажлын дараалал» дүрмүүд болон өдөр тутмын мэдэгдлийн дүрмүүд **НЭГ** цэвэр функц (`lib/notifications/attention.ts`)-ээс гарна — тайлан = цэвэр функц дүрмийн адил. Хоёр газар хоёр өөр «хугацаа хэтэрсэн» тодорхойлолт байхыг хориглоно.
4. **Байгууллагаар тусгаарлагдсан, эрхээр шүүгдсэн.** Мэдэгдэл `organizationId` + `userId`-тай; хүлээн авагч нь тухайн модульд ≥ `read` эрхтэй гишүүд л (`hiddenModuleKeys`, `effectiveLevel`). ID нь эрх олгохгүй — унших/уншсан гэж тэмдэглэх зам бүр гишүүнчлэл шалгана.
5. **Өөрийн үйлдлээ өөртөө мэдэгдэхгүй** (actor хасагдана) — шуугиан = итгэл алдалт (2026-08 саналын «exception-first» зарчим).
6. **Идемпотент.** Дүрэм бүр «байгалийн үе»-тэй (`dedupeKey`): нэг татварын хугацаанд нэг л «7 хоног үлдлээ» мэдэгдэл; хуваарьт ажил дахин ажилласан ч давхардахгүй (unique INDEX, constraint биш — drizzle-kit #5955).
7. **Ханшийн модуль шиг «энгийн модуль»:** `lib/notifications/*` нь server action, cron, script, AI tool гурвуулаас шууд дуудагдана; `revalidatePath` request-ийн гадна шидэхийг try/catch-аар (`lib/actions/exchange-rates.ts` L171 хэв маяг).
8. **Tool давхарга нэг.** `list_notifications`, `mark_notifications_read` нь `lib/ai/tools.ts`-д нэмэгдэж чат, MCP, REST гурвуулд автоматаар очно (`allAiTools()`).
9. **custom/ өргөтгөх цэг:** fork-ууд өөрийн суваг (Telegram, Slack, webhook) `EntryCustomization.notificationChannels`-аар нэмнэ — core `custom/`-д бичихгүй.
10. **Дансны дугаар, дүнгийн босго кодод хатуу бичигдэхгүй** — «том дүн» мэдэгдлийн босго тохиргооноос (default `AI_POST_LIMIT_MNT`-тэй ижил 10M₮).

---

## 3. Мэдэгдлийн каталог

`category` нь тохиргооны матрицын мөр; `type` нь дүрмийн код. **Хүлээн авагч** = тухайн модульд заасан түвшнээс дээш эрхтэй гишүүд (actor-оос бусад). **Default суваг:** in-app бүгдэд; и-мэйл зөвхөн ⚑ тэмдэгтэйд (хугацаа, аюулгүй байдал, хаалт).

### 3.1 Үйл явдлын мэдэгдэл (event) — `audit_events`-ийн гүүрээр

| type | Дохио (entityType · action) | Хүлээн авагч | dedupeKey |
|---|---|---|---|
| `doc.posted` | journal/arap/cash · post, create_posted | модулийн ≥read | `post:<entityId>` |
| `doc.reversed` | * · reverse, fx_reverse, unpost | модулийн ≥read | `reverse:<entityId>` |
| `doc.large_amount` ⚑ | post + дүн ≥ босго (default 10M₮) | admin/owner | `large:<entityId>` |
| `ai.drafts_created` | create/create_invoice/create_voucher, actor = AI/MCP/REST (impersonation store) | ≥post эрхтэй | `ai-draft:<entityId>` |
| `po.approved` / `po.closed` / `gr.confirmed` | purchase_order · approve/close, goods_receipt · confirm | proc ≥read | `<action>:<entityId>` |
| `period.closed` ⚑ / `period.reopened` ⚑ | period · close/reopen | БҮХ гишүүн (02-period-close.md §8.3, Step 13) | `period:<code>:<action>` |
| `payroll.voucher_created` | payroll · create_voucher | payroll ≥post | `payroll:<period>` |
| `member.invited` / `member.role_changed` ⚑ | membership · permissions, invite | тухайн хэрэглэгч + admin | `member:<id>:<ts>` |
| `invoice.viewed` | `ar_ap_invoice_sends.viewedAt` анх бичигдэхэд (аудит биш — тусдаа emit) | ar ≥read | `viewed:<sendId>` |
| `invoice.link_expiring` | link `expiresAt` − 3 хоног | ar ≥write | `link-exp:<sendId>` |

Гүүр: `lib/audit.ts`-ийн `logAuditEvent` **өөрчлөгдөхгүй**; түүний хажууд `lib/notifications/bridge.ts` `notifyFromAudit(event)` дуудагдана — 74 бичих цэгийг ГАР ХӨНДӨХГҮЙ. Дүрэм `AUDIT_TO_NOTIFICATION` (цэвэр Map) таарахгүй үйл явдлыг чимээгүй алгасна.

### 3.2 Хуваарьт мэдэгдэл (scheduled) — өдөр бүр 08:00 Улаанбаатар

| type | Дүрэм (цэвэр, `attention.ts`) | Хүлээн авагч | dedupeKey |
|---|---|---|---|
| `tax.deadline` ⚑ | `computeTaxDeadlines(today)`: daysLeft ∈ {7, 3, 1, 0}; `prepared=false` бол өнгө улаан | tax/vat/payroll ≥write | `tax:<key>:<period>:<daysLeft>` |
| `tax.overdue` ⚑ | dueDate өнгөрсөн, marker (`vat-settlement:`, `payroll:`) байхгүй | admin + tax ≥post | `tax-overdue:<key>:<period>` |
| `arap.overdue` | posted/partially_paid, dueDate < today — хэтэрсэн ӨДӨР, дараа нь 7 хоног тутам | ar/ap ≥read | `overdue:<docId>:<weekNo>` |
| `drafts.stale` | ноорог ≥ 7 хоног хуучирсан (журнал/АР-АП/касс/бараа/ҮХ) | ≥post | `stale:<module>:<weekNo>` |
| `bank.unmatched` | тулгагдаагүй банкны мөр > 0, импортоос 3 хоног өнгөрсөн | cash ≥write | `unmatched:<statementId>` |
| `close.due` | сарын 1–5: өмнөх сар хаагдаагүй + checklist статус (`getMonthEndChecklist`) | admin + gl ≥post | `close-due:<period>` |
| `close.blocked` | `previous-open`, `open-purchase-orders`, ноорог үлдсэн — хаалтын оролдлого унасны дараа | оролдсон хэрэглэгч | `close-blocked:<period>:<code>` |
| `fx.rate_missing` | валюттай касс данстай байгууллагад өнөөдрийн МБ ханш `exchange_rates`-д алга (амралтын өдрөөс бусад) | cash ≥write | `fx-missing:<date>` |
| `fx.reval_due` | сарын сүүлийн 3 хоног, валютын дансанд тэгшитгэл хийгдээгүй | cash ≥post | `fx-due:<period>` |
| `stock.negative` | `findNegativeStock` (snapshot replay) | inv ≥write | `neg:<item>:<wh>:<date>` |
| `license.expiring` ⚑ | `deploymentLicenseStatus().expiresAt` − 30/7/1 | owner/admin | `license:<expiresAt>:<d>` |
| `token.expiring` | `api_tokens.expiresAt` − 7 | token эзэн | `token:<id>` |
| `digest.daily` ⚑ | дээрхийн нэгтгэл — «Өнөөдөр: 2 хугацаа, 5 ноорог, 3 хэтэрсэн авлага» (и-мэйл л, in-app биш) | тохиргоогоор | `digest:<userId>:<date>` |

`weekNo` = ISO долоо хоног — «7 хоног тутам» нь идемпотент.

---

## 4. Архитектур

```
Үйл явдал                          Хуваарь (өдөр бүр 08:00 UB)
 logAuditEvent(…)                   runDailyNotifications(today)
   └─ notifyFromAudit(ev)             ├─ org бүрд runAsOrg → attentionSignals(loaded)  ← НҮҮРТЭЙ НЭГ
        │                             └─ rules → notifications                            дүрэм
        ▼
 lib/notifications/emit.ts  emit({orgId, type, category, title, body, entityType, entityId, href, dedupeKey, audience})
        │  audience → memberships × permissions → userId[]  (actor хасна, preference шүүнэ)
        ▼
 notifications (user × org мөр)  ──►  in-app: хонх + /notifications + панель deep link
        │
        └─ delivery: preference-ээр
             ├─ email instant  (⚑ төрөл)     Resend, resolveNotificationSender (sender.ts өргөтгөл)
             ├─ email digest   (08:30 UB)    нэг и-мэйлд нэгтгэнэ
             └─ custom channel (fork)        EntryCustomization.notificationChannels[] — Telegram/webhook
```

### 4.1 Өгөгдлийн бүтэц (3 шинэ хүснэгт, өөрчлөлт бусдад БАЙХГҮЙ)

```
notifications              id uuid, organizationId → organizations (cascade), userId → users (cascade),
                           type text, category text, severity text (info|warning|danger),
                           title text, body text, href text?, entityType text?, entityId text?,
                           payload text? (JSON — дүн, огноо, харилцагч; UI/AI-д),
                           actorUserId text?, dedupeKey text,
                           readAt timestamp?, emailedAt timestamp?, createdAt timestamp default now()
                           uniqueIndex (organizationId, userId, dedupeKey) — "_ux"
                           index (userId, organizationId, readAt, createdAt desc)   ← хонхны тоолуур

notification_preferences   id, userId → users, organizationId → organizations,
                           channels text (JSON: category → {inApp: bool, email: "off"|"instant"|"digest"}),
                           digestHour int default 8 (UB цаг), telegramChatId text? (фаз 2),
                           mutedUntil timestamp?, updatedAt
                           uniqueIndex (userId, organizationId) — ai_settings-тэй ИЖИЛ загвар

notification_runs          id, organizationId?, job text ("daily" | "digest"), periodKey text (YYYY-MM-DD),
                           startedAt, finishedAt?, error text?
                           uniqueIndex (job, periodKey, organizationId) — нэг өдөр нэг л ажил
```

- `users`, `memberships`, `audit_events` ХӨНДӨГДӨХГҮЙ.
- Хадгалалт: уншсан мэдэгдэл 90 хоног, уншаагүй 180 хоног — өдрийн ажил цэвэрлэнэ (тохиргоо `NOTIFICATION_RETENTION_DAYS`).
- DDL `scripts/apply-pending-ddl.mjs`-д идемпотентээр (`create table if not exists`, `create unique index if not exists`) + `schema.ts` — preDeploy дүрэм (CLAUDE.md).

### 4.2 Хуваарьт ажлын хөдөлгүүр — ГУРВАН эх нэг зам

Cron сервис одоо БАЙХГҮЙ (railway.toml, GitHub schedule аль нь ч). Санал:

| Зам | Хэрэглээ |
|---|---|
| `POST /api/cron/notifications?job=daily\|digest` — `Authorization: Bearer $CRON_SECRET` (health route шиг `force-dynamic`, proxy matcher `/api`-г алгасдаг тул өөрөө шалгана) | **Каноник оролт**; Railway cron service / GitHub Actions `schedule` / гараар curl |
| `instrumentation.ts` → `startNotificationTicker()` (beacon-тэй ижил: `started` guard, `setInterval` 15 мин, `unref`) | **Default (0 тохиргоо)** — fork бүрд cron тохируулахгүйгээр ажиллана; ажил ажиллуулах эсэхийг `notification_runs` unique + `pg_try_advisory_lock(<түлхүүр 6>)`-ээр шийднэ → олон instance давхардахгүй (периодын lock түлхүүр 5-ыг дараалуулна) |
| `scripts/run-notifications.ts` | backfill, тест, дэмжлэг |

Гурвуулаа `lib/notifications/scheduler.ts` `runJob(job, today)`-г дуудна. «Өнөөдөр» = Улаанбаатарын огноо (FX тэгшитгэлтэй ижил).

### 4.3 Хүлээн авагч ба эрх

```
audience = { moduleKey, minLevel: "read"|"write"|"post", roles?: MembershipRole[], userIds?: string[] }
resolveAudience(orgId, audience, actorUserId) → memberships → effectiveLevel ≥ minLevel → actor хасна
```

Цэвэр `resolveAudience` тест: viewer-т `post` шаардсан мэдэгдэл очихгүй; owner/admin үргэлж; permissions JSON-оор `none` болгосон модулийн мэдэгдэл очихгүй (навигациас нуугдсан модулийн шуугиан үгүй).

### 4.4 Сувгууд

- **In-app (фаз 0):** `notifications` мөр = мэдэгдэл. Хонхны тоолуур layout-д server талаас (`count where readAt is null`) + client 60 сек polling (`useSyncExternalStore`, sound-toggle хэв маяг). Realtime SSE хожим (шаардлага гарвал).
- **И-мэйл (фаз 1):** `lib/email/sender.ts` `resolveInvoiceSender`-ийг ерөнхий `resolveSender(purpose)` болгож дахин ашиглана (tenant → env → алдаа; sandbox fallback хориотой хэвээр). Загвар: plain text + нэг энгийн HTML wrapper (`lib/email/templates/notification.ts`, цэвэр, тесттэй) — гарчигт **дүн бичихгүй** (и-мэйл нь нууцлалгүй суваг), body-д товч + нэвтрэлт шаардсан deep link. Илгээлт `emailedAt`-д тэмдэглэгдэнэ; Resend алдаа `translateResendError`-оор логлогдоно, мэдэгдэл in-app-д үлдэнэ.
- **Digest (фаз 1):** и-мэйлийн default горим — өдөрт нэг захиа, төрлөөр бүлэглэсэн; instant зөвхөн ⚑ (хугацаа/аюулгүй байдал/хаалт). Зардал, шуугиан хоёуланг хазаарлана.
- **Custom суваг (фаз 2):** `lib/custom/types.ts`-д

  ```ts
  export interface NotificationChannel {
    key: string;                       // "telegram", "webhook"
    label: string;                     // тохиргооны UI-д
    deliver(ctx: NotificationContext): Promise<void>;   // алдаа залгигдана, логлогдоно
  }
  EntryCustomization.notificationChannels?: NotificationChannel[]
  ```

  Core-д **Telegram bot суваг** мөн энэ interface-ээр (`lib/notifications/channels/telegram.ts`, `TELEGRAM_BOT_TOKEN` env, хэрэглэгч `/settings/notifications`-д bot-оос авсан кодоо оруулж chat-аа холбоно). Монголд Telegram нь и-мэйлээс илүү өдөр тутмын суваг тул фаз 2-т ОРУУЛАХЫГ зөвлөж байна.
- **Web push / PWA:** manifest, service worker, VAPID — одоо огт байхгүй; хэрэгцээ баталгаажсаны дараа фаз 3.

### 4.5 UI

| Хэсэг | Хаана | Хэрэгжилт |
|---|---|---|
| Хонх + тоолуур | `app/(dashboard)/layout.tsx` L112–139, `<AiChatButton />`-ийн хажууд | `components/layout/notification-bell.tsx` — `ai-chat-button.tsx` хэв маяг; `bell` icon `icon-registry.ts`-д 3 газар (import, `ICONS`, `ICON_CATALOG` — `tests/icon-kit.test.ts` шаардана) |
| Popover | хонх дарахад | сүүлийн 10, severity өнгө (`--ea-warning-fg`/`--ea-danger-fg` ТЕКСТ токен), «Бүгдийг уншсан», «Бүгдийг харах» |
| `/notifications` хуудас | нав: топбарын хонх (модулийн цэс биш) | `DataGridDynamic` (огноо · төрөл · гарчиг · төлөв), `FilterChips` (Бүгд / Уншаагүй / категори), давхар даралт → панель |
| Deep link | мэдэгдэл дарахад | `lib/notifications/open-entity.ts` `openPanelForEntity(entityType, entityId)` → `openVoucherPanel`, `openArapDocPanel`, `openCashDocPanel`, `openFaAssetPanel`, `openPurchaseOrderPanel`, `openGoodsReceiptPanel`, `openCostEntryPanel`; панельгүй төрөл (`period`, `payroll`, `inventory`…) → `href` |
| Тохиргоо | `/settings/notifications` (`modules.ts` settings items-д нэг мөр) | категори × суваг матриц (`Switch`), digest цаг, Telegram холболт, «Түр дуугүй» (`mutedUntil`); `company-settings-form.tsx` хэв маяг, `requireModuleAction` биш — өөрийн тохиргоо тул зөвхөн `getActiveOrg` |
| Toast | өөрийн session-д шинэ мэдэгдэл ирвэл (polling) | sonner + `feedback` дуу (`ea-sound` toggle хүндэтгэнэ) |
| Нүүр | «Анхаарах» блок | `attention.ts`-ээс уншдаг болно (өөрчлөлт харагдахгүй, эх сурвалж нэг болно) |

Шинэ component/icon зохиохгүй — `Icon`, `IconAction`, `StatusBadge`, `EmptyState`, `PageTabs`, `FilterChips`, `useConfirm` л.

### 4.6 AI / MCP / REST

- `list_notifications({unreadOnly?, category?, limit})`, `mark_notifications_read({ids | all})` — `lib/ai/tools.ts`-д (аль ч горимд; журнал үүсгэхгүй).
- `buildDynamicContext` (system prompt)-д «уншаагүй мэдэгдэл: N, хамгийн ойрын хугацаа: НӨАТ 3 хоног» нэг мөр — агент өөрөө «НӨАТ-ын тооцоо хийе үү?» гэж санал болгож чадна.
- AI/MCP/REST-ээс үүссэн ноорог (`impersonation` store байгаа = хүн биш) `ai.drafts_created`-аар батлах эрхтэй хүнд очно — §9 human-in-the-loop-ийг «хэн ч анзаараагүй ноорог»-оос хамгаална.

### 4.7 Файлын бүтэц

```
lib/notifications/
├── types.ts          NotificationType/Category/Severity, Audience, EmitInput (client-safe)
├── catalog.ts        NOTIFICATION_CATALOG — төрөл → категори, severity, default суваг, монгол шошго (ЦЭВЭР)
├── rules.ts          AUDIT_TO_NOTIFICATION гүүрийн дүрэм + хугацааны дүрмүүд (ЦЭВЭР, тесттэй)
├── attention.ts      attentionSignals(loaded, today) — нүүр + scheduler НЭГ эх (ЦЭВЭР, тесттэй)
├── audience.ts       resolveAudience — memberships × permissions (DB давхарга, тесттэй хэсэг цэвэр)
├── emit.ts           emit() — dedupe upsert, preference шүүлт, delivery fan-out; ХЭЗЭЭ Ч шидэхгүй
├── bridge.ts         notifyFromAudit(event) — logAuditEvent-ийн хажууд дуудагдана
├── scheduler.ts      runJob("daily"|"digest", today) — advisory lock + notification_runs
├── digest.ts         buildDigest(notifications) → subject/body (ЦЭВЭР, тесттэй)
├── open-entity.ts    CLIENT: entityType → панель dispatcher
└── channels/
    ├── email.ts      Resend, resolveSender, translateResendError
    └── telegram.ts   (фаз 2) NotificationChannel

lib/actions/notifications.ts   listNotifications, markRead, markAllRead, getPreferences, savePreferences
app/api/cron/notifications/route.ts
app/(dashboard)/notifications/page.tsx
app/(dashboard)/settings/notifications/page.tsx
components/layout/notification-bell.tsx
components/notifications/{notification-list.tsx, notification-preferences-form.tsx}
scripts/run-notifications.ts
tests/{notification-rules,notification-attention,notification-audience,notification-digest}.test.ts
```

---

## 5. Тоон жишээ — нэг өдөр

Байгууллага «Жишээ ХХК»: owner Б.Тугулдур, accountant Д.Сараа (бүх модуль post), viewer О.Бат (зөвхөн read, payroll `none`).
Өнөөдөр 2026-10-07 (Мягмар). Тохиргоо default.

| Цаг | Юу болов | Хэнд, ямар сувгаар |
|---|---|---|
| 08:00 | Scheduler `daily`: НӨАТ 2026-09 хугацаа 10-10 → daysLeft 3, `vat-settlement:2026-09` marker байхгүй | `tax.deadline` ⚑ → Тугулдур, Сараа (tax ≥write); Бат ҮГҮЙ (viewer). In-app + instant и-мэйл |
| 08:00 | АР INV-26-000041 dueDate 09-30 хэтэрсэн, weekNo 41 | `arap.overdue` → гурвуулд in-app (ar ≥read); и-мэйл digest-д |
| 08:00 | 3 ноорог журнал 09-28-аас хойш хүлээгдэж байна | `drafts.stale` → Тугулдур, Сараа |
| 08:30 | `digest` ажил | Сараа-д нэг и-мэйл: «Өнөөдөр: НӨАТ 3 хоног · 1 хэтэрсэн авлага · 3 хуучирсан ноорог» |
| 10:12 | Сараа GL-26-000118 (12.4M₮) батлав | `doc.posted` → Тугулдур, Бат in-app (Сараа өөрөө ҮГҮЙ); `doc.large_amount` ⚑ → Тугулдур (admin) и-мэйл instant |
| 11:40 | MCP-ээс AI агент 2 АП ноорог үүсгэв | `ai.drafts_created` → Тугулдур, Сараа (≥post): «AI 2 ноорог үүсгэв — шалгана уу» → дарахад `openArapDocPanel` |
| 14:05 | Ганбат ХХК и-мэйлээр очсон INV-26-000039 линкийг нээв (`viewedAt`) | `invoice.viewed` → Тугулдур, Сараа, Бат (ar ≥read) |
| 16:30 | Тугулдур 2026-09 сарыг хаав | `period.closed` ⚑ → Сараа, Бат in-app + и-мэйл instant (Тугулдур өөрөө ҮГҮЙ) |
| 10-08 08:00 | НӨАТ daysLeft 2 → дүрэм {7,3,1,0}-д ороогүй → мэдэгдэл ҮГҮЙ; 10-09 → daysLeft 1 → дахин | dedupeKey `tax:vat:2026-09:1` |

Идемпотент шалгалт: 08:00-ийн ажил алдаагаар 08:07-д дахин ажиллавал `notification_runs (daily, 2026-10-07, org)` unique → алгасна; мөр дахин бичих гэж оролдвол `(org, user, dedupeKey)` unique → `on conflict do nothing`.

---

## 6. Батлагдсан дүрмүүдтэй нийцэл

- **§9 human-in-the-loop:** мэдэгдэл бичилт ҮҮСГЭХГҮЙ, батлахгүй — зөвхөн хүнийг дууддаг. `ai.drafts_created` нь ноорог-first бодлогыг бататгана.
- **Period guard, journal-balance, permissions** хөндөгдөхгүй — мэдэгдэл бүх guardrail-ийн ДАРАА, commit-ийн дараа (`afterJournalPost`-той ижил байрлал).
- **Аудит:** мэдэгдэл өөрөө аудитын үйл явдал БИШ (шуугиан); илгээлтийн алдаа `console.error` + `notification_runs.error`.
- **Fork:** core `custom/`-д бичихгүй; суваг interface-ээр нэмэгдэнэ; `upstream-sync` merge-д саадгүй.
- **Нэг эх сурвалж:** нүүрний «Анхаарах» блок `attention.ts` руу шилжинэ — давхар тодорхойлолт үлдэхгүй.
- **Snapshot + delta:** хуваарьт дүрмүүд `loadBalanceRowsFast`, `loadQtyBalancesFast`, `loadVoucherSummaries` (П28) ашиглана — ваучер JS-д ачаалахгүй; 100 байгууллагатай deploy-д daily ажил секундэд багтана.

---

## 7. Product owner-ийн шийдвэрүүд (2026-09-19 — бүгд саналын дагуу БАТЛАГДСАН)

| # | Асуулт | Санал (default) |
|---|---|---|
| D1 | И-мэйл default: instant ⚑ + бусад digest-ээр — эсвэл бүгд зөвхөн in-app, и-мэйлийг хэрэглэгч өөрөө асаах уу? | **⚑ instant + digest default ON** — татварын хугацаа алдах нь торгуультай (0.1%/хоног), хэрэглэгч тохиргооноос унтраана |
| D2 | `doc.large_amount` босго — тохиргоо `company_settings.largeAmountAlertMnt` (default 10M₮ = `AI_POST_LIMIT_MNT`) уу, эсвэл фаз 0-д хасах уу? | Тохиргоотой оруулах (эзэнд хамгийн үнэ цэнтэй мэдэгдэл) |
| D3 | Telegram суваг фаз 2-т core-д орох уу (`TELEGRAM_BOT_TOKEN` deployment env), эсвэл custom/-д жишээ багц болох уу? | **Core** — Монголын зах зээлд ялгарах давуу тал; env байхгүй бол суваг тохиргоонд харагдахгүй |
| D4 | `doc.posted`-ийг бүх посттой холбох уу (шуугиан их) эсвэл зөвхөн ноорог хүлээж байсан хүнд «таны ноорог батлагдлаа» + large_amount уу? | **Хоёр дахь** — exception-first; бүх посттой мэдэгдлийг категори тохиргоогоор OFF default |
| D5 | `period.closed` бүх гишүүнд (viewer-т ч) очих уу? | Тийм — 02-period-close.md §8.3 «stakeholders» |
| D6 | Хадгалалт 90/180 хоног — эсвэл аудит шиг устгахгүй юу? | 90/180 — мэдэгдэл нь баримт биш, аудитын мөр `audit_events`-д хэвээр |
| D7 | Scheduler default нь in-process ticker (0 тохиргоо) — Railway cron service давхар тохируулах уу? | Ticker default; `docs/deployment/README.md`-д cron сервисийн заавар (сонголт) |

---

## 8. Хэрэгжүүлэлтийн төлөвлөгөө

| Фаз | Агуулга | Хэмжээ |
|---|---|---|
| **0 — In-app цөм** ✅ ХЭРЭГЖСЭН | Schema 3 хүснэгт + pending DDL; `catalog/rules/attention/audience/emit/bridge/scheduler`; `notifyFromAudit` гүүр (post/reverse/close/approve/invite); daily дүрмүүд: tax.deadline, tax.overdue, arap.overdue, drafts.stale, close.due, license.expiring, token.expiring; хонх + popover + `/notifications` + `open-entity` dispatcher; `bell` icon; нүүрний «Анхаарах»-ыг `attention.ts` руу; cron route + ticker + script; тестүүд; CLAUDE.md §9d | 4–5 өдөр |
| **1 — И-мэйл + тохиргоо** ✅ ХЭРЭГЖСЭН | `notification_preferences` UI (`/settings/notifications`), `resolveSender` ерөнхийлөх, HTML wrapper, instant + digest, `emailedAt`, `mutedUntil`; AI tools `list_notifications` / `mark_notifications_read`; system prompt мөр | 3 өдөр |
| **2 — Сувгууд + нэмэлт дүрэм** | `NotificationChannel` interface (`lib/custom/types.ts`, validate, loader); Telegram суваг + холболт; `invoice.viewed`, `ai.drafts_created`, `bank.unmatched`, `fx.rate_missing`, `fx.reval_due`, `stock.negative`, `doc.large_amount` (D2); toast + дуу | 2–3 өдөр |
| **3 — Хожим** | SSE realtime (polling-ийн оронд), Web push/PWA, «Approval pending» урсгал (05-event-flows.md Step 7 — тусдаа санал), Slack | шаардлага гарвал |

**v1-д хамрахгүй:** approval workflow (батлах хүсэлт/эрх дараалал — тусдаа объект), SMS, харилцагч руу автомат сануулга (dunning — АР модулийн тусдаа санал), олон хэл.

---

## 9. Тест

| Файл | Юуг батална |
|---|---|
| `tests/notification-rules.test.ts` | аудит → мэдэгдэл гүүр: таарахгүй action алгасна; reverse нь эх модулиа өвлөнө; actor хасагдана |
| `tests/notification-attention.test.ts` | tax {7,3,1,0} хоног л; overdue долоо хоног тутам; stale 7 хоног; сарын 1–5 close.due; нүүрний alerts-тай ижил гаралт |
| `tests/notification-audience.test.ts` | viewer/none/post шүүлт, owner үргэлж, actor хасна |
| `tests/notification-digest.test.ts` | бүлэглэл, гарчигт дүн байхгүй, хоосон бол илгээхгүй |
| `tests/icon-kit.test.ts` | `bell` каталогт (одоогийн тест автоматаар) |
| DB integration (`DATABASE_URL` байгаа үед) | dedupe unique, run unique, org isolation (`org-isolation.test.ts`-д нэмэлт case) |

---

## 10. CLAUDE.md-д нэмэгдэх дүрэм (батлагдсаны дараа)

- §9d «Мэдэгдэл»: шинэ бичилтийн зам `logAuditEvent` дуудаж байвал мэдэгдэл автоматаар (гүүрээр) гарна — гүүрийн дүрэм `rules.ts`-д л нэмнэ, call site-д `emit` ГАР дуудахгүй.
- Хугацааны/анхаарлын дүрэм ЗӨВХӨН `attention.ts`-д — нүүр, scheduler, AI гурвуул үүнээс уншина.
- Мэдэгдэл ХЭЗЭЭ Ч шидэхгүй; и-мэйлийн гарчигт дүн бичихгүй; dedupeKey ЗААВАЛ.
- Unique нь INDEX (`_ux`), constraint биш.
