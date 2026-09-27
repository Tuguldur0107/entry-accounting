# Landing-ийн чат — нийтийн өрөө + хувийн яриа (entry.mn)

> `CLAUDE.md` §9f-ийн дэлгэрэнгүй. Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д бий — хоёуланг ЗЭРЭГ шинэчилнэ.

## Зорилго

Эхний үе шатанд entry.mn-д орсон **бүртгэлгүй** хүн шууд асуулт тавьж, Entry
баг хариулдаг байх. Бүртгэлийн funnel-ийн өмнөх «асуух» алхам.

| | Нийтийн өрөө (`room`) | Хувийн яриа (`private`) |
|---|---|---|
| Хэн хардаг | Бүх зочин | Тухайн зочин + Entry баг |
| Нэвтрэлт | Байхгүй — нэр (сонголтоор) | Байхгүй — утас/и-мэйл сонголтоор |
| Холбоос | ХОРИОТОЙ | Зөвшөөрнө |
| Хувийн мэдээлэл | Утас, и-мэйл, РД, данс АВТОМАТААР нуугдана | Хэвээр |
| Хариу | Entry баг (Telegram Reply / `/room` / Console) | Entry баг (Telegram Reply / Console) |

**AI автоматаар ХАРИУЛАХГҮЙ** — Entry сервер AI-ийн API дуудахгүй (§9a). Хариуг
зөвхөн хүн бичнэ.

## Урсгал

```
entry.mn widget ──(CORS, x-visitor-token)──► /api/public-chat/*  ──► DB (public_chat_*)
                                                   │ after()
                                                   ▼
                                  Telegram багийн групп (тусдаа bot)
                                  Reply / /room / [Нуух] [Зочныг хаах]
                                                   │ webhook
                                                   ▼
                                   /api/public-chat/telegram ──► DB
Entry Console ──(Bearer)──► /api/platform/public-chat  (жагсаалт, хариу, модерац)
```

1. Зочин анх бичихдээ Cloudflare Turnstile давж `POST /session` → `visitorToken`
   (localStorage; DB-д sha256). Нэг зочин = нэг хөтөч.
2. Өрөө: `POST /room` → шууд харагдана (post-moderation). Хувийн: `POST /private`
   → зочин бүрд НЭГ яриа (дахин бичихэд үргэлжилнэ, хаагдсан бол нээгдэнэ).
3. Хариу commit-ийн ДАРАА (`after()`) багийн групп руу relay — Telegram унасан ч
   зочны мессеж алдагдахгүй (`telegramMessageId` null үлдэж Console
   `unrelayed24h`-д тоологдоно).
4. Баг relay мессеж дээр **Reply** хийнэ → тэр зочин/өрөөнд «Entry баг» нэрээр.
   Ажилтны нэр (`staffName`) зөвхөн Console-д.
5. Зочин 5 сек тутам `GET ?after=` polling (SSE дараа, урсгал өсвөл).

## API

Нийтийн (нэвтрэлтгүй, **зөвхөн saas** — dedicated deploy-д 404):

| Метод, зам | Тайлбар |
|---|---|
| `POST /api/public-chat/session` `{turnstileToken}` | → `{visitorToken}`; хүчинтэй токентой бол `reused` |
| `GET /api/public-chat/room[?after=ISO]` | → `{messages, hiddenIds}`; `after`-аас хойш НУУГДСАН id-г нээлттэй табаас арилгана |
| `POST /api/public-chat/room` `{name?, body}` | x-visitor-token |
| `GET /api/public-chat/private[?after=ISO]` | → `{thread, messages}` |
| `POST /api/public-chat/private` `{body, name?, email?, phone?}` | x-visitor-token |
| `POST /api/public-chat/telegram` | Telegram webhook (`X-Telegram-Bot-Api-Secret-Token`) |

Console (Bearer `ENTRY_PLATFORM_API_KEY`, `platformGate`):

| | |
|---|---|
| `GET /api/platform/public-chat?view=threads[&status=open\|closed]` | яриа бүр: `awaitingReply`, `lastBody`, `messageCount`, `visitorBlocked`, `registeredUserId` (ижил и-мэйлээр бүртгүүлсэн хэрэглэгч — УНШИХДАА тулгана, бичихгүй) + `unrelayed24h` |
| `GET ?threadId=` | яриа + бүх мессеж (`staffName`, `relayed`) |
| `GET ?view=room[&before=ISO]` | өрөө, НУУСАН мессеж ч (сэргээхэд) |
| `POST {action, actor, …}` | `reply` · `room_post` · `hide`/`unhide` · `block`/`unblock` · `close`/`reopen`; Console-ийн хариу группт мөн толин харагдана |

Telegram болон Console НЭГ store функцээр (`lib/public-chat/store.ts`) — тусдаа логик бичихгүй.

## Хамгаалалт (дараалал нь `lib/public-chat/http.ts`)

- **CORS** — зөвхөн `PUBLIC_CHAT_ALLOWED_ORIGINS` (default `https://entry.mn`,
  `https://www.entry.mn`); өөр origin-оос ирсэн хөтчийн хүсэлт 403
- **Turnstile** — сесс үүсгэхэд НЭГ удаа (`TURNSTILE_SECRET_KEY` байхгүй бол
  алгасна — dev; production-д ЗААВАЛ)
- **Rate limit** (IP, in-memory — `PUBLIC_CHAT_LIMITS`): унших 60/мин, сесс 10/цаг,
  өрөө 5/мин + 30/цаг, хувийн 20/10мин, шинэ яриа 3/цаг
- **Давхардал** — ижил зочин ижил текст 60 сек дотор
- **Нэр** — багийн нэр дуурайхыг хориглоно (entry, админ, support, дэмжлэг …);
  багийн мессеж ҮРГЭЛЖ «Entry баг», `author = team`
- **Удирдах тэмдэгт** (zero-width, bidi override) арилна; текст ≤1000, нэр ≤40
- **Модерац** — [Нуух] (өрөөний нэг мессеж), [Зочныг хаах] (тэр хөтөч бичих
  эрхгүй + нийтийн мессеж нь бүгд нуугдана; ижил IP-гээс 24 цаг шинэ сесс
  олгохгүй). Хувийн яриаг нуухгүй
- **Нууцлал** — IP зөвхөн `sha256(AUTH_SECRET|ip)`, токен sha256; зочинд буцаах
  DTO-д `staffName`, `visitorId`, Telegram id ОРОХГҮЙ

Хувийн мэдээлэл нуух (`maskPersonalData`) — ТЕСТТЭЙ, санаатай болгоомжтой:
5–9-өөр эхэлсэн 8 оронтой тоо = утас, 9+ залгаа цифр эсвэл 4-4-4 бүлэг = данс/карт,
үгийн эхний 2 кирилл үсэг + 8 цифр = РД. Зайтай дүн (`150 000 000`), 1-ээр
эхэлсэн 8 орон (`10000000`) хөндөгдөхгүй. Дүрэм өөрчлөхдөө `tests/public-chat.test.ts`-д жишээ нэмнэ.

## DB

`public_chat_visitors` (token_hash unique, ip_hash, blocked_at/by, last_seen_at) ·
`public_chat_threads` (visitor_id unique — зочинд НЭГ, name, email, phone, status
open|closed, last_message_at) · `public_chat_messages` (scope room|private,
thread_id ↔ scope-ийг store сахина, author visitor|team, name, staff_name, body,
masked, reply_to_id self-FK, telegram_message_id partial unique — webhook дахин
ирэхэд давхар бичихгүй, hidden_at/by). organizationId БАЙХГҮЙ — платформын
түвшин, харилцагчийн өгөгдөлтэй холбоогүй; org purge-д хамаарахгүй.

## Тохиргоо (Railway `entry-accounting`, saas)

```
PUBLIC_CHAT_TELEGRAM_BOT_TOKEN=      # @BotFather — мэдэгдлийн bot-оос ТУСДАА bot
PUBLIC_CHAT_TELEGRAM_CHAT_ID=        # багийн групп (-100…); bot-ыг группт нэмнэ
PUBLIC_CHAT_TELEGRAM_WEBHOOK_SECRET= # 16–256, A-Z a-z 0-9 _ -
TURNSTILE_SECRET_KEY=                # Cloudflare Turnstile (site key нь landing-д)
PUBLIC_CHAT_ALLOWED_ORIGINS=         # сонголтоор; default entry.mn + www
```

Deploy-ийн дараа НЭГ удаа: `node scripts/public-chat-telegram-webhook.mjs https://app.entry.mn`.

**Яагаад тусдаа bot:** мэдэгдлийн bot (`TELEGRAM_BOT_TOKEN`) холболтын кодоо
`getUpdates`-ээр уншдаг — webhook тавибал тэр урсгал эвдэрнэ.

Группийн chat id олох: bot-ыг группт нэмээд группт `/help` бичээд
`https://api.telegram.org/bot<TOKEN>/getUpdates` (webhook тавихаас ӨМНӨ) → `chat.id`.

## Файлууд

```
lib/public-chat/rules.ts     ЦЭВЭР: шалгалт, нуух, холбоос, Telegram update parser, relay текст
lib/public-chat/store.ts     DB: зочин, өрөө, яриа, багийн хариу, модерац, Console жагсаалт
lib/public-chat/http.ts      CORS, saas хаалга, rate limit, Turnstile, токен
lib/public-chat/telegram.ts  Багийн bot: relay, товч, толин
app/api/public-chat/{session,room,private,telegram}/route.ts
app/api/platform/public-chat/route.ts
scripts/public-chat-telegram-webhook.mjs
tests/public-chat.test.ts (ЦЭВЭР) · tests/public-chat-flow.test.ts (DB)
```

Widget нь `entry-landing` repo-д (`src/components/chat/`).

## Дараагийн алхам (хийгээгүй)

- SSE realtime (polling-ийн оронд) — урсгал өсвөл
- Олон instance болбол rate limit-ийг DB/Redis руу (одоо in-memory, нэг процесс)
- Бүртгүүлэхэд яриаг хэрэглэгчид бичиж холбох (одоо Console уншихдаа и-мэйлээр тулгана)
