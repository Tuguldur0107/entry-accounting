# Мэдлэгийн сан (хэрэглэгчид хүргэх)

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (§9e). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

### 9e. Мэдлэгийн сан — хэрэглэгчид хүргэх (Фаз 1–2 ХЭРЭГЖСЭН)

Баримт: `docs/knowledge/00-proposal.md` (D1–D7 БАТЛАГДСАН 2026-09-23) — ЗААВАЛ уншина.
Агуулга (`01-онол-хууль-стандарт`, `02-нягтлан-бодох-мэргэжлийн`,
`04-ai-agent/skills`) нь **ХУВИЙН repo `Tuguldur0107/entry-knowledge`**-д
(фаз 2, 2026-09-25) — core repo-д, fork харилцагчид ОЧИХГҮЙ; «AI нягтлан»
бүтээгдэхүүний гол агуулга. Production-д **Railway service `knowledge-sync`**
(эх нь `entry-knowledge` repo, Railway-ийн GitHub холболтоор — token-гүй, хугацаа
дуусахгүй) `main`-д push бүрд `sync/seed.mjs`-ээр `knowledge_articles`-д
ачаалаад гарна (`DATABASE_URL=${{entry-accounting.DATABASE_URL}}`; алдаанд exit 1 →
Crashed → Railway мэдэгдэл); хэрэглэгчийн MCP-д (ChatGPT / Claude)
**хэсгээр** уншигдана. Хэрэглэгчид файл хэзээ ч очихгүй. Core-ийн `knowledge/`
хавтсанд зөвхөн `03-стандарт` (хөгжүүлэлтийн лавлагаа) үлдсэн.

```
scripts/lib/knowledge-parse.mjs  ЦЭВЭР parser (тесттэй): frontmatter, `## ` = хэсэг,
                                 slug (`ifrs/ias-16`), ангилал замаас, хамрах хүрээ
scripts/seed-knowledge.mjs       preDeploy сүүлийн алхам: эх сурвалж KNOWLEDGE_REPO
                                 (tarball) → KNOWLEDGE_DIR/./knowledge → алгасна (fork);
                                 upsert (slug, section), sha256 алгасалт; устгалт ЗӨВХӨН
                                 эх сурвалж БҮРЭН үед (санг хэзээ ч хоослохгүй)
scripts/lib/knowledge-source.mjs ЦЭВЭР (тесттэй): extractTarFiles (pax/кирилл зам),
                                 isCompleteKnowledgeSource, normalizeKnowledgeRepo
lib/knowledge/catalog.ts         ЦЭВЭР (тесттэй): тогтмол, clampSection, formatTopicIndex /
                                 formatSection, normalizeTopicSlug (path traversal татгалзана)
lib/knowledge/store.ts           DB: list/read/countReadsToday/recordRead/stats — эрхийн
                                 шалгалт БАЙХГҮЙ (нийтийн лавлах), дуудагч шалгана
lib/ai/tools.ts                  list_knowledge_topics / read_knowledge_section
```

Хатуу дүрмүүд:

- **Хандалт ЗӨВХӨН багцын `knowledge` боломжоор** (`plans.ts`, D2′ 2026-09-24):
  SaaS-ийн нягтлан бодох багц бүрд ҮНЭГҮЙ; dedicated-д OFF; систем
  ашиглахгүй хэрэглэгч **«AI нягтлан» (`skills`)** — 29,000₮/сар, trial 24 цаг,
  `/register?plan=skills`. Захиалгын бүтээгдэхүүн тул read-only үед хаагдана
  (`featureUsable`). Кодод `if plan === …` ХОРИОТОЙ (billing дүрэм хэвээр).
  НЭВТЭРСЭН хэрэглэгч энэ линкийг нээвэл proxy самбар руу ҮСЭРГЭХГҮЙ
  (`lib/auth-redirect.ts`, тесттэй) — бүртгэлийн хуудас «багцад аль хэдийн
  багтсан → холбох заавар» / «гараад шинэ бүртгэл» сонголт харуулна
  (`components/skills/skills-signed-in.tsx`). Console хэрэглээг
  `GET /api/platform/subscriptions` (`knowledgeReads30d`, `oauthConnections`,
  `lastConnectorUseAt` — Console-ийн «AI нягтлан» хуудас) ба байгууллагын
  дэлгэрэнгүйн `aiAccountant` (уншилт, OAuth холболт, сүүлд ашигласан) — ТОО л
- **`skills` багцад нягтлан бодох систем (`accounting` боломж) ХААЛТТАЙ** — хямд
  багцаар бүх системийг үнэгүй ашиглах зам болохоос сэргийлнэ: `requireModuleAction`
  (уншилт ч, `assertModuleEntitlements`), `ModuleGuard`, AI/MCP tool
  (`lib/billing/tool-scope.ts` `ACCOUNTING_FREE_TOOLS` — `tools/list` шүүлт +
  `executeAiTool` хаалт), вэб нүүр = НЭГ хуудас (`components/skills/skills-home.tsx`:
  давуу тал → ① төлбөр/сунгах (`SkillsPay`, QR диалог нь billing-тэй НЭГ) →
  ② холбох); `/settings/billing` нүүр рүү redirect, топбарын багцын баннер гарахгүй. Шинэ
  tool нэмэхэд skills-д нээх эсэхийг ЗӨВХӨН `ACCOUNTING_FREE_TOOLS`-оор шийднэ.
  Тест `tests/billing-skills.test.ts`, `tests/skills-plan-flow.test.ts` (DB)
- **Хэсгээр л** — «бүгдийг буцаах» параметр, сэдвийг бүтнээр өгөх зам НЭМЭХГҮЙ;
  хэсэг `KNOWLEDGE_MAX_SECTION_CHARS`-аар таслагдвал ИЛ хэлнэ
- **`surfaces: ["mcp"]`** — REST-д ГАРАХГҮЙ (`aiToolsForSurface("rest")`
  жагсаалт ба дуудлага хоёуланд шүүнэ). Шинэ tool consumer нэмбэл
  `aiToolsForSurface(<зам>)`, `allAiTools()` шууд БИШ
- Уншилт бүр `knowledge_reads` (аудит БИШ); 24ц квот `KNOWLEDGE_DAILY_READ_LIMIT`
  DB-ээс тоологдоно — in-memory rate limit ХЭРЭГЛЭХГҮЙ (олон instance)
- AI хариултдаа ишлэлээ ЗААВАЛ дурдана; санах ойгоос таахгүй (system prompt)
- **Фаз 2 ХИЙГДСЭН (2026-09-25):** агуулга `entry-knowledge` хувийн repo-д; fork-ын
  preDeploy эх сурвалжгүй тул юу ч ачаалахгүй. Production-ийг ЗӨВХӨН `knowledge-sync`
  service бичнэ — `entry-accounting`-д `KNOWLEDGE_REPO*` env ТАВИХГҮЙ (хоёр бичигч
  болж parser зөрвөл хэсгүүд устаж/үүснэ). Core-ийн tarball зам
  (`KNOWLEDGE_REPO` + `KNOWLEDGE_REPO_TOKEN`) нь нөөц / dedicated sync-д үлдсэн.
  **`entry-knowledge/sync/knowledge-parse.mjs` = `scripts/lib/knowledge-parse.mjs`-ийн
  ИЖИЛ хуулбар** — parser өөрчилбөл хоёуланг нь; `knowledge_articles`-ийн багана
  өөрчилбөл `sync/seed.mjs`-ийг хамт. Бүрэн биш эх сурвалж (01, 02, 04-skills
  гурвуулаа биш) → DB ХЭВЭЭР, устгахгүй. Сонголт (§6.4, хийгдээгүй): dedicated
  харилцагчид `ENTRY_LICENSE`-ээр sync
- **Хөгжүүлэлтэд:** `entry-knowledge`-ийг core-ийн хажууд `../entry-knowledge` болгон
  clone хийнэ (Claude Code web-д repo-г session-д нэмнэ); `CLAUDE.md`-ийн
  `entry-knowledge/…` лавлагаа тэр repo-г заана. Локал DB-д:
  `KNOWLEDGE_DIR=../entry-knowledge node scripts/seed-knowledge.mjs`
