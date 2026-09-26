# Мэдэгдлийн систем

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (§9d). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

### 9d. Мэдэгдлийн систем (Notifications) — фаз 0–2 ХЭРЭГЖСЭН

Баримт: `docs/notifications/00-proposal.md` (D1–D7 батлагдсан 2026-09-19).
Шинэ модуль биш — байгаа дохиог (аудит, нүүрний «Анхаарах», татварын
хуанли, лиценз/token) хэрэглэгчид ХҮРГЭДЭГ давхарга.

```
lib/notifications/
├── catalog.ts        Төрөл → категори, severity, шошго, default суваг (ЦЭВЭР)
├── types.ts          NotificationDraft, NotificationAudience (client-safe)
├── rules.ts          АУДИТ → мэдэгдлийн гүүрийн дүрэм (ЦЭВЭР, тесттэй)
├── attention.ts      «Анхаарах» дохионууд — НҮҮР + SCHEDULER НЭГ ЭХ (ЦЭВЭР, тесттэй)
├── recipients.ts     Гишүүд × audience → userId[] (эрхээр, actor хасна; тесттэй)
├── preferences.ts    channels JSON тайлбар (ЦЭВЭР, тесттэй)
├── emit.ts           Бичих цэг — dedupe upsert, mutedUntil/in-app шүүлт; ШИДЭХГҮЙ
├── bridge.ts         notifyFromAudit — logAuditEvent-ийн хажууд, entity-owner шийднэ
├── load-attention.ts Scheduler-ийн оролт (SQL count/min — П28)
├── scheduler.ts      runDailyNotifications — org × өдөр нэг удаа (notification_runs)
├── ticker.ts         In-process default scheduler (instrumentation.ts, 15 мин):
│                     өдрийн дүрмүүд (08:00 УБ-аас) + tick бүрд и-мэйлийн хүргэлт
├── email-plan.ts     И-мэйлийн хүргэлтийн ЦЭВЭР төлөвлөгч: instant / digest (цаг,
│                     өдөрт нэг) / off (тесттэй)
├── email-delivery.ts Resend-ээр хүргэнэ — emailedAt, digest булаалт
│                     (notification_runs job="digest", periodKey="<өдөр>:<userId>");
│                     илгээгч = нэхэмжлэхийн илгээгчтэй ИЖИЛ эрэмбэ (resolveInvoiceSender)
├── channel-delivery.ts Нэмэлт сувгууд (Telegram + custom/) — notification_deliveries
│                     (мэдэгдэл × суваг нэг мөр: deliveredAt / error / "skipped:…")
├── channels/telegram.ts Core Telegram суваг (TELEGRAM_BOT_TOKEN; webhook ШААРДАХГҮЙ —
│                     холболт getUpdates-аар: /start <код> → «Холболт шалгах»)
└── open-entity.ts    CLIENT: entityType → панель / href dispatcher

lib/custom/types.ts NotificationChannel { key, label, defaultEnabled?, deliver(ctx) →
                    "sent"|"skipped" } — EntryCustomization.notificationChannels[]
                    (validate: key ^[a-z][a-z0-9_]{1,31}$, core in_app/email/telegram-тэй
                    давхцахгүй; loader customNotificationChannels)
lib/actions/telegram-link.ts        start / verify / unlink (өөрийн тохиргоо)
lib/email/notification-template.ts  ЦЭВЭР загвар (тесттэй): subject-д ДҮН БАЙХГҮЙ
                                    (stripAmounts хамгаалалт), text + HTML
lib/actions/notifications.ts        list / unread count / markRead / markAllRead
lib/actions/notification-preferences.ts  get / save (upsert user×org)
app/api/cron/notifications/route.ts Bearer CRON_SECRET; ?job=daily|email|all; ?date=
scripts/run-notifications.ts        Гараар ажиллуулах (дүрэм + и-мэйл)
components/layout/notification-bell.tsx   Топбарын хонх (60 сек polling)
app/(dashboard)/notifications             Inbox (DataGridDynamic, FilterChips)
app/(dashboard)/settings/notifications    Тохиргоо: категори × (хонх Switch, и-мэйл
                                          select off/instant/digest), digest цаг, түр дуугүй
tests/notification-{rules,attention,recipients,email}.test.ts
```

Хатуу дүрмүүд:

- **Call site-д `emit` ГАР дуудахгүй.** Шинэ бичилтийн зам `logAuditEvent`
  дуудаж байвал мэдэгдэл автоматаар гүүрээр гарна — мэдэгдэл болгох эсэхийг
  ЗӨВХӨН `rules.ts`-д (entityType × action → төрөл, audience) нэмнэ
- **Анхаарлын/хугацааны дүрэм ЗӨВХӨН `attention.ts`-д** — нүүрний «Анхаарах»
  блок (`dashboardAlerts`) ба өдөр тутмын scheduler (`dailyNotificationDrafts`)
  хоёул нэг `attentionSignals`-аас; «хугацаа хэтэрсэн», «хуучирсан ноорог»
  (7 хоног), татварын шат (7/3/1/0), лиценз (30/7/1/0)-ийн тодорхойлолтыг
  хоёр газар давтахыг хориглоно
- **Мэдэгдэл ХЭЗЭЭ Ч шидэхгүй** (`emit`, `bridge`) — бичилт унахаас мэдэгдэл
  алдагдах нь дээр; tx дотор дуудагдвал ижил executor-оор бичигдэж хамт
  commit/rollback болно
- **dedupeKey ЗААВАЛ** — дүрмийн «байгалийн үе» (`tax:vat:2026-09:3`,
  `overdue:ar:2026-W41`, `close-due:2026-09`); unique INDEX
  `(organizationId, userId, dedupeKey)` — constraint биш (#5955)
- **Actor өөртөө мэдэгдэхгүй**; хүлээн авагч нь модульд ≥ түвшний эрхтэй
  гишүүд л (`selectRecipients` ↔ `lib/permissions.ts`); `doc.posted` зөвхөн
  ноорог үүсгэсэн хүнд (D4); `period.closed/reopened` бүх гишүүнд (D5)
- **Scheduler request scope-гүй:** `cookies()`, `revalidatePath()`,
  `getActiveOrg()` дуудахгүй — org параметрээр; «өнөөдөр» Улаанбаатараар.
  Идемпотент булаалт `notification_runs` (job, periodKey, org) unique —
  cron route, ticker, script гурвуул зэрэг дуудсан ч НЭГ л ажиллана
- **Хадгалалт:** уншсан 90, уншаагүй 180 хоног (D6) — өдрийн ажил цэвэрлэнэ
- **И-мэйл (D1):** default — хугацаа/аюулгүй байдал/хаалт instant, бусад
  digest (каталогийн `email`); хэрэглэгч категори бүрд off/instant/digest
  сонгоно. `emailedAt IS NULL` мөрүүд (3 хоногийн цонх) tick бүрд шалгагдана;
  instant ≤15 мин, digest хэрэглэгчийн `digestHour`-т өдөрт нэг. Гарчигт дүн
  бичихгүй; RESEND_API_KEY байхгүй бол суваг чимээгүй идэвхгүй (in-app хэвээр)
- **Фаз 2 дүрмүүд:** `doc.large_amount` (D2 — босго
  `company_settings.largeAmountAlertMnt`, default 10M₮; post/create_posted-д
  гүүр дүнг tx executor-оор уншина — commit-оос өмнөх мөр харагдана; эзэн/админд),
  `ai.drafts_created` (`executeAiTool` → `notifyAiDraft`: AI/MCP/REST-ээс ноорог
  үүсвэл модулийн ≥post гишүүдэд, actor хасна), `invoice.viewed` (нэхэмжлэхийн
  нээлттэй хуудас — аудитын үйл явдал биш тул шууд emit, үл хамаарах №1),
  `settings.ai_limit_changed` (§9-ийн батлах хязгаар өөрчлөгдөх —
  `updateCompanySettings`-ээс шууд emit, эзэн/админд; **actor-ыг ХАСАХГҮЙ** нь
  үл хамаарах №2: аюулгүй байдлын хяналт тул AI/MCP-ээр өөрчлөгдсөн үед
  token-ий эзэн өөрөө тэр даруй харах ёстой),
  `pos.qpay_paid_unfinalized` (QPay төлөгдсөн ч борлуулалт болоогүй ≥10 мин, pos write),
  `bank.unmatched` (импортоос 3 хоног), `fx.reval_due` (сарын сүүлийн 3 хоног),
  `fx.rate_missing` (ажлын өдөр, МБ ханш алга), `stock.negative` (долоо хоног тутам)
- **Нэмэлт суваг:** tick бүрд `deliverPendingChannels` — суваг × мэдэгдэл нэг л удаа;
  тохиргоо категори бүрд `channels: { telegram: bool, <custom>: bool }`
  (`isChannelEnabled`, default = сувгийн `defaultEnabled`); Telegram холбоогүй
  хэрэглэгчид "skipped"
- Env: `CRON_SECRET` (cron route нээнэ, байхгүй бол 503; `?job=daily|email|channels|all`),
  `NOTIFICATIONS_TICKER=off` (in-process ticker унтраана), `RESEND_API_KEY` +
  `RESEND_FROM_EMAIL` (и-мэйл суваг), `TELEGRAM_BOT_TOKEN` (Telegram суваг)
- Фаз 3 (SSE realtime, web push/PWA, approval workflow) — саналын §8
