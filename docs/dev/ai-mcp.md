# AI tool давхарга, MCP сервер, анхны туршилт

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (§9a–§9b). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

### 9a. AI tool давхарга — MCP + REST (апп доторх чат ХАСАГДСАН)

**2026-09-25: апп доторх AI чат (BYO API түлхүүр, Anthropic/OpenAI adapter,
`ai_messages`) хасагдсан.** Хэрэглэгч ӨӨРИЙН ChatGPT / Claude-оос MCP-ээр
(§9b) ижил tool давхаргаар ажиллана — Entry AI-ийн API зардал төлөхгүй,
хэрэглэгч түлхүүр хуулахгүй. Вэбийн `/settings/ai` = Тохиргоо → «AI холболт» НЭГ хуудас (2026-09-26 хүртэл тусдаа модуль `/ai` байв)
(`components/ai/ai-connect-view.tsx`): ① холбох заавар (`components/skills/
connect-guide` — AI нягтлантай НЭГ), ② бичилтийн горим (`lib/ai/write-mode.ts`
ЦЭВЭР, `write-mode-store.ts` DB, `actions/ai-write-mode.ts` — ноорог / шууд
бичих, `ai_settings.write_mode`, MCP ба REST-д НЭГ, аудитад бичигдэнэ),
③ token (Claude Code / Codex); мөн «Эхлээд ингэж асуу» бэлэн асуултууд
(`#starter-prompts`). `/ai`, `/ai/settings` → `/settings/ai` redirect. Модулийн
түлхүүр `ai` ХЭВЭЭР (эрхийн бүртгэл хөндөгдөхгүй), нэр «AI холболт»; багцын
`ai` боломж ХАСАГДСАН (`mcp` + `knowledge` л). Топбарын AI товч, хөвөгч чат
панель, `actionMarker` байхгүй; `AiAction` төрөл (`action-markers.ts`) tool
үр дүн + AI бүртгэлд үлдсэн. АР/АП-ийн «eBarimt импорт» (PDF/зураг → сервер
Anthropic vision → ноорог, П24) мөн хасагдсан — хэрэглэгч баримтын зургаа
ChatGPT / Claude-даа өгөхөд `create_arap_invoice`-оор ижил ноорог үүснэ.
**Entry-ийн сервер AI-ийн API дуудахгүй, `ANTHROPIC_API_KEY` env байхгүй,
`@anthropic-ai/sdk` хамаарал үгүй.** Чат / серверийн AI буцааж нэмэхийг
ХОРИГЛОНО — MCP л.

**Анхны туршилт = AI-тай НЭВТРҮҮЛЭЛТ** (`lib/onboarding/first-run.ts` ЦЭВЭР,
тесттэй; DB `first-run-db.ts`; `components/dashboard/welcome-card.tsx`): нүүрний
ДЭЭД карт «Өөрийн компаниа 15 минутад Entry-д» — ① ChatGPT / Claude-даа холбох
(өөрийн компанид; OAuth идэвхтэй байгууллагад уягддагийг ил хэлнэ) → ② хуучин
датагаа өгөх (экспорт / Excel → данс, харилцагч, бараа, ажилтан) → ③ нээлтийн
үлдэгдэл + тэнцлийн шалгалт. Алхам бүр ӨГӨГДЛӨӨС ✓ (OAuth/token мөр —
хэрэглэгчийн түвшинд; харилцагч/бараа/ажилтан; журнал). **Демо компани картад
БАЙХГҮЙ** — зохиомол дата үнэ цэнийг хойшлуулж, холболтыг дахин хийлгэдэг; карт
харагдаж байхад `SetupChecklist`-ийн П20 демо мөр ч нуугдана (`showDemo={!welcome}`),
`tests/first-run.test.ts` статикаар барина. **Хөдөлгөөн** (CSS л, `globals.css`,
reduced-motion-д унтарна): баганууд ээлжлэн гарна (`ea-stagger`), ОДОО хийх алхам
(`activeStepKey` — эхний хийгдээгүй) өргөн + хүрээ пульс, дараагийнх бүдэг, ✓ болоход
нэг удаа «поп» (`StepBadge`, харсныг localStorage-д санана), хуулах товч 1.5 сек ✓
(`lib/hooks/use-copy-flash.ts`). Харагдах нөхцөл `shouldShowWelcome`: хаагаагүй
(`users.welcome_dismissed_at`, `dismissWelcome`), демо компани биш, 3 алхам
дуусаагүй, мөн туршилт эсвэл журналгүй байгууллага — идэвхтэй харилцагчид ХЭЗЭЭ
Ч гарахгүй. Демогийн нэр `DEMO_ORG_NAME` НЭГ эх. **Бэлэн асуултууд
`STARTER_PROMPTS`** (эхний 3 = нэвтрүүлэлт) нь нүүрний карт, `/settings/ai`, «AI нягтлан»
нүүр, MCP `prompts/list` · `prompts/get` (ChatGPT / Claude-ийн «+» / «/» цэс) ба
`instructions`-ийн жишээ — нэг эхээс, багцаар (`accounting` / `knowledge`)
шүүгдэнэ; `id` = MCP нэр, ӨӨРЧЛӨХГҮЙ. Асуулт нэмэхэд зөвхөн энэ жагсаалтад.

MCP, REST API хоёулаа НЭГ tool давхаргаар (lib/ai/tools.ts, 149 core tool + custom/)
системийн бүх модульд ажиллана. Бүлгүүд:

| Бүлэг | Tools | Горим |
|-------|-------|-------|
| Үүсгэх | create_journal_voucher, create_arap_invoice, create_credit_note (нэхэмжлэхийн буцаалт — §5d), create_cash_transaction (applyTo-гоор нэхэмжлэхэд холбоно), create_inventory_movement, create_fixed_asset, pay_arap_document | ноорог (post горимд ≤10M шууд) |
| Засах/устгах | update_{journal_voucher,inventory_movement}, delete_{journal_voucher,cash_document,arap_document,inventory_movement,fixed_asset}, delete_counterparty (баримтгүй үед л), delete_inventory_item (хөдөлгөөн/АР-АП мөр/PO мөр/өртгийн бичилтгүй үед л), delete_cost_entry (ноорог — хожмын бичилт байвал татгалзана), activate_fixed_asset, record_inventory_count | засах зөвхөн ноорог; устгах — ноорог аль ч горимд, батлагдсан зөвхөн post горим + ≤10M |
| Батлах/буцаах | post_{journal_voucher,cash_document,arap_document,fa_depreciation,cost_entries}, confirm_inventory_movement, reverse_{journal_voucher,cash_document,fa_depreciation,cost_entry}, settle_arap_offset (АР↔АП суутган тооцоо — MNT, нэг харилцагч), close_period, reopen_period | ЗӨВХӨН post горим + ≤10M (assertPostMode/assertPostLimit) |
| Мастер дата | create_{gl_account,counterparty,inventory_item,warehouse,cash_account}, update_{counterparty,inventory_item} | аль ч горимд |
| ECL / найдваргүй авлага | get_ecl_provision (унших), run_ecl_provision (сарын ECL журнал НООРОГ), write_off_arap_document (reason заавал), recover_arap_write_off (§5e) | get/run аль ч горимд; хасалт, сэргэлт ЗӨВХӨН post горим + батлах хязгаар |
| Нээлтийн бараа | create_opening_stock (бараа × агуулах × тоо × нэгж өртөг, ≤1000 мөр, externalRef-ээр идемпотент — §5 ENT-003) | ноорог өртгийн бичилт; post горимд батлах хязгаар дотор бол батлагдаж НЭГ журнал |
| Тохиргоо | get_company_settings, update_company_settings (`aiPostLimitMnt` — §9-ийн батлах хязгаар: бууруулах чөлөөтэй, өсгөлт 1 тэрбум ₮ хүртэл, дээш нь зөвхөн вэбээс хүн (`[HUMAN_REQUIRED]`); `largeAmountAlertMnt` — D2 босго) | аль ч горимд (эрх: admin+) |
| Багц, төлбөр | get_billing_overview (багц, статус, бичих эрх + шалтгаан, суудал, боломж, trial/grace хугацаа — `/settings/billing`-тэй НЭГ loader `getBillingOverview`; ЗӨВХӨН унших, засах нь Console-д) | аль ч горимд (гишүүн бүр) |
| Сар хаалтын тооцоо | run_fa_depreciation, run_monthly_costing | ноорог үүсгэдэг тул аль ч горимд |
| Унших | list_* (10 — list_cost_entries: өртгийн бичилтийн ID-г эндээс), get_journal_voucher, get_trial_balance, get_stock_balances, get_counterparty_balance (aging-тэй) | — |
| Тайлан | get_income_statement, get_balance_sheet, get_cash_flow, get_ebalance_statements (Сангийн яамны e-Balance маягт СТ-1…СТ-4 — `lib/reports/ebalance.ts`), get_account_ledger — вэбийн тайлантай НЭГ цэвэр функц (lib/reports/) ашиглана; create_year_end_closing (жилийн хаалтын 3 ноорог, нэг жилд нэг л удаа) | тайлан унших аль ч горимд; хаалт ноорог үүсгэнэ |
| Batch | create_{counterparties,arap_invoices,cash_transactions,journal_vouchers}_batch, master data: create_{gl_accounts,inventory_items,employees,fixed_assets}_batch (max 100, partial success — Cowork анхны импорт), post_{arap_documents,cash_documents,journal_vouchers}_batch | create нь аль ч горимд, post нь post горимд |
| Тулгалт+урсгал | reconcile_modules (касс/АРАП/бараа/клиринг vs GL, шалтгаан+засвар зөвлөнө), get_workflow_guide (7 урсгалын зөв дараалал), import_bank_statement (мөрд `settleInvoice` — нэхэмжлэхийн төлбөр; `ewalletSettlement: true` — QPay settlement: түр данс → банк шилжүүлэг + шимтгэл, §5c) | импорт post горимд |
| Нэвтрүүлэлт | get_onboarding_guide (section: overview/checklist/rules/phases/status) — `docs/deployment/onboarding.md`-ийн §2/§3/§4-ийг үгчлэн + байгууллагын шат (0–5) ба дараагийн алхам (`lib/onboarding/`); MCP `instructions` анх холбогдоход үүнийг заана | унших, аль ч горимд |
| НӨАТ | get_vat_return (сарын тайлан), create_vat_settlement (тооцооны ноорог, сард 1) | тайлан аль ч горимд; тооцоо ноорог үүсгэнэ |
| Сар хаалт | get_month_end_checklist (10 алхмын статус, ECL нөөц орно — вэб: Системийн хяналт → Сар хаалт `/close`) | аль ч горимд |
| Цалин | create_employee, run_payroll (бодолт+нэгтгэл), get_payroll_summary, create_payroll_voucher (GL ноорог, сард 1) | бүгд ноорог үүсгэдэг тул аль ч горимд |
| Хангамж | create/update/list/get_purchase_order, create_goods_receipt, create_ap_invoice_from_po, create_cost_allocation, get_landed_cost_summary — мөн `create_arap_invoice`-ийн `purchaseOrder` / мөрийн `purchaseOrderLineId`, `unitPrice`, `costComponentCode` өргөтгөл | үүсгэх/унших аль ч горимд; approve/close/cancel_purchase_order, confirm/reverse_goods_receipt, reverse_cost_allocation нь ЗӨВХӨН post горим + ≤10M |
| Мэдэгдэл | list_notifications (inbox — уншаагүй/бүгд), mark_notifications_read (ids угтвар эсвэл all) — §9d; system prompt-ийн dynamic context-д уншаагүй тоо + хамгийн ойрын татварын хугацаа | аль ч горимд (журнал үүсгэхгүй) |
| Ханш | sync_exchange_rates (муж + валютаар Монголбанкны ТҮҮХ татаж `exchange_rates`-д хадгална), get_exchange_rate (тухайн огнооны албан ханш — хадгалсан → татна → ШИДНЭ) | аль ч горимд (нийтийн лавлах, журнал үүсгэхгүй) |
| POS | get_pos_status (+ э-хэтэвчийн түр дансны тулгагдаагүй дүн), update_pos_settings (үйл ажиллагааны тохиргоо — `allowNegativeStock` унтраах, хөнгөлөлтийн хязгаар, бөөрөнхийлөл, дансны рольууд, `ewalletFeeAccount`; eBarimt/QPay энд БАЙХГҮЙ), open_pos_shift, list_pos_sales, get_pos_sale, get_pos_sales_report (бараа/өдөр/кассчин/хэлбэр/харилцагч/дүрмээр, ахиуц), save_pos_payment_method / delete_pos_payment_method (төлбөрийн хэлбэрийн ЛАВЛАХ — eBarimt код оноох, буруу/давхардсан мөр цэвэрлэх; ашиглагдсан хэлбэр устахгүй, идэвхгүй болно) | аль ч горимд; create_pos_sale (нэг транзакц — АР+касс+зарлага+урьдчилсан COGS; `consumerNo`/`customerTin`/`customerRegNo`-оор eBarimt худалдан авагч), return_pos_sale, close_pos_shift нь ЗӨВХӨН post горим + ≤10M (ноорог байхгүй — бодит мөнгөн үйлдэл) |
| eBarimt | get_ebarimt_status (асаалттай эсэх, тохиргооны дутуу, хүлээгдэж байгаа/алдаатай тоо), resend_ebarimt (зассаны дараа дахин илгээх / ДДТД цуцлах), lookup_tin (РД → ТТД, B2B баримтад) | аль ч горимд (журнал үүсгэхгүй; илгээлт нь async) |
| QPay | get_qpay_status (асаалттай/тохируулсан эсэх, бэлэн байдлын дутуу, мерчант id, нээлттэй QR, төлөгдсөн ч борлуулалт болоогүй — нууц буцахгүй); холбох нь ЗӨВХӨН вэбээс [QPay холбох] | аль ч горимд (унших) |
| Мэдлэгийн сан | list_knowledge_topics (сэдвийн индекс — гарчиг + хэсгийн нэрс, ангиллаар), read_knowledge_section (НЭГ хэсэг, ≤3000 тэмдэгт, ишлэлтэй) — §9e; `surfaces: ["mcp"]` тул REST-д ГАРАХГҮЙ; `requireFeature("knowledge")` (Console-оос байгууллага бүрд), 24ц/200 квот `[KNOWLEDGE_LIMIT]` | аль ч горимд (унших; журнал үүсгэхгүй) |

ID-тэй tools бүгд бүтэн эсвэл 6+ тэмдэгтийн угтвар ID хүлээнэ;
нэхэмжлэх documentNo болон externalRef-ээр ч олдоно. Lookup нь сүүлийн
500–1000 баримтын цонхонд хайдаг — хуучин баримтыг бүтэн ID-гаар өгнө.

**Idempotency (externalRef):** create_{journal_voucher,arap_invoice,
cash_transaction} нь externalRef (eBarimt ДДТД, банкны гүйлгээний ID) авдаг —
ижил ref-тэй хоёр дахь дуудлага ШИНЭ баримт үүсгэхгүй, байгааг нь буцаана
(`dedup`, batch-д "алгассан"). DB талд (user_id, external_ref) partial unique
index гурван хүснэгтэд бий. Давхардлыг create_counterparty нэр
(case-insensitive) + ТТД-гээр мөн шалгаж [CONFLICT] буцаана.

**Алдааны кодууд:** tool-ийн алдаа `[CODE] текст` форматтай —
COUNTERPARTY_NOT_FOUND (ойролцоо нэрс санал болгоно), COUNTERPARTY_AMBIGUOUS,
ACCOUNT_NOT_FOUND, CONFLICT, AMOUNT_LIMIT_EXCEEDED, DIRECT_MODE_REQUIRED г.м.

```
lib/ai/
├── write-mode.ts      AiWriteMode (draft | post) — ЦЭВЭР; write-mode-store.ts DB
├── tools.ts           Tool JSON schema + executor-ууд — одоо байгаа server
│                      action-уудыг дуудна (шалгалт нэг газар)
├── action-markers.ts  AiAction төрөл (tool үр дүнгийн объект — AI бүртгэлд)
├── post-limit.ts      §9 батлах хязгаар (AsyncLocalStorage)
├── rate-limit.ts      MCP/REST-ийн tool дуудлагын хязгаар
└── crypto.ts          Нууц AES-256-GCM шифр (QPay түлхүүр г.м. — нэр түүхэн)

lib/actions/ai-write-mode.ts   saveAiWriteMode — /ai хуудасны горимын switch
components/ai/ai-connect-view.tsx  «AI холболт»: заавар · горим · token
```

Хатуу дүрмүүд:

- Tool executor алдаа ШИДЭХГҮЙ — модельд монгол текстээр буцаана
- Данс normalize нь paste/Excel-тэй ИЖИЛ (`normalizePastedAccount`)
- Харилцагч/бараа/данс НЭРЭЭР олдохгүй эсвэл олон таарвал алдаа + жагсаалт
  буцаана — модель таамаглахгүй, лавлах tool эсвэл хэрэглэгчээс асуана
- Үүссэн объект `[[EA_ACTION:{json}]]` маркераар контентод хадгалагдана —
  түүхээс дахин ачаалахад ч картууд харагдана
- Модель/горимын сонголт `ai_settings`-д хадгалагдана; provider нь
  сонгосон моделиос тодорхойлогдоно; OpenAI-д PDF хавсралт дэмжигдэхгүй

### 9b. MCP server — гадны Claude клиентэд нээх

Цөм: `lib/mcp/server.ts` (streamable HTTP, stateless JSON-RPC POST) —
хоёр route хуваалцана:

```
/api/mcp           Bearer header (Claude Code CLI):
                   claude mcp add --transport http --scope user \
                     entry-accounting https://<domain>/api/mcp \
                     --header "Authorization: Bearer <token>"
/api/mcp/<token>   Token нь URL-д (fallback зам)
```

**OAuth 2.1 (custom connector-ийн үндсэн зам):** claude.ai / Cowork-ийн
"Connect" товч стандарт урсгалаар холбогдоно — цөм нь `lib/oauth/server.ts`:

```
/.well-known/oauth-authorization-server   RFC 8414 metadata (path-aware)
/.well-known/oauth-protected-resource     RFC 9728 (401-ийн WWW-Authenticate заадаг)
/api/oauth/register                       RFC 7591 DCR (public client, нууцгүй)
/oauth/authorize                          Consent хуудас (standalone, login redirect
                                          callbackUrl-тэй), PKCE S256 ЗААВАЛ
/api/oauth/token                          code + refresh grant (rotation)
```

- Бүх нууц (code/access/refresh) sha256 hash-аар `oauth_*` хүснэгтүүдэд;
  code нэг удаагийн, access 7 хоног, refresh rotation-тэй
- MCP-ийн `resolveApiToken` `eak_` (PAT) болон `eoat_` (OAuth) хоёуланг танина
- proxy matcher `.well-known`-ийг алгасдаг; login redirect callbackUrl дамжуулдаг

- **Нэвтрэлт:** Personal Access Token (`eak_...`, Тохиргоо → AI холболт `/settings/ai` → Token). DB-д зөвхөн sha256 hash (`api_tokens`); үүсгэхэд НЭГ л
  удаа бүтнээрээ харагдана; хэрэглэгч бүр дээд тал нь 5 token
- **Tools = REST-тэй ИЖИЛ давхарга** (`lib/ai/tools.ts`) — тусдаа
  логик ХОРИОТОЙ; шинэ tool нэмбэл хоёр замд зэрэг очно
- **Impersonation:** `runAsUser(userId, fn)` (lib/auth.ts, AsyncLocalStorage)
  — server action доторх `auth()` token-ий эзний session мэт хариулна.
  Cookie-той ердийн замд огт нөлөөгүй
- Бичилтийн горим `/settings/ai` хуудасны switch — REST-тэй НЭГ тохиргоо (`ai_settings.write_mode`)
- proxy.ts-ийн matcher `/api`-г алгасдаг тул энэ зам login redirect-д орохгүй
