# AI санал → бодит үр дүнгийн бүртгэл

**Төлөв:** Фаз 0 (схем + бичих зам) ХЭРЭГЖСЭН · 2026-09-20
**Зорилго:** ирээдүйд ML загвар сургах **шошготой** өгөгдөл цуглуулах суурь.
**ОДОО ML ХИЙХГҮЙ** — энд retrain job, background worker, загвар байхгүй.

---

## 1. Юу яагаад хадгалж байна вэ

AI (чат · MCP · REST) бичилт санал болгоход тэр санал **бодит амьдралд юу
болсныг** мэдэхгүй бол загварыг сайжруулах боломжгүй. Нягтлан бодох
бүртгэлийн давуу тал нь: **үнэний эх сурвалж хожим өөрөө ирдэг** — бичилт
батлагдаж, тайлант үе хаагдаж, аудит дамждаг. Тиймээс шошгыг таамаглах
шаардлагагүй, зүгээр л **хүлээж** авна.

```
AI санал бүртгэгдэв ──▶ нябо зөвшөөрөв ──▶ постлогдов ──▶ сар хаагдав ──▶ ШОШГО
                              │                                   │
                              └─ устгав → сөрөг шошго              └─ дараа нь
                                                                      БУЦААГДВАЛ
                                                                      шошго ХҮЧИНГҮЙ
```

Хоёр хүснэгт:

| Хүснэгт | Юу | Хэзээ бичигдэх |
|---|---|---|
| `ai_suggestion_log` | AI юу санал болгосон (оролт, гаралт, модель, хугацаа) | tool дуудагдмагц |
| `ai_suggestion_outcome` | Эцэст нь юу болсон (1:1) | баримт үүсэх ба түүнээс хойшхи өөрчлөлт бүрд |

---

## 2. Нэг бичих зам

MCP, REST v1, демо, eBarimt→АР — **бүгд** (апп доторх чат 2026-09-25-нд хасагдсан; `ui_assist` мөрүүд түүхэнд л)
`executeAiTool()`-оор дамждаг (`lib/ai/tools.ts`). Бүртгэл ч **яг тэнд** —
шинэ эх сурвалж нэмэхэд бүртгэлийн код өөрчлөгдөхгүй.

```
MCP ──┐
REST ─┤
чат ──┼─▶ executeAiTool ─▶ recordAiToolCall ─▶ logAiSuggestion
демо ─┘                                     └─▶ resolveAiSuggestion
```

Эх сурвалж / session / модель нь **AsyncLocalStorage**-аар ирнэ
(`lib/ai-logging/context.ts` `runWithAiLogContext`) — `executeAiTool`-ийн
гарын үсэг өөрчлөгдөөгүй тул бүх дуудагч хэвээр ажиллана.

| Орц | `source` | Файл |
|---|---|---|
| Гадны MCP клиент | `mcp` | `lib/mcp/server.ts` |
| REST API v1 | `rest_api` | `lib/api/v1.ts` |
| Апп доторх чат (хасагдсан) | `ui_assist` | — (хуучин мөрүүд) |
| Контекстгүй дуудлага | `internal_agent` | default |

**Зөвхөн БИЧИЛТ үүсгэсэн дуудлага бүртгэгдэнэ.** `list_*` / тайлангийн
уншилт шошго үүсгэдэггүй бөгөөд бүртгэвэл эзлэхүүн олон дахин өснө.
`externalRef`-ээр давхардсан (`dedup`) дуудлага ч шинэ баримт үүсгээгүй
тул алгасагдана.

---

## 3. Tenant тусгаарлалт — RLS-ГҮЙ, яагаад

**PostgreSQL Row Level Security ашиглаагүй.** Шалтгаан:

1. RLS ажиллахын тулд транзакц бүрд `SET LOCAL app.org_id` тавих ёстой.
   Одоогийн `lib/db/index.ts` нь shared pool, транзакцгүй query давамгай —
   бүх дуудлагыг tx-д боох нь **бүх модулийг дахин бичих** ажил.
2. Апп-ын DB хэрэглэгч нь хүснэгтийн **эзэн** тул `FORCE ROW LEVEL SECURITY`
   -гүйгээр RLS огт үйлчлэхгүй — хуурамч аюулгүй байдал үүснэ.
3. Системийн бусад ~60 хүснэгт бүгд апп-ын түвшний scoping ашигладаг.
   Хоёр хүснэгтэд л RLS хийх нь **тогтолцоог хоёр хуваана**.

**Оронд нь — гурван давхар хамгаалалт:**

| Давхарга | Юу |
|---|---|
| Схем | `organization_id` **not null** + FK cascade, хоёр хүснэгтийн аль алинд |
| Код | Query ЗӨВХӨН `lib/ai-logging/service.ts`-д; функц бүр `AiLogScope` хүлээн авч WHERE-т `organizationId` тавина |
| CI | `tests/ai-logging-direct-db.test.ts` — статик шалгалт |

Статик шалгалт нь `lib`, `app`, `components`, `scripts`, `custom` доторх
бүх `.ts/.tsx/.mjs` файлыг сканнердаж, `aiSuggestionLog` /
`aiSuggestionOutcome` / SQL нэрийг **зөвшөөрөгдсөн замаас гадна** дурдвал
**CI-г унагана**. ESLint custom rule биш **grep-based тест** сонгосон
шалтгаан: шинэ dependency шаардахгүй бөгөөд энэ repo-д аль хэдийн ижил
хэв маягийн статик тестүүд бий (`module-route-guards`, `grid-row-height`,
`sql-date-params`).

`organization_outcome`-д `organization_id` нь **денормчлагдсан** (log-д ч
бий): сургалтын шүүлтүүр outcome хүснэгтийг дангаар нь уншдаг тул scope нь
join-гүйгээр хүрэлцэх ёстой.

---

## 4. Training scope ба PII

```
training_scope: 'tenant_only' (DEFAULT) | 'industry' | 'global'
```

**`tenant_only`-оос ДЭЭШ ХЭЗЭЭ Ч автоматаар өргөгдөхгүй.** Өргөх нь
дуудагчийн **ил** параметрээр л явагдана, тэр ч `planTrainingScope`-ийн
шалгалтыг давна: цэвэрлэлтийн дараа PII үлдвэл `tenant_only` руу **буурч**
шалтгаан нь `scope_downgrade_reason`-д бүртгэгдэнэ.

### Цэвэрлэлт — WHITELIST, blacklist БИШ

`lib/ai-logging/redact.ts`:

- **Объект / массив** — үргэлж дотогш ордог (бүтэц нь өөрөө PII биш)
- **Скаляр** — түлхүүр нь `GLOBAL_SAFE_KEYS`-д байж, утга нь PII хээнд
  тохирохгүй бол л үлдэнэ. **Өөр бүх тохиолдолд `[redacted]`**
- **PII агуулсан ТҮЛХҮҮР** (`{ "УБ12345678": … }`) — оролт бүтнээрээ хасагдана

Ингэснээр маргааш хэн нэгэн `supplierLegalName` нэмэхэд тэр талбар
**default-аар redact** хийгдэнэ. Blacklist бол эсрэгээр — мэдэхгүй
талбараа чимээгүй урсгана. Энэ зан төлөвийг
`tests/ai-logging-redact.test.ts` шууд шалгадаг.

`tenant_only` үед цэвэрлэлт **хийгдэхгүй** — байгууллагын өөрийн өгөгдөл,
tenant тусгаарлалтаар хамгаалагдсан.

### Зориуд ОРООГҮЙ талбарууд

Дансны дугаар, сегментийн код, харилцагч/нийлүүлэгчийн нэр, РД, ТТД,
банкны данс, чөлөөт текст (`description`, `memo`, `note`).

> **Ил хэлэх зүйл:** дансны дугааргүйгээр `global` scope-ийн сургалтын үнэ
> цэн хязгаарлагдмал — бодит хэрэглээ нь `tenant_only` (байгууллага
> өөрийнхөө өгөгдлөөр өөрийн загвараа сургана). Монголын жишиг дансны
> жагсаалт нь нийтийн баримт тул дансны дугаарыг нээх нь боломжтой ч,
> сегментийн код нь компани / төсөл / МГ-ийн кодыг агуулдаг. Үүнийг нээх
> эсэх нь **тусад нь гаргах шийдвэр** — кодод чимээгүй оруулахгүй.

---

## 5. Эзлэхүүн — partition ХИЙГЭЭГҮЙ, яагаад

Тооцоо: сард ~300k мөр → жилд ~3.6M. Сараар partition **хийгээгүй**:

1. **`drizzle-kit push` declarative partitioning дэмждэггүй.** Partitioned
   parent нь схемтэй мөнхийн diff үүсгэж, Railway-ийн **non-TTY**
   preDeploy-г унагана (CLAUDE.md-д энэ эрсдэл 2 удаа бүртгэгдсэн).
2. Сар бүрийн partition урьдчилж үүсгэх нь **background job** шаарддаг —
   энэ ажлын хүрээнээс гадуур.
3. Btree индекстэй Postgres-т хэдэн сая мөр асуудал биш. Partition нь
   ~50–100M+ мөр, эсвэл `DROP PARTITION`-оор хямд цэвэрлэгээ хэрэгтэй
   болоход л ашиг өгнө.

**Ирээдүйн замыг нээлттэй үлдээсэн:** гаднаас энэ хоёр хүснэгт рүү FK
үүсгэхийг хориглосон (partitioned parent руу заах FK нь хүндрэл үүсгэдэг).

**Шилжих босго:** `ai_suggestion_log` 20M мөр давах, ЭСВЭЛ `(tenant_id,
created_at)`-аар шүүсэн query 500мс-ээс удаашрах. Тэр үед эхлээд
`drizzle-kit generate` + `migrate` (батлагдсан migration файл) руу
шилжиж, дараа нь partition хийнэ.

**Индексүүд:**

```
ai_suggestion_log      (organization_id, created_at)
                       (organization_id, session_id)
                       (organization_id, training_scope)
ai_suggestion_outcome  UNIQUE (suggestion_id)                    ← 1:1
                       (organization_id, resolution)
                       (organization_id, is_posted, is_period_closed, has_reversal)
                       (linked_document_type, linked_document_id) ← аудитын гүүр
                       (organization_id, linked_document_date)    ← периодын хаалт
```

---

## 6. Сургалтын шүүлтүүр — гурван нөхцөл

```
is_posted && is_period_closed && !has_reversal
```

`lib/ai-logging/resolution.ts` `isTrainingEligible()` — **цорын ганц**
тодорхойлолт.

| Нөхцөл | Яагаад | Хэн тавьдаг |
|---|---|---|
| `is_posted` | Ноорог нь хүний шийдвэр биш, зүгээр л санал | аудитын гүүр (`post`, `create_posted`, `confirm`, `fx_post`, `approve`) |
| `is_period_closed` | Хаагдсан үеийн бичилт immutable → шошго тогтвортой | `closePeriod` / `reopenPeriod` |
| `!has_reversal` | **Доорхыг үзнэ үү** | аудитын гүүр (`reverse`, `fx_reverse`, `delete`, `return`, `cancel`, `dispose`) |

### Буцаалтын нүх

Эхний хоёр нөхцөл **дутуу**. Бодит дараалал:

```
AI санал → нябо зөвшөөрөв → постлогдов → сар хаагдав → ШОШГО болов
                                                          ↓
                                       ДАРАА НЬ алдаа илэрч БУЦААЛТ хийгдэв
```

Энэ мөр log дээр «AI **зөв** санал болгосон» гэж үлдэнэ — гэтэл үнэндээ
**буруу** байсан. Эдгээр нь яг **AI алдсан** тохиолдлууд тул эерэг
шошгоор сургалтад орвол загварыг **зориудаар буруу сургахтай** тэнцэнэ.

`is_posted` ба `is_period_closed` хоёр нь **хэвээр үлдэнэ** (түүх
гуйвуулагдахгүй) — зөвхөн `has_reversal` дээшилж шүүлтүүрээс хасагдана.

### Яагаад (а) `has_reversal` багана, (б) LEFT JOIN БИШ

Энэ codebase-д **нэг ч «буцаалтын хүснэгт» байхгүй**. Буцаалт нь эх
баримтын мөрийн `status` талбарт илэрхийлэгддэг, төрөл бүрд **өөр
үгсийн сангаар**:

| Баримт | Буцаалтын статус |
|---|---|
| journal · cash · arap · inventory · goods_receipt · cost | `reversed` |
| pos_sale | `returned` · `partially_returned` · `voided` |
| purchase_order | `cancelled` |

Сонголт (б) нь **8 хүснэгтийн нөхцөлт LEFT JOIN** + төрөл бүрийн статусын
үгсийн санг сургалтын query дотор давтахыг шаардана. Мөн `linked_document`
нь **polymorphic** (FK байхгүй) тул цэвэр join огт илэрхийлэгдэхгүй, шинэ
AI action kind нэмэх бүрд query эвдэрнэ.

Сонголт (а) сонгосон — **аудитын гүүрээр**. Буцаалтын **зам бүр** аль
хэдийн `logAuditEvent` дууддаг (кодод 16 `reverse`, 16 `delete`, 6
`cancel`, 2 `return`, 2 `dispose`) тул `lib/audit.ts`-д **нэг** дэгээ
нэмэхэд өнөөгийн ба **ирээдүйн** бүх зам хамрагдана. Мэдэгдлийн систем
яг ижил хэв маягийг (`notifyFromAudit`) аль хэдийн ашигладаг.

```ts
// lib/audit.ts — logAuditEvent доторх нэг дуудлага
await applyAuditToOutcomes({ organizationId, action, entityType, entityId }, executor);
```

Транзакц дотор дуудагдвал ижил executor-оор бичигдэж **хамт
commit/rollback** болно.

---

## 7. resolution төлвийн машин

```
no_action ──▶ accepted | modified | rejected
accepted  ──▶ modified | rejected
modified  ──▶ accepted | rejected
rejected  ──▶ (ЭЦСИЙН)
```

`rejected` эцсийн болсон шалтгаан: татгалзсан саналыг хожим «хүлээн авсан»
болговол шошго хуурамч болно. Татгалзсаны дараа хүн **шинэ** бичилт хийсэн
бол тэр нь өөр санал — шинэ мөр байх ёстой.

Автомат шилжилтүүд (аудитын гүүрээс):

| Аудит | Үр дүн |
|---|---|
| tool баримт үүсгэв | `accepted` |
| `update` баримтад | `accepted` → `modified` |
| `delete` баримтыг | `rejected` + `has_reversal` |
| `post` / `confirm` … | `is_posted = true` |
| `unpost` | `is_posted = false` |
| `reverse` / `cancel` / `return` … | `has_reversal = true` |

---

## 8. Polymorphic linked_document

```
linked_document_type text   -- AiAction.kind = аудитын entityType
linked_document_id   uuid   -- FK БАЙХГҮЙ
```

Үгсийн сан: `journal` · `arap` · `cash` · `inventory` · `fa` ·
`purchase_order` · `goods_receipt` · `pos_sale`.

**Яагаад FK биш:** энэ codebase аль хэдийн ижил хэв маягийг хоёр удаа
ашигладаг — `document_attachments` (`entityType`) ба `audit_events`. 8
төрөлд 8 nullable FK + 8 салаа CHECK гэдэг нь шинэ AI tool нэмэх бүрд
migration шаардана.

**Ил хэлэх эрсдэл:** referential integrity байхгүй тул устгагдсан баримт
«унжсан» ID үлдээнэ. Энэ нь **зориуд** — «AI санал болгосон → хүн
устгасан» бол үнэ цэнтэй **сөрөг** шошго бөгөөд бүртгэлийн мөрийг cascade-
аар устгавал тэр шошго алдагдана. Унжсан мөр сургалтад **хэзээ ч орохгүй**:
шүүлтүүр `is_posted && is_period_closed` шаарддаг, хаагдсан үеийн
батлагдсан баримт устдаггүй.

---

## 9. Файлууд

```
lib/ai-logging/
├── constants.ts    ЦЭВЭР: source / resolution / training_scope union,
│                   аудитын үйлдлийн ангилал — литералын ЦОРЫН ГАНЦ эх
├── resolution.ts   ЦЭВЭР (тесттэй): canTransition, isTrainingEligible
├── redact.ts       ЦЭВЭР (тесттэй): GLOBAL_SAFE_KEYS whitelist, findPii,
│                   redactValue, planTrainingScope
├── context.ts      AsyncLocalStorage — эх сурвалж / session / модель
├── record-tool.ts  executeAiTool → бүртгэлийн гүүр
└── service.ts      ЦОРЫН ГАНЦ DB давхарга — logAiSuggestion /
                    resolveAiSuggestion / applyAuditToOutcomes /
                    markPeriodTrainingFlags + scope-той уншигчид

lib/audit.ts             applyAuditToOutcomes дэгээ
lib/actions/periods.ts   markPeriodTrainingFlags (close / reopen)
lib/ai/tools.ts          recordAiToolCall (executeAiTool доторх)
scripts/apply-pending-ddl.mjs  идемпотент DDL (downtime-гүй)

tests/ai-logging-redact.test.ts      whitelist, PII, scope (цэвэр)
tests/ai-logging-resolution.test.ts  шилжилт, шүүлтүүрийн үнэний хүснэгт (цэвэр)
tests/ai-logging-direct-db.test.ts   RLS-гүй сонголтын статик хамгаалалт (цэвэр)
tests/ai-logging-isolation.test.ts   tenant тусгаарлалт, polymorphic, буцаалт (DB)
```

---

## 10. Migration — backward compatible, downtime-гүй

**Зөвхөн НЭМЭЛТ:** байгаа хүснэгт хөндөгдөөгүй, багана хасагдаагүй,
өөрчлөгдөөгүй.

- Хуучин код шинэ хүснэгтийг мэдэхгүй ч асуудалгүй ажиллана
- Шинэ код хуучин DB дээр ажиллахад `scripts/apply-pending-ddl.mjs`
  (`create table if not exists`) хүснэгтийг **push-аас ӨМНӨ** үүсгэнэ
- Идемпотент — дахин ажиллуулахад юу ч өөрчлөгдөхгүй
- Unique нь **CONSTRAINT биш INDEX** (drizzle-kit #5955 — non-TTY
  preDeploy-г унагадаг)

---

## 11. Хуримтлалын хяналт — `/api/health.aiLog`

Бүртгэл deploy-ийн дараа бодитоор хуримтлагдаж буй эсэхийг `/api/health`-ийн
`aiLog` блок харуулна (`aiLoggingHealthStats`, service.ts-ийн scope-гүй ЦОРЫН
ГАНЦ функц): `total`, `last30Days`, `organizations`, `accepted` / `modified` /
`rejected`, `posted`, `trainable` (§6-ийн гурван нөхцөл), `invalidated`,
`lastAt`. Health нэвтрэлтгүй тул **зөвхөн нэгтгэл тоо** — байгууллагын ID,
payload, санал, баримтын холбоос ХЭЗЭЭ Ч гарахгүй (`tests/ai-logging-isolation`
шалгана). Хүснэгт хараахан үүсээгүй бол `null`.

v1.6.0-оор энэ бүртгэл fork харилцагчдад (dedicated) ч хүрсэн — өгөгдөл
харилцагчийн ӨӨРИЙН DB-д `tenant_only`-оор үлддэг тул Entry рүү юу ч
урсахгүй; тоолуурыг харилцагч бүрийн `/api/health`-ээс харна.

## 12. Хараахан ХИЙГЭЭГҮЙ (санаатайгаар)

- ML загвар, сургалт, retrain job, background worker
- Бүртгэлийг харах UI хуудас (өгөгдөл хуримтлагдсаны дараа)
- Хадгалалтын хугацаа / цэвэрлэгээ (эзлэхүүн харагдсаны дараа тогтооно)
- `industry` / `global` scope руу өгөгдөл ил өргөх урсгал — одоогоор
  бүх мөр `tenant_only`
