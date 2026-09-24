# Мэдлэгийн сан — хэрэглэгчид хүргэх санал

**Статус:** БАТЛАГДСАН 2026-09-23 (D1–D7). Фаз 1 хэрэгжсэн.

## 1. Асуудал

`knowledge/` (95 файл, 812 KB — IFRS 44, татвар/цалин/урсгал 22, стандарт 20,
AI skill 8) нь **зөвхөн хөгжүүлэлтэд** ажилладаг байв: код бичихэд Claude Code
уншдаг, гэхдээ runtime-д хэзээ ч уншигддаггүй. Хэрэглэгчийн AI туслах
`lib/ai/system-prompt.ts`-ийн 359 мөрийн хураангуйгаар л хязгаарлагдаж байв.

Зэрэгцээд `knowledge/` git-д tracked, `.gitignore`-д байхгүй тул **эх код авсан
(fork) харилцагч бүрт бүтнээрээ очиж** байв — өмчлөх мэдлэг тарж байсан.

Зорилго: хэрэглэгч **Entry-г хэрэглэж байх үедээ л** мэдлэгийн санг ашиглана;
файл татахгүй; хэнд өгөхийг **Entry Console-оос** шийднэ.

## 2. Батлагдсан шийдвэрүүд

| # | Шийдвэр |
|---|---------|
| **D1** | Мэдлэг **сервер талд** `knowledge_articles` хүснэгтэд — `organizationId` БАЙХГҮЙ (нийтийн лавлах, `exchange_rates`-тэй ижил). Хэрэглэгчид markdown файл ХЭЗЭЭ Ч очихгүй |
| **D2** | ~~Хандалт = багцын боломж **`knowledge`**. Аль ч багцад default OFF~~ → **D2′** (2026-09-24) |
| **D2′** | Хандалт = багцын боломж **`knowledge`** (`lib/billing/plans.ts`). **SaaS-ийн нягтлан бодох багц бүрд ҮНЭГҮЙ дагалдана**; систем ашиглахгүй хэрэглэгч **«AI нягтлан» (`skills`) багцаар** тусад нь захиална — 29,000₮/сар, trial 24 цаг, өөрийн ChatGPT / Claude-д MCP-ээр (татахгүй). **dedicated-д OFF** хэвээр (агуулга Entry-ээс л). Console override-оор байгууллага бүрд унтрааж/асааж болно. Мэдлэг нь захиалгын бүтээгдэхүүн тул read-only төлөвт хаагдана |
| **D3** | **Хэсгээр л уншина.** Файл = сэдэв (topic), `## ` толгой бүр = хэсэг (section). Tool «бүгдийг буцаах» параметргүй; хэсэг ≤ 3000 тэмдэгт, таслагдвал ИЛ хэлнэ; жагсаалт нь зөвхөн гарчиг |
| **D4** | **Чат + MCP-д л, REST API-д ҮГҮЙ.** REST нь скриптээр бөөнөөр татах хамгийн хялбар зам. Механизм: `AiToolDef.surfaces` + `aiToolsForSurface()` |
| **D5** | Байгууллага бүрд **24 цагт 200 хэсэг** — `knowledge_reads`-ээс DB-д тоологдоно (олон instance-д ч зөв). Хэтэрвэл `[KNOWLEDGE_LIMIT]` |
| **D6** | Уншилт бүр `knowledge_reads`-д (org, user, slug, section, огноо) — бөөнөөр татах оролдлого ил. **Аудит биш**: харилцагчийн `/settings/audit`-ыг AI-ийн уншилтаар бөглөхгүй |
| **D7** | Seed = preDeploy-ийн сүүлийн алхам `scripts/seed-knowledge.mjs` (`KNOWLEDGE_DIR`, default `knowledge/`), идемпотент (sha256). Хамрах хүрээ `01`, `02`, `04/skills`; `03-стандарт` (UI/сегмент) ОРОХГҮЙ. **Хавтас байхгүй бол чимээгүй алгасна** — энэ нь fork-ын хамгаалалтын суурь |

## 3. Урсгал

```
Console → байгууллага → overrides {"features":{"knowledge":true}}
                                  ↓
Хэрэглэгч (чат / MCP): «IAS 16-аар энэ хөрөнгийг яаж элэгдүүлэх вэ?»
                                  ↓
list_knowledge_topics()               → гарчгийн индекс (ангиллаар)
read_knowledge_section({topic, section}) → НЭГ хэсэг + ишлэл + бусад хэсгийн нэрс
                                  ↓
Сервер: requireFeature(org, "knowledge") → квот (24ц/200) → knowledge_reads
        ❌ [FEATURE_NOT_IN_PLAN] · [KNOWLEDGE_LIMIT] · [KNOWLEDGE_NOT_FOUND]
```

Хэрэглэгч юу ч суулгахгүй, татахгүй. MCP-ийн `instructions` + tool-ын тайлбар
нь Claude-д «хэзээ ашиглах»-ыг холбогдох мөчид хэлнэ (skill файл БИШ).

## 4. Хамгаалалтын хил — шулуун үнэн

**Үнэмлэхүй хамгаалалт байхгүй.** LLM уншаад тайлбарлаж чаддаг бол тэвчээртэй
хэрэглэгч олон асуултаар аажмаар задлаж авна. Бодит зорилго:

- бөөнөөр татахыг **захиалга төлөхөөс үнэтэй, удаан** болгох (D3, D4, D5)
- оролдлогыг **илрүүлэх** (D6)
- **fork-д агуулга очихгүй** байх (D7 + §6)

Жинхэнэ moat нь мэдлэг өөрөө биш — posting matrix бодит журнал бичдэг,
татварын хугацаа мэдэгдэл илгээдэг, 2026-ын шинэчлэлт тасралтгүй ирдэг
**амьд систем**. Татагдсан markdown бол хуучирдаг агшингийн зураг.

## 5. Хэрэгжилт (Фаз 1)

```
scripts/lib/knowledge-parse.mjs   ЦЭВЭР parser (tests/knowledge-parse.test.ts):
                                  frontmatter, ## хэсэглэлт, slug, ангилал, хамрах хүрээ
scripts/seed-knowledge.mjs        preDeploy seed — upsert (slug, section), sha256 алгасалт,
                                  устсан файлын хэсгүүд хасагдана; хавтасгүй бол алгасна
lib/knowledge/catalog.ts          ЦЭВЭР (tests/knowledge-catalog.test.ts): тогтмол, clamp,
                                  индекс/хэсгийн хэлбэр, оролтын цэвэрлэлт (path traversal)
lib/knowledge/store.ts            DB: listKnowledgeTopics / readKnowledgeSection /
                                  countKnowledgeReadsToday / recordKnowledgeRead / knowledgeStats
lib/billing/plans.ts              FeatureKey "knowledge" — default OFF
lib/ai/tools.ts                   list_knowledge_topics, read_knowledge_section
                                  (surfaces: chat, mcp); AiToolSurface, aiToolsForSurface;
                                  EntitlementError → [CODE] угтвар баталгаажсан
lib/api/v1.ts                     aiToolsForSurface("rest") — жагсаалт + дуудлага хоёуланд
lib/mcp/server.ts, chat route,    aiToolsForSurface("mcp" / "chat"); MCP instructions
lib/ai/openai.ts
lib/ai/system-prompt.ts           «санах ойгоос таахгүй, ишлэлтэй уншина» дүрэм
lib/db/schema.ts                  knowledge_articles (uniqueIndex slug+section),
                                  knowledge_reads (org+created_at index)
scripts/apply-pending-ddl.mjs §9  Идемпотент DDL
```

## 6. Фаз 2 — fork-ын хамгаалалт (хүний шийдвэр)

D7 нь «хавтас байхгүй бол алгас» гэдэг; одоогоор `knowledge/` core repo-д
хэвээр тул **fork харилцагч seed ажиллуулбал агуулга ачаалагдана**. Бүрэн
хамгаалалт:

1. `knowledge/01`, `02`, `04/skills`-ийг **хувийн repo** (`entry-knowledge`) руу зөөх
2. SaaS build-д тэр repo-г `KNOWLEDGE_DIR` болгож татах (build secret-ээр)
3. Core-оос файлуудыг хасах — хөгжүүлэгч хувийн repo-г локалдаа clone хийнэ
   (CLAUDE.md-ийн лавлагаанууд тэр зам руу заана)
4. (Сонголт) dedicated харилцагчид лицензээр sync: `GET /api/knowledge/sync`
   `ENTRY_LICENSE`-ээр — лиценз дуусвал sync зогсоно

Энэ алхам нь repo-г салгах зохион байгуулалтын шийдвэр тул кодоор биш,
эзэмшигч гүйцэтгэнэ.

## 7. Нээлттэй асуулт

- Dedicated харилцагчид мэдлэг хүртэх үү (§6.4)? → Console-оос шийднэ гэдэг
  загвар хоёуланг дэмжинэ; зөвхөн хүргэх механизм нэмэгдэнэ
- Өдрийн квот 200 хангалттай юу? `knowledge_reads`-ийн бодит хэрэглээгээр
  1 сарын дараа дахин үзнэ
