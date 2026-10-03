# Ontology registry (`lib/ontology/`) — P2 (ажиглах)

Санал, үндэслэл: [`docs/ontology-audit.md`](../ontology-audit.md) §6 (загвар), §7.3 (үе шат).
`CLAUDE.md` §9g — хатуу дүрмийн хураангуй.

## 1. Юу вэ

Бизнес объект бүрийн **төлөв**, **шилжилт** (эрх, шалгалт, үр дүн, MCP tool), **холбоо**-г
НЭГ газар, ЦЭВЭР (DB импортгүй, client-safe) өгөгдлөөр тодорхойлно. P2-ийн зорилго:

1. AI (MCP) «энэ баримт энэ төлөвт байхад юу хийж болох вэ» гэдгийг таахгүй —
   `describe_ontology`-оор асууна;
2. код ↔ registry зөрөхгүй — drift тест;
3. шинэ код төлвийг шууд бичиж ontology-г тойрох нь ил болно — ratchet тест.

Registry нь **одоо байгаа зан төлвийг баримтжуулна** — шинэ дүрэм нэмэхгүй, server
action-ууд эндээс хараахан уншдаггүй (P3-ийн engine). Зөрчлийг блоклохгүй.

## 2. Файлууд

```
lib/ontology/types.ts            ObjectDef, StateDef, TransitionDef, RelationDef, GuardKey, EffectKey
lib/ontology/define.ts           defineObject — бүтцийн шалгалт (objectProblems) + гүн freeze
lib/ontology/objects/            journal-voucher, arap-document, cash-document,
                                 purchase-order (PurchaseOrderStatus), qpay-intent (QpayIntentStatus)
lib/ontology/index.ts            ONTOLOGY_OBJECTS, ontologyObject, transitionsFrom, ontologyToolNames
lib/ontology/describe.ts         describeOntology — tool-ын текст / JSON гаралт
lib/ai/tools.ts                  describe_ontology (зөвхөн унших, rate kind "read")
tests/ontology-registry.test.ts  drift тест (DB-гүй)
tests/ontology-status-writes.test.ts  KNOWN_DIRECT_STATUS_WRITES ratchet (DB-гүй)
```

## 3. Загвар

| Талбар | Утга |
|--------|------|
| `states` | төлөв → `{ label, ledger: none\|posted\|reversed, terminal?, editable? }` |
| `initial` | үүсэх төлөв (журнал, АР/АП, касс: `draft` эсвэл «Шууд бичих» горимд `posted`) |
| `transitions[]` | `{ action, from[], to \| null, permission, guards[], effects[], tool?, actor?, note? }` — `from: []` = үүсгэлт, `to: null` = устгалт, `actor: "system"` = webhook / хуваарь / өөр баримтын үр дүн |
| `relations[]` | `{ name, targetTable, column, kind: fk\|soft\|polymorphic, cardinality }` — `one`: багана ЭНЭ хүснэгтэд, `many`: багана targetTable-д |
| `idempotency` | `externalRef` (+ системийн угтвар) |
| `invariants` | `docs/ontology-audit.md` §7.2-ын шалгалтын ID |

**Guard** (`GuardKey`): `period_open`, `not_future_period`, `journal_balanced`, `control_account`,
`not_source_locked`, `no_open_settlements`, `ebarimt_not_sent`, `ai_post_mode`, `ai_post_limit`,
`custom:<нэр>` (fork — зөвхөн хатууруулна, §6.7). Хэрэгжүүлэлт одоо модулийн action-д.

**Effect** (`EffectKey`): `journal`, `voucher_no`, `hook:beforeJournalPost` (бүх модульд DB
trigger-ээр, M4).

Тэмдэглэл:

- АР/АП-ийн `partially_paid` / `paid` нь ДЕРИВАТ (paidAmount-аас) — `settle`, `settle_full`,
  `unsettle` шилжилт нь кассын баримт / суутгал / урьдчилгаа / хасалтын үр дүн.
- АР/АП-ийн модуль `ar|ap` — баримтын төрлөөр (`lib/arap/document-kind.ts`).
- QPay-ийн шилжилт `lib/qpay/intent.ts`-ийн `TRANSITIONS`-тэй ЯГ ИЖИЛ (тест бүх хосыг тулгана);
  шошго нь `QPAY_INTENT_STATUS_LABELS`-аас.

## 4. Drift тест (`tests/ontology-registry.test.ts`)

| Шалгалт | Унах жишээ |
|---------|-----------|
| `objectProblems` хоосон, freeze | бүртгэлгүй төлөв, эцсийн төлөвөөс шилжилт, гарцгүй эцсийн бус төлөв |
| хүснэгт + `status` багана (NOT NULL, default ∈ initial) | хүснэгт / багана нэр солигдсон |
| схемийн тайлбар `// "draft" \| …` = states | төлөв нэмсэн атлаа registry-д алга |
| FK холбоо (`kind: "fk"`) схемийн FK-тэй, soft/polymorphic FK-гүй | FK нэмсэн / хассан |
| шошго = `lib/status.ts` `DOCUMENT_STATUS`; QPay = `canTransition` | шошго, шилжилт зөрсөн |
| `lib/**` дахь `eq/ne/inArray(<table>.status, "…")`, `.update(<table>).set({ status: "…" })` литерал ∈ states | үсгийн алдаа, бүртгэлгүй шинэ төлөв |
| ontology-ийн tool бүр байгаа; `journal_voucher\|arap_(document\|invoice)\|cash_(document\|transaction)\|purchase_order` нэртэй БИЧИХ tool бүр холбогдсон | шинэ tool registry-гүй |
| `ai_post_mode` гэсэн шилжилтийн runner-т `assertPostMode` / `mode === "post"` байгаа | registry худлаа хэлсэн |
| `describe_ontology` гаралт (жагсаалт, forState, алдааны код, < 4 KB) | — |

## 5. Ratchet (`tests/ontology-status-writes.test.ts`)

`KNOWN_DIRECT_STATUS_WRITES` = файл → registry-ийн объектын хүснэгтэд `status` бичдэг
`.update(<table>).set({ … })`-ийн тоо (2026-10-03: 16 файл, 47).

- **Өсвөл унана** — шинэ шилжилтийг эхлээд `lib/ontology/objects/*`-д бүртгэж, тоог PR-д ИЛ
  өсгөнө (reviewer харна).
- **Буурвал унана** — жагсаалтыг бодит тоо руу буулгана (P3: engine-д шилжүүлэх бүрд).
- Raw SQL (`update … set status`) болон insert тоологдохгүй (insert-ийн төлөв = `initial`).

## 6. Шинэ объект нэмэх

1. `lib/ontology/objects/<key>.ts` — `defineObject({...})`; TS төлвийн төрөл байвал
   `defineObject<ThatStatus>` (tsc бүрэн хамаарлыг шалгана)
2. `lib/ontology/index.ts` — `ONTOLOGY_OBJECTS`-д нэмнэ
3. `tests/ontology-registry.test.ts` — шошгын эх (`DOCUMENT_STATUS` эсвэл модулийн толь), бичих
   tool-ын нэрийн загвар (`OBJECT_TOOL`)-ыг өргөтгөнө
4. `tests/ontology-status-writes.test.ts` — шинээр тоологдсон файлуудыг KNOWN-д нэмнэ (энэ
   ганц удаа өсгөлт хэвийн)
5. `describe_ontology` tool-ын тайлбар дахь объектын жагсаалт

## 7. Дараагийн шат

- P2-ийн үлдсэн: бусад объект (бараа хөдөлгөөн, хүлээн авалт, ҮХ, элэгдэл, өртөг, POS
  борлуулалт/ээлж, цалин), `lib/status.ts`-ийг registry-ээс уншдаг болгох, engine-ийн ажиглах
  горим (`audit_events action='ontology_violation'`).
- P3: `transition()` engine — нөхцөлтэй бичилт + guard дараалал нэг цэгт, модулиар
  `ONTOLOGY_ENFORCE`. P5: `CHECK (status IN …)` registry-ээс.
