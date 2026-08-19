# Entry Accounting — Global судалгаа ба сайжруулалтын санал

**Огноо:** 2026-08-19
**Зорилго:** Entry Accounting-ийг *хамгийн хөнгөн, хурдан, энгийн бас хүчтэй* систем болгох, UI/UX-ыг дэлхийн шилдэг түвшинд хүргэх.
**Арга зүй:** 2025–2026 оны байдлаар дэлхийн 20+ accounting/fintech системийг гурван чиглэлээр судалсан:

1. **Mainstream SaaS** — QuickBooks Online, Xero, Zoho Books, FreshBooks, Wave, Sage, Odoo
2. **Open-source ба ledger архитектур** — ERPNext, Odoo Community, Akaunting, Manager.io, Firefly III, GnuCash, Beancount/hledger, Bigcapital, TigerBeetle, Modern Treasury, Square Books, pgledger
3. **Next-gen fintech UX** — Digits, Puzzle.io, Pennylane, Ramp, Mercury, Brex, Stripe, Runway, Midday, Linear/Superhuman-ы "instant" дизайн

Эх сурвалжийн линкүүд төгсгөлд болон хэсэг бүрд бий.

---

## 1. Гүйцэтгэлийн хураангуй

Entry Accounting-ийн одоогийн суурь нь дэлхийн шилдэг практиктай **аль хэдийн гайхалтай нийцтэй**: draft→post + human-in-the-loop загвар нь Digits/Puzzle-ийн "governed automation"-той, буцаалт-аар засах (append-only) зарчим нь TigerBeetle/Modern Treasury-ийн ledger философитой, "тайлан = журналын цэвэр функц" дүрэм нь Beancount-ы derivability зарчимтай, нэгдсэн tool давхарга (чат + MCP) нь 2026 оны AI-native чиг хандлагаас ч түрүүлж явна.

Судалгаагаар илэрсэн **хамгийн том 6 боломж**:

| # | Боломж | Жишиг систем | Нөлөө |
|---|--------|--------------|-------|
| 1 | Банкны тулгалтыг "нэг дэлгэцийн triage" болгох (ногоон match + нэг товч OK + rules engine) | Xero, QBO | Өдөр тутмын бүртгэлийн 80%-ийг нэг дэлгэцэд шахна |
| 2 | Итгэлийн түвшнээр (confidence) ангилсан "Батлахад бэлэн" багц | QBO, Digits | AI ноорог батлах ажлыг цөөн клик болгоно |
| 3 | Dashboard-ыг "ажлын дараалал + Монгол татварын хуанли" болгох | Ramp, Brex + өөрийн давуу тал | Хэрэглэгч өдөр бүр юу хийхээ шууд харна |
| 4 | Cmd+K палитр, "/" шилжилт, optimistic UI — "instant" мэдрэмж | Linear, Superhuman, Xero | Premium, хурдан мэдрэмж |
| 5 | DB түвшний invariant + периодын balance snapshot | Modern Treasury, Square, ERPNext-ийн сургамж | Найдвартай + тайлан O(данс) хурдтай |
| 6 | Тайлангийн тоо бүр даралттай (universal drill-down) + "Энэ тоог тайлбарлах" AI | Odoo, QBO, Runway | "Хүчтэй" мэдрэмжийн гол эх үүсвэр |

**Гол дүгнэлт:** Шинэ том модуль нэмэх шаардлагагүй. Одоо байгаа архитектурын давуу талуудыг **UI дээр мэдрэгдэхүйц** болгох, өдөр тутмын урсгалын клик тоог эрс багасгах, гүйцэтгэлийг Next.js 16-ийн боломжуудаар нээх — энэ гурав л "хөнгөн, хурдан, энгийн бас хүчтэй"-г бүтээнэ.

---

## 2. Одоогийн байдлын үнэлгээ

### 2.1 Global жишигт аль хэдийн нийцсэн зүйлс (хамгаалах ёстой давуу талууд)

- **Draft→Post + AI ноорог-first** — Digits, Puzzle, QBO-ийн AI агентууд бүгд яг энэ загварт 2025-26 онд шилжсэн. Entry анхнаасаа ийм.
- **Буцаалтаар засах, батлагдсаныг өөрчлөхгүй** — Modern Treasury, TigerBeetle, ERPNext-ийн нэгдсэн зарчим.
- **Тайлан = цэвэр функц, GL-ээс өртөг бодохгүй, нэг үнэлгээний суурь** — Beancount/hledger-ийн derivability философи.
- **externalRef idempotency + partial unique index** — Modern Treasury-ийн зөвлөдөг яг тэр загвар.
- **Advisory lock-той period close/post race хамгаалалт** — TigerBeetle-ийн "invariant-ыг транзакцын хил дотор" зарчим.
- **Нэгдсэн DataGrid, column type registry, дизайн токены нэг эх сурвалж** — Pennylane-ийн "domain-specific design system" туршлагатай ижил (тэд үүнийг хожуу хийж 4x хурдассан; Entry-д аль хэдийн бий).
- **audit_events** — FreshBooks 2025 онд сая нэмсэн, Wave-д огт байхгүй; Entry-д хэдийн бий.
- **Монгол татварын хуанли, НӨАТ/НДШ/ХАОАТ дүрэм кодлогдсон** — өрсөлдөгчгүй localization давуу тал.

### 2.2 Global жишигтэй харьцуулахад дутуу байгаа зүйлс

- Банкны тулгалт Xero-гийн "scan-and-click" түвшинд хараахан хүрээгүй (rules engine, ногоон match, batch accept).
- AI саналууд зөвхөн чат дотор амьдардаг — inline/ambient AI (тайлан дээрх "тайлбарлах", жагсаалт доторх confidence badge) байхгүй.
- Keyboard-first навигаци (Cmd+K, "/", "+") байхгүй.
- Dashboard нь ажлын дараалал (work queue) биш.
- Тайлангийн мөр бүрээс баримт хүртэл drill-down бүрэн гүйцэд биш.
- Onboarding: demo компани, setup checklist маягийн empty state байхгүй.
- DB түвшний Dr=Cr invariant, periodic balance snapshot байхгүй (UI guardrail-д л тулдаг).
- Next.js 16-гийн Cache Components / updateTag / React Compiler ашиглагдаагүй.

---

## 3. Судалгааны гол дүгнэлтүүд

### 3.1 Mainstream SaaS-аас (QBO, Xero, Zoho, FreshBooks, Wave, Sage, Odoo)

**Банкны feed бол нүүр хаалга.** QBO/Xero-д өдөр тутмын бүртгэлийн 80% нэг triage дэлгэцэд явагддаг. Xero-гийн тулгалтын UX салбартаа шилдэг: банкны мөр зүүн талд, санал болгож буй match баруун талд, итгэлтэй бол **ногоон** — хэрэглэгчийн ажил "ногоон мөрийг гүйлгэж хараад OK дарах" болж хувирдаг. Мөр бүрд Match / Create / Discuss / Transfer таб. 2025 оны сүүлээр JAX auto-reconciliation "мөрийн 80%+-ийг real-time тулгах" зорилттой beta гарсан. ([Numeric — Xero recon](https://www.numeric.io/blog/how-to-reconcile-in-xero), [Xero blog — JAX auto-rec](https://blog.xero.com/product-updates/automatic-bank-reconciliation-jax-beta/))

**Rules engine нь AI-аас өмнө ирдэг.** Хэрэглэгчийн өөрөө бичсэн, итгэдэг дүрэм ("гүйлгээний утга NYC ELECTRIC агуулбал → Цахилгааны зардал") нь суурь; AI санал нь түүн дээр confidence-тэйгээр давхарладаг. QBO дүрэмд 2 шат өгдөг: "form-ыг урьдчилан бөглөх" ба "асуулгүй шууд бичих" — итгэл өссөн хэрээр хэрэглэгч өөрөө шатлуулдаг. ([Fit Small Business](https://fitsmallbusiness.com/quickbooks-bank-feeds/))

**Confidence-ийг дүрсээр.** QBO-ийн 2025 AI banking хуудас санал бүрд ногоон/цэнхэр/улбар шар дохио өгдөг (хүчтэй түүх / хувьсамтгай түүх / өгөгдөл бага) ба өндөр итгэлтэйг **"Ready to post"** нэг багцад цуглуулж нэг товчоор batch баталдаг. ([Intuit](https://quickbooks.intuit.com/learn-support/en-us/help-article/matching-rules/learn-updates-new-ai-powered-banking-page/L0hR7A9Zf_US_en_US))

**Undo бол automation-ы итгэлийн суурь.** Автомат/нэг-товчны үйлдэл бүр тухайн жагсаалтаасаа нэг даралтаар буцдаг байх ёстой — үгүй бол хэрэглэгч automation-д итгэхээ больдог.

**Zoho CoCreate — хамгийн шилдэг AI handoff.** Хэрэглэгч гүйлгээгээ энгийн үгээр хэлэхэд AI **бодит формыг нүдэн дээр нь бөглөдөг**; "Take Control" дарж аль ч талбарыг гараар засаад "Resume Autofill"-ээр буцааж өгдөг. ([Zoho AI features](https://www.zoho.com/us/books/help/ai-features/ai-features.html))

**Anti-pattern сургамжууд:** (a) Xero-гийн "new invoicing" бослого — хурдан дэлгэцийг илүү олон клик шаарддаг "гоё" дэлгэцээр солиж болохгүй; (b) Wave-ийн гүехэн тайлан + audit trail-гүй байдал өсөж буй хэрэглэгчийг хөөдөг; (c) Odoo-гийн тохиргооны хана — хүчийг нарийн setup-ын цаана нуувал жижиг бизнес орж чадахгүй; (d) FreshBooks-ийн өсөлтийг шийтгэдэг paywall.

### 3.2 Ledger архитектур ба гүйцэтгэлээс (TigerBeetle, Modern Treasury, Square, pgledger, ERPNext)

- **Vanilla Postgres хангалттай хурдан:** pgledger — энгийн Postgres дээр ~10,600 transfer/сек, 1.9ms/transfer. SME accounting-д гүйцэтгэлийн шалтгаанаар ledger-ээ сулруулах ямар ч үндэслэл байхгүй. ([pgledger benchmarks](https://www.pgrs.net/2025/05/16/pgledger-in-postgresql-is-fast/))
- **Invariant-ыг хамгийн доод давхаргад:** UI шалгалт бол UX; хамгаалалт бол DB. CHECK constraint (Dr⊕Cr), commit үед шалгадаг deferred trigger (ΣDr=ΣCr), батлагдсан мөрийг UPDATE/DELETE-ээс хориглох trigger. Энэ нь AI/MCP/Excel импортын замуудыг ч хамгаална. ([Modern Treasury — immutability](https://www.moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger))
- **Anchoring pattern:** периодын хаалтад данс бүрийн үлдэгдлийн snapshot бичээд, тайлан = сүүлийн хаалттай snapshot + нээлттэй периодын delta. Хаагдсан период өөрчлөгддөггүй тул snapshot хэзээ ч хуучирдаггүй — cache invalidation асуудал бүтцээрээ арилдаг. Trial balance/BS/YTD тайлан O(бүх мөр)-өөс O(данс + нээлттэй сарын мөр) болно. ([MT Part VI](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-vi))
- **ERPNext-ийн сургамж:** ledger загвар нь биш framework overhead + дутуу composite index нь удаашруулдаг. Сая мөртэй GL тайлан зөв composite index-ээр 8-9 минутаас 1 минут болсон жишээ. ([Frappe forum](https://discuss.frappe.io/t/frappe-erpnext-database-optimization-best-practices-for-composite-indexing-in-custom-reports/158767))
- **Manager.io-гийн нууц:** архитектур биш, interaction бүр агшин зуурт байдагт нь хэрэглэгчид дуртай. Web-д үүний дүйцэл: жижиг working set + index + optimistic UI + prefetch.
- **Partitioning, balance-cache мөр, event sourcing — одоо хэрэггүй.** Хэрэгтэй болохоос нь өмнө нэмбэл зөвхөн complexity.

### 3.3 Next-gen UX-ээс (Digits, Ramp, Linear, Superhuman, Runway, Midday)

- **100ms дүрэм:** Superhuman interaction бүрийг <100ms (зорилт <50ms) гэж budget-лодог. Linear-ийн "instant" = optimistic mutation + локал кэш + зөвхөн transform/opacity animation (<250ms) + урьдчилан mount хийсэн modal.
- **Dashboard = хувцасласан to-do list.** Ramp-д гол талбайг ажлын дараалал эзэлдэг (батлах хүлээж буй, тулгагдаагүй, хаалтын явц); аналитик хоёрдугаар түвшинд. Brex: "анхаарал шаардсаныг үзүүл, хэвийн явааг нуу."
- **Digits-ийн inbox-first + confidence routing:** өндөр итгэлтэй нь автоматаар (эсвэл bulk confirm), бага итгэлтэй нь review inbox-д. Confidence-ийг хувиар биш **чиглүүлэлтээр** ашигладаг.
- **Runway-ийн ambient AI:** ямар ч метрик дээр hover хийхэд өөрийн чинь датанаас гарсан энгийн үгийн тайлбар; variance автоматаар тодрдог. Chat биш — insight ажлын байрандаа ирдэг.
- **Side-peek > modal:** контекстээ алдалгүй, нээлттэй байхдаа prev/next сумаар бичлэг хооронд шилждэг side panel нь хамгийн scalable дэлгэрэнгүй харагдац. (Entry-ийн PanelHost үүнд аль хэдийн ойрхон.)
- **Midday** (Next.js + Tailwind + shadcn, open source) — Entry-тэй бараг ижил stack дээрх шилдэг лавлагаа хэрэгжилт: [github.com/midday-ai/midday](https://github.com/midday-ai/midday).
- **Тооны typography:** мөнгөн дүн бүрд `font-variant-numeric: tabular-nums`, жинхэнэ хасах тэмдэг (U+2212), тогтмол бутархай орон. Өнгө зөвхөн төлөв заана (Stripe дүрэм); Дт/Кт-г зөвхөн өнгөөр ялгаж болохгүй (өнгөний харалган ~8%).

---

## 4. Сайжруулалтын саналууд

Тэмдэглэгээ: **[P0]** = хамгийн өндөр нөлөө/өртөг харьцаа, эхлээд. **[P1]** = дараагийн давалгаа. **[P2]** = стратегийн. Хэмжээ: S (≤1 өдөр), M (2–5 өдөр), L (1–3 долоо хоног).

### 4.1 "Хурдан мэдрэмж" — Performance & instant UX

**П1. [P0/S] Мөнгөн typography-г нэг дороос засах.**
`lib/grid/columnTypes.ts`-ийн `number-money`/`debit`/`credit`/`readonly-money` төрлүүд болон KPI/тайлангийн бүх мөнгөн текстэд `tabular-nums` (Tailwind класс эсвэл `font-variant-numeric`), сөрөг дүнд U+2212 буюу нягтлангийн хаалт `(1,234.00)` конвенц (нэгийг сонгоод бүх системд мөрдөх), тогтмол 2 орон. Багахан өөрчлөлт — итгэл төрүүлэх нөлөө нь том.

**П2. [P0/M] Next.js 16-гийн боломжуудыг асаах.**
- `next.config.ts`: `cacheComponents: true` + `reactCompiler: true` (build хугацааг хэмжиж баталгаажуулна).
- Статик shell (sidebar, тохиргооны лавлах, дансны мод, segment configs) — `"use cache"`; динамик grid дата — Suspense boundary-аар stream.
- Mutation бүрийн дараа `updateTag()` — read-your-writes (батлаад буцахад жагсаалт шинэ байх).
- page.tsx доторх бие даасан fetch-үүдийг `Promise.all` болгож waterfall-ыг арилгах audit (App Router-ийн №1 хоцролтын эх үүсвэр).
- Server Action нь нэг клиент дээр цуваа ажилладаг тул зөвхөн mutation-д, нэг транзакц, цөөн round-trip.

**П3. [P0/S] Ledger index + хэмжилт.**
`journal_lines (user_id, account_code, date) INCLUDE (debit, credit)` covering index + `journal_vouchers (user_id, status, date)`; Railway дээр `pg_stat_statements` асааж сард нэг top-10 query шалгах. App ба Postgres нэг region/private network байгааг баталгаажуулах (DB round-trip нь Server Action latency-ийн дийлэнх).

**П4. [P1/M] Optimistic UI-г системийн дүрэм болгох.**
Grid засвар Zustand patch-аар шууд харагдана (одоо байгаа) — үүнийг **post/батлах/статус солих** үйлдлүүдэд өргөтгөнө: товч дармагц мөрийн статус шууд солигдож, Server Action-ы хариугаар тулгаж, алдвал rollback (grid-store-ын patch/undo дэд бүтэц rollback-ийн бэлэн примитив). Spinner-гүй бичилт = Linear мэдрэмж.

**П5. [P1/S] Лавлах датаг клиент талд кэшлэх.**
Дансны мод, харилцагч, бараа, агуулах — session-д нэг удаа ачаалж Zustand/context-д. Picker, палитр, editor нэг ч удаа network хүлээхгүй болно. (Linear-ийн "локал read model"-ын хөнгөн хувилбар — sync engine хэрэггүй.)

**П6. [P2/M] AG Grid нарийн тохиргооны audit.**
Тогтмол `getRowId`, column def-үүдийг render бүрд дахин үүсгэхгүй (React Compiler ихийг нь автоматаар шийднэ), текст гаралтад cell renderer биш `valueFormatter`, шинэчлэлтэд `applyTransaction`. Нэг шүүлттэй датасет ~10-20k мөрөөс хэтрэх магадлалтай жагсаалтад SQL-түвшний хуудаслалт.

### 4.2 Банкны тулгалт — системийн "нүүр хаалга" болгох

**П7. [P0/L] Xero-загварын нэг дэлгэцийн triage.**
Банкны хуулгын тулгалтыг дараах хэлбэрт: мөр бүр зүүн талд хуулгын гүйлгээ, баруун талд санал болгож буй match (касс баримт / АР-АП нэхэмжлэх / шинэ гүйлгээний ноорог); итгэлтэй match **ногоон** + мөр бүрд нэг **"OK"** товч; таб: Тулгах / Үүсгэх / Шилжүүлэг. Batch: checkbox-оор олныг сонгоод нэг товчоор. Тулгагдсан мөрөөс нэг даралтаар **буцаах** (undo) + audit event. Одоо байгаа автомат тулгалтын логик дээр UI давхарга нэмэх хэлбэрээр.

**П8. [P1/M] Хэрэглэгчийн bank rules engine.**
`bank_rules` хүснэгт: нөхцөл (утга агуулна / дүн / данс) → үйлдэл (данс, харилцагч, тайлбар бөглөх). Хоёр түвшин: "урьдчилан бөглөх" ба "шууд ноорог үүсгэх" (draft-first §9-тэй нийцнэ). AI санал rules-ийн ДАРАА, confidence badge-тэйгээр давхарлана.

**П9. [P1/M] Confidence дохио + "Батлахад бэлэн" багц.**
Тулгалтын санал ба AI ноорог бүрд 3 түвшний дохио (хүчтэй түүх / хувьсамтгай / өгөгдөл бага — QBO загвар). Өндөр итгэлтэйг "Батлахад бэлэн" filter chip-д цуглуулж, нэг batch post товч (одоо байгаа `post_*_batch` tools-ыг UI-д ашиглана). Бага итгэлтэй нь review дараалалд үлдэнэ — Digits-ийн confidence routing.

### 4.3 Навигаци ба keyboard-first UX

**П10. [P0/M] Cmd+K командын палитр.**
Нэг палитраас: данс/харилцагч/бараа/баримт хайх (П5-ын клиент кэшээс — network-гүй), хуудас руу шилжих, үйлдэл эхлүүлэх ("Шинэ журнал", "Сар хаах", "НӨАТ тайлан"). shadcn/cmdk-ээр S-M хэмжээтэй. Linear/Superhuman/Digits-ийн хамгийн их иш татагддаг "premium" pattern.

**П11. [P0/S] "/" шилжилт + глобал quick-create.**
Xero загвар: "/" дараад товчлол ("ж" → журнал, "х" → харилцагч...), топбарын "Шинэ журнал"-ыг "+ Шинэ" глобал цэс болгож аль ч дэлгэцээс аль ч баримт үүсгэх. Keyboard shortcut-ын тусламжийн overlay (`?` дарахад).

**П12. [P2/M] Навигацийн хувийн тохиргоо.**
Модуль олширсон тул: хэрэглэгч sidebar-даа хэрэглэдэг 5-6 хуудсаа pin хийж бусдыг "Бусад" доор нуух (QBO-ийн customizable nav). Цаашид "Эзэн" vs "Нягтлан" гэсэн хоёр nav preset (QBO-ийн Business/Accountant view) авч үзэх.

### 4.4 Dashboard — ажлын дараалал + Монголын давуу тал

**П13. [P0/M] Нүүрийг work queue болгох.**
Дээд хэсэгт даралттай картууд: "N ноорог журнал батлагдахыг хүлээж байна", "N тулгагдаагүй банкны мөр", "N бага итгэлтэй AI бичилт", "Сар хаалт 3/7 алхам" (`get_month_end_checklist`-ийн дата бэлэн). Аналитик доор нь. Ramp/Brex-ийн exception-first зарчим: анхаарал шаардсаныг үзүүл, хэвийн явааг нуу.

**П14. [P0/S-M] Татварын хуанлийн зурвас.**
НӨАТ (дараа сарын 10), НДШ (5), ХАОАТ (10), ААНОАТ (улирлын дараа 20) — үлдсэн хоногийн тоо + төлөв (тайлан ноорогдсон уу? тооцооны журнал үүссэн үү?). Кодод бүх дүрэм хэдийн бий — картаар үзүүлэхэд л болно. **Баруун өрсөлдөгчдийн хэнд ч байхгүй, Entry-ийн хамгийн үнэ цэнтэй dashboard элемент.**

**П15. [P1/M] KPI картууд.**
Өнөөдрийн мөнгөн байрлал (бүх касс+банк, нэг тоо, sparkline), АР aging (buckets + топ харилцагчийн төвлөрөл — `get_counterparty_balance` бэлэн), АП aging, орлого/зардлын сарын тренд. 12-18 KPI-аас хэтрэхгүй; карт бүр тайлан руу, тайлан баримт руу drill-down. График хийвэл dataviz skill-ийн зарчмаар.

### 4.5 Хүснэгт ба жагсаалтын UX

**П16. [P1/S] Мөрийн нягтралын сонголт.**
Toolbar дээр 3 түвшин (шахсан 32-36px / энгийн / өргөн), хэрэглэгч бүрд хадгалагдана. Excel-ээс ирсэн нягтлан шахсаныг, шинэ хэрэглэгч өргөнийг сонгоно.

**П17. [P1/M] Saved views — хадгалсан харагдац.**
Шүүлт+эрэмбэ+баганы онилгоог нэрлэж хадгалах ("Батлагдаагүй нэхэмжлэх", "Энэ сарын НӨАТ-тэй гүйлгээ"). URL-д кодлогдоно — deep link хэвээр ажиллах одоогийн дүрэмтэй (URL парам cookie-г дарна) шууд нийцнэ, share хийж болно.

**П18. [P1/S-M] Side-peek панельд prev/next.**
Нээлттэй панель дотроос ↑/↓ буюу товчоор жагсаалтын өмнөх/дараагийн баримт руу шилжих — жагсаалт руу буцах шаардлагагүй болно. Bulk сонголттой үед floating action bar (сонгосон тоо + Батлах/Устгах/Экспорт) — зөвхөн мөр сонгогдсон үед гарч ирнэ.

**П19. [P2/S] Empty state = дараагийн алхам.**
Хоосон grid-д "Мөр алга" биш: "Банкны хуулга импортлох", "Эхний үлдэгдэл оруулах" гэх мэт дараагийн setup алхмын товч. Нэмээд бүх модулийг хамарсан setup checklist нүүрэнд (QBO загвар) — onboarding нь бүтээгдэхүүн дотроо амьдардаг болно.

**П20. [P2/M] Demo компани.**
Бодит Монгол жишээ дататай (худалдааны компани, 2-3 сарын гүйлгээ, цалин, НӨАТ) seed-лэгдсэн демо горим — шинэ хэрэглэгч өөрийн дата оруулахаас өмнө аюулгүй туршина (QBO test drive / Xero demo company).

### 4.6 AI — чатнаас ambient руу

**П21. [P1/M] "Энэ тоог тайлбарлах".**
Тайлангийн нүд/мөр дээр affordance: дарахад одоо байгаа tool давхарга (`get_account_ledger`, `reconcile_modules`) ажиллаж, тухайн дүнг бүрдүүлсэн гол гүйлгээнүүдтэй нь энгийн үгээр тайлбарлана — газар дээр нь, чат нээлгүй (Runway/Numeric-ийн 2025-26 ялгарлын pattern). 72-tool архитектур үүнд онцгой бэлэн.

**П22. [P1/S] AI-гаралтай бичилтийн badge + шүүлт.**
AI-ийн үүсгэсэн ноорог жагсаалтад тод badge-тэй, filter chip-ээр шүүгддэг, audit log-т ил. (Compliance шаардлага болж буй "Disclosure" pattern.)

**П23. [P1/S] AI-ийн tool дуудлагыг ил стримлэх.**
Чатанд "Гүйлгээ баланс уншиж байна… АР aging шалгаж байна…" гэж харуулах — хүлээлтийн мэдрэмжийг багасгаж, хариултын итгэлийг нэмнэ.

**П24. [P2/L] eBarimt/PDF → АП нэхэмжлэхийн ноорог (OCR).**
Одоо байгаа AI attachment pipeline-аар: НӨАТ-ын баримт/PDF-ээс ханган нийлүүлэгч, мөр, НӨАТ-ыг задлаад draft АП үүсгэх, ДДТД-гээр idempotent (externalRef хэдийн бэлэн). Odoo-ийн хамгийн магтагддаг feature-ийн Монгол хувилбар.

**П25. [P2/L] Zoho CoCreate-загварын live форм бөглөлт.**
AI хариу нь бэлэн объект биш — бодит форм дээр талбар бүрийг бөглөж явааг харуулж, "Take Control"-оор хэрэглэгч дундаас нь авах. ActionCard → энэ чиглэлд хувьсах урт хугацааны зорилт.

### 4.7 Ledger бат бөх байдал + тайлангийн хурд

**П26. [P0/S-M] DB түвшний invariant-ууд.**
- `journal_lines`-д CHECK: `(debit>=0 AND credit>=0)` ба `((debit>0)<>(credit>0) OR (debit=0 AND credit=0))`.
- Ваучер бүрд ΣDr=ΣCr — `DEFERRABLE INITIALLY DEFERRED` constraint trigger (олон мөрийн insert дуусаад commit үед шалгана).
- Батлагдсан ваучерын мөрөнд UPDATE/DELETE хориглох trigger (буцаалт нь шинэ бичилт тул саадгүй).
Энэ нь UI-г тойрдог бүх зам (AI, MCP, Excel импорт, batch)-ыг хамгаална.

**П27. [P0/S] Шөнийн integrity assertion.**
"Хэзээ ч мөр буцаахгүй байх ёстой" query (батлагдсан ваучеруудаас ΣDr≠ΣCr шүүх) + `reconcile_modules`-ыг cron-оор ажиллуулж, үр дүнг сар хаалтын checklist-д үзүүлэх. Beancount-ы assertion философи — итгэл бүтээдэг.

**П28. [P1/M] Периодын balance snapshot (anchoring).**
`account_period_balances (user_id, account_code, period, opening_dr/cr, period_dr/cr)` — period close дээр бичигдэнэ (close-ын snapshot урсгалд нэмнэ). Тайлан = сүүлийн хаалттай snapshot + нээлттэй сарын delta. Хаагдсан период immutable тул snapshot хэзээ ч хуучирдаггүй. Дата өссөн ч Trial balance/BS/YTD тогтмол хурдтай.

**П29. [P2/—] Юуг ХИЙХГҮЙ байх.**
Partitioning, балансын synchronous cache мөр, event sourcing, FIFO/perpetual costing — одоогийн масштабд зөвхөн complexity нэмнэ. pgledger-ийн benchmark (Postgres дээр 10k transfer/сек) энэ шийдвэрийн баталгаа.

---

## 5. Хэрэгжүүлэлтийн Roadmap

### Үе 1 — "Хурдан ялалтууд" (~2 долоо хоног)

| Санал | Хэмжээ |
|-------|--------|
| П1 Мөнгөн typography (tabular-nums, −, хаалт) | S |
| П3 Ledger index + pg_stat_statements | S |
| П11 "/" шилжилт + глобал "+ Шинэ" + `?` тусламж | S |
| П26 DB invariant-ууд | S-M |
| П27 Шөнийн integrity check | S |
| П14 Татварын хуанлийн зурвас | S-M |
| П2 Next 16: cacheComponents, updateTag, React Compiler, Promise.all audit | M |

**Үр дүн:** мэдэгдэхүйц хурд + итгэлийн суурь + өдөр тутмын премиум мэдрэмжийн эхлэл.

### Үе 2 — "Өдөр тутмын урсгалыг эвдэх" (~1 сар)

| Санал | Хэмжээ |
|-------|--------|
| П10 Cmd+K палитр (+П5 клиент кэш) | M |
| П13 Dashboard work queue + П15 KPI картууд | M+M |
| П7 Банкны тулгалтын Xero-загварын triage | L |
| П9 Confidence дохио + "Батлахад бэлэн" багц | M |
| П4 Optimistic UI-г post урсгалд | M |
| П16 Нягтралын сонголт, П18 панелийн prev/next + bulk bar | S+S-M |

**Үр дүн:** өдөр тутмын бүртгэл нэг дэлгэц + цөөн клик; систем "хүчтэй" мэдрэгдэж эхэлнэ.

### Үе 3 — "Стратегийн ялгарал" (~2-3 сар)

| Санал | Хэмжээ |
|-------|--------|
| П8 Bank rules engine | M |
| П21 "Энэ тоог тайлбарлах" ambient AI | M |
| П17 Saved views, П22-П23 AI badge/стрим | M+S+S |
| П28 Периодын balance snapshot | M |
| П24 eBarimt OCR → АП ноорог | L |
| П19-П20 Setup checklist + Demo компани | S+M |
| П12 Nav тохиргоо, П25 CoCreate-загвар, П6 AG Grid audit | M+L+M |

**Үр дүн:** Монголын зах зээлд өрсөлдөгчгүй AI-native, localized accounting туршлага.

---

## 6. Зарчмын шугам (шийдвэр гаргахад барих)

1. **Клик тоол.** Шинэ дэлгэц хуучин урсгалаас нэг ч илүү клик шаардвал гаргахгүй (Xero invoicing сургамж).
2. **Тоо бүр даралттай.** Тайлан/dashboard-д "үхмэл тоо" байхгүй — бүгд ledger хүртэл drill-down.
3. **Automation бүр undo-той.** Буцаах товчгүй автоматжуулалт итгэл эвддэг.
4. **AI = чиглүүлэгч, шийдэгч биш.** Confidence нь хувь биш — дараалал руу чиглүүлэлт. Draft-first хэвээр.
5. **Хүчийг default-д нуу, тохиргоонд биш.** Odoo-гийн тохиргооны хана бол anti-pattern; ухаалаг default + аажим нээгдэх хүч.
6. **Invariant доошоо, UX дээшээ.** Хамгаалалт DB-д, хурд мэдрэмж клиентэд.
7. **Нэг эх сурвалж хадгал.** Тайлан = цэвэр функц, өртөг = cost_period_results, токен = tokens.css — энэ дүрмүүд системийг "хөнгөн" байлгадаг гол хүч.

---

## 7. Гол эх сурвалжууд

**SaaS UX:** [Numeric — Xero reconciliation](https://www.numeric.io/blog/how-to-reconcile-in-xero) · [Xero — JAX auto-rec](https://blog.xero.com/product-updates/automatic-bank-reconciliation-jax-beta/) · [Intuit — AI banking page](https://quickbooks.intuit.com/learn-support/en-us/help-article/matching-rules/learn-updates-new-ai-powered-banking-page/L0hR7A9Zf_US_en_US) · [Intuit — customizable nav](https://quickbooks.intuit.com/ca/resources/accountants/quickbooks-launches-new-customizable-left-navigation-menu/) · [Zoho Books AI](https://www.zoho.com/us/books/help/ai-features/ai-features.html) · [Sage Copilot](https://www.sage.com/en-us/news/press-releases/2025/02/celebrating-one-year-of-sage-copilot/) · [Odoo vendor bill OCR](https://www.odoo.com/documentation/18.0/applications/finance/accounting/vendor_bills/invoice_digitization.html) · [Xero new invoicing backlash](https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/49072718-new-invoicing-classic-invoicing-to-remain-defaul)

**Ledger архитектур:** [TigerBeetle — Debit/Credit schema](https://docs.tigerbeetle.com/concepts/debit-credit/) · [Modern Treasury — How to Scale a Ledger](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-i) · [MT — Immutability](https://www.moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger) · [Square Books](https://developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/) · [pgledger](https://www.pgrs.net/2025/03/24/pgledger-ledger-implementation-in-postgresql/) · [pgledger benchmarks](https://www.pgrs.net/2025/05/16/pgledger-in-postgresql-is-fast/) · [ERPNext indexing](https://discuss.frappe.io/t/frappe-erpnext-database-optimization-best-practices-for-composite-indexing-in-custom-reports/158767) · [hledger philosophy](https://hledger.org/faq.html) · [Bigcapital](https://github.com/bigcapitalhq/bigcapital)

**Instant UX:** [Superhuman — built for speed](https://blog.superhuman.com/superhuman-is-built-for-speed/) · [How is Linear so fast](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) · [Pennylane — navigation case study](https://medium.com/@pennylanedesign/designing-for-productivity-a-case-study-on-the-new-navigation-of-pennylane-software-98756635238a) · [Pennylane — domain design system](https://medium.com/@pennylanedesign/our-core-design-system-was-not-enough-why-we-built-a-domain-specific-design-system-738db54cec48) · [Midday](https://github.com/midday-ai/midday) · [Digits AI agents](https://www.cpapracticeadvisor.com/2025/06/23/digits-rolls-out-ai-agents-for-accounting-workflows/163521/) · [Runway ambient AI](https://globalfintechseries.com/finance/runway-launches-first-ambient-intelligence-platform-for-finance-teams/) · [Shape of AI patterns](https://www.shapeof.ai/) · [Pencil & Paper — data tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) · [Fintech typography](https://medium.com/design-bootcamp/the-elements-of-fintech-typography-part-1-readable-money-b6c1226acbde)

**Next.js 16:** [Next.js 16 release](https://nextjs.org/blog/next-16) · [Server Actions performance](https://pasquale-favella.github.io/blog/27) · [AG Grid row models](https://www.ag-grid.com/react-data-grid/row-models/)
