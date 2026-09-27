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

**«AI туслах»** — хувийн ярианд эхний хариуг AI өгч болно (доорх «AI туслах»
хэсэг). Нийтийн өрөөнд зөвхөн хүн хариулна. Entry сервер AI-ийн API дуудахгүй (§9a).

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
PUBLIC_CHAT_TELEGRAM_PRIVATE_CHAT_ID= # сонголтоор — «нээлттэй групп» горим (доор)
TURNSTILE_SECRET_KEY=                # Cloudflare Turnstile (site key нь landing-д)
PUBLIC_CHAT_ALLOWED_ORIGINS=         # сонголтоор; default entry.mn + www
```

Deploy-ийн дараа НЭГ удаа: `node scripts/public-chat-telegram-webhook.mjs https://app.entry.mn`.

**Яагаад тусдаа bot:** мэдэгдлийн bot (`TELEGRAM_BOT_TOKEN`) холболтын кодоо
`getUpdates`-ээр уншдаг — webhook тавибал тэр урсгал эвдэрнэ.

Группийн chat id олох: bot-ыг группт нэмээд группт `/help` бичээд
`https://api.telegram.org/bot<TOKEN>/getUpdates` (webhook тавихаас ӨМНӨ) → `chat.id`.

### Нээлттэй групп горим (2026-09-27)

Product owner олон нийтийн Telegram группыг (landing-ийн QR/линк) багийн
групптай НЭГ байлгахаар шийдсэн. `PUBLIC_CHAT_TELEGRAM_PRIVATE_CHAT_ID`
тавибал (`lib/public-chat/telegram.ts`):

| | `CHAT_ID` (нээлттэй групп) | `PRIVATE_CHAT_ID` (эзний bot-той DM / хаалттай групп) |
|---|---|---|
| Нийтийн өрөөний relay + [Нуух]/[Хаах] | ✅ | — |
| Хувийн яриа (зочны утас, и-мэйл), AI-ийн хариу, Console-ийн хувийн хариу | ❌ ХЭЗЭЭ Ч | ✅ |
| Reply → «Entry баг», `/room`, `/faq`, товч, `/help` | ЗӨВХӨН группын админ (`getChatAdministrators`, 60 сек кэш, алдаа → эрхгүй) | ✅ |
| Reply-гүй энгийн текст | админых → нийтийн өрөөнд «Entry баг» (`plainToRoom`); бусдынх → энгийн яриа | үл тоомсорлоно |

- Энгийн гишүүний Reply бол группын яриа — чимээгүй үл тоомсорлоно, товч
  дарвал «Зөвхөн группын админ». Багийн гишүүнийг группт АДМИН болгоно.
- Telegram-ийн `message_id` chat бүрт тусдаа тоологддог тул хувийн chat-ийн
  мессежийг DB-д `p:<id>` түлхүүрээр (`telegramRef`) — группынх цэвэр тоо
  хэвээр (өмнөх мөрүүд хөндөгдөхгүй, unique index давхцахгүй).
- DM ашиглах бол эзэн bot-д нэг удаа **Start** дарна (bot эхэлж бичиж чадахгүй).
- Группыг олон нийтэд **invite линкээр** (`t.me/+…`) нээнэ. Нийтийн username
  (`t.me/нэр`) тавибал Telegram энгийн группыг supergroup болгож chat id
  (`-100…`) өөрчилнө — тэгвэл `PUBLIC_CHAT_TELEGRAM_CHAT_ID`-г шинэчилнэ.
- Env тавиагүй бол өмнөх шигээ — бүх relay нэг (хаалттай) группт, эрх шалгахгүй.

### Түгээмэл асуулт — автоматаар (2026-09-27)

Зочин `/faq` гэж бичих шаардлагагүй:

- **Landing widget:** `GET /api/public-chat/faq` → `{ faq: [{ key, title, body }] }`
  (chatGate + CORS, сесс шаардахгүй) — чат нээгдэхэд «Түгээмэл асуулт» товч,
  дарахад хариу widget дотор (серверт мессеж үүсгэхгүй).
- **Нээлттэй Telegram групп:** шинэ гишүүн нэгдэхэд bot угтах мессеж + товч
  (`faqg:<key>`) илгээнэ; өмнөх угтах мессежийг устгана (bot админ). Товчийг
  ДУРЫН гишүүн дарна — хариу группт (landing-д очихгүй), нэг асуулт 10 минутад
  нэг удаа (спамаас). Хаалттай багийн группт идэвхгүй.

⚠️ Bot-ыг админ болгох / нийтийн болгоход Telegram энгийн группыг supergroup
болгож chat id-г (`-100…`) өөрчилнө — `PUBLIC_CHAT_TELEGRAM_CHAT_ID`-г
шинэчилнэ (хуучин id руу илгээхэд `migrate_to_chat_id` буцаана).

### Бэлэн хариулт (`/faq`, 2026-09-27)

`lib/public-chat/faq.ts` (ЦЭВЭР, тесттэй): Entry гэж юу, үнэ, туршилт, холболт,
«AI нягтлан», шилжилт, POS/eBarimt/QPay, холбогдох. Үнэ, туршилтын хугацааг
`lib/billing/plans.ts`-ээс авна — бусад баримт entry-landing
`src/assistant/knowledge.ts`-тэй ИЖИЛ байна.

- Зочны relay дээр Reply хийж `/faq` → товчнууд → дарсан хариулт тэр
  зочинд/мессежид; Reply-гүй `/faq` → нийтийн өрөөнд.
- Товч `faq:<key>:<messageId|room>` (≤ 64 байт). Илгээсний дараа товчтой
  мессеж илгээсэн текстээр солигдоно; тэр мессежийн түлхүүр DB-д хадгалагдаж
  дахин дарах / webhook давтагдахад нэг л удаа бичигдэнэ; түүн дээр Reply
  хийвэл яриа үргэлжилнэ.

## AI туслах (2026-09-27)

Зорилго: Entry-г сонирхож буй хүнд **борлуулалтын өмнөх мэдээлэл** (Entry гэж юу,
боломж, үнэ, ChatGPT/Claude-д холбох, туршилт) шуурхай өгөх. Харилцагчийн
нягтлан бодох өгөгдөл, татварын зөвлөгөө — ХАМААРАХГҮЙ.

```
зочин → POST /private → хадгална → after(): Telegram relay → requestAiReply
   → POST ${PUBLIC_CHAT_AI_URL} (Bearer PUBLIC_CHAT_AI_SECRET, {threadId, messages})
   → entry-landing /api/chat-assistant → Claude (FAQ мэдлэгтэй) → {reply, handoff}
   → postAiMessage (author ai, «AI туслах») → Telegram «🤖 AI туслах хариулсан»
```

- **Хэзээ хариулахгүй** (`aiSkipReason`, тесттэй): тохиргоогүй; Entry баг сүүлийн 24
  цагт энэ ярианд бичсэн (хүн авсан); ярианд 24 цагт 20 AI хариу; нийт 500/24ц
- **Хуучирсан хариу хадгалахгүй** (`postAiMessage`): хариулах зуур зочин шинэ мессеж
  бичсэн эсвэл баг хариулсан бол. Нэг зочны мессежид НЭГ AI хариу — partial unique
  index `public_chat_messages_ai_reply_ux` (reply_to_id where author = 'ai')
- **handoff** — AI мэдэхгүй / хүний шийдвэр шаардсан асуулт: зочинд «Entry баг
  удахгүй хариулна» гэж хэлж, группт «⚠️ хүн хариулна уу» гэж тэмдэглэгдэнэ
- Зочны UI: POST-ийн хариуны `assistant: true` үед «AI туслах бичиж байна…»
- Мэдлэг, prompt, загвар — entry-landing (`src/assistant/`), `CHAT_AI_MODEL` env
- env: `PUBLIC_CHAT_AI_URL` (жишээ нь `https://entry.mn/api/chat-assistant`),
  `PUBLIC_CHAT_AI_SECRET` (хоёр сервист ижил). Тохируулаагүй бол AI унтраалттай

## Файлууд

```
lib/public-chat/rules.ts     ЦЭВЭР: шалгалт, нуух, холбоос, Telegram update parser, relay текст
lib/public-chat/store.ts     DB: зочин, өрөө, яриа, багийн хариу, модерац, Console жагсаалт
lib/public-chat/http.ts      CORS, saas хаалга, rate limit, Turnstile, токен
lib/public-chat/telegram.ts  Багийн bot: relay, товч, толин
lib/public-chat/assistant-rules.ts  ЦЭВЭР: AI хариулах эсэх, transcript, хариу шалгах
lib/public-chat/assistant.ts        landing руу дамжуулах, хадгалах, relay
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
