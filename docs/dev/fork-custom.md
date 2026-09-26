# Fork нэвтрүүлэлт, custom/ өргөтгөл, REST API

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (§9c). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

### 9c. Fork нэвтрүүлэлт, custom/ өргөтгөл, REST API

Баримт: `docs/deployment/README.md` (playbook), `docs/deployment/api-integration.md`,
`custom/README.md`, `custom/CLAUDE.md`.

- **Харилцагч = GitHub fork.** Core шинэчлэлт `upstream-sync.yml` PR-аар
  (`vX.Y.Z` tag → `release.yml` GitHub Release). Хувилбарын эх сурвалж
  `package.json` → `lib/version.ts`; `/api/health` → `{version, sha}`;
  `/settings/system` хуудас; MCP `serverInfo.version`; REST `X-Entry-Version`
- **custom/ гэрээ:** харилцагч ЗӨВХӨН `custom/`-д бичнэ, core `custom/`-д
  ХЭЗЭЭ Ч бичихгүй. Entrypoint `custom/index.ts` → `mergeCustomizations(...)`;
  interface `lib/custom/types.ts`; loader `lib/custom/loader.ts` (шалгалт
  `lib/custom/validate.ts`, тесттэй). Core нь custom/-ийн тодорхой багцын
  нэр/зам hardcode хийхгүй
- **Tool нийлбэр:** `AI_TOOLS` = core; `allAiTools()` = core + custom — MCP,
  REST хоёулаа `allAiTools()` (замаар шүүх бол `aiToolsForSurface`) ашиглана. `executeAiTool`
  default → custom tool. Шинэ consumer нэмбэл `allAiTools()`
- **Мэдэгдлийн суваг** (фаз 2): `EntryCustomization.notificationChannels[]` —
  `NotificationChannel { key, label, deliver(ctx) }` (§9d); core Telegram-тай
  нэг sweep-ээр хүргэгдэнэ, тохиргооны матрицад автоматаар багана болно
- **Hook цэгүүд** (guardrail-ийн ДАРАА, транзакц дотор): `postVoucherCore` /
  `createVoucherCore(posted)` → `beforeJournalPost` (шидвэл rollback),
  commit + subledger sync дараа `afterJournalPost` (алдаа залгина);
  `closePeriod` → `beforePeriodClose` (`hook-rejected` код + reason). Hook
  байгаа хоригийг сулруулж ЧАДАХГҮЙ
- **Fork-ийн predeploy DDL:** `custom/predeploy.mjs` — `db:predeploy` нь
  `apply-pending-ddl`-ийн ДАРАА, `drizzle-kit push`-ийн ӨМНӨ
  `scripts/run-custom-predeploy.mjs`-ээр ажиллуулна (байхгүй бол алгасна,
  алдаа → deploy зогсоно). Fork `package.json`-д ГАР ХҮРЭХГҮЙ — 2026-09-25
  smartgps-ийн sync conflict-д `db:predeploy` мөр устаж build унасан.
  `tests/fork-sync-contract.test.ts` дараалал + conflict тэмдэг үлдэгдлийг барина
- **Theme:** `app/globals.css` нь `ui-kit/tokens.css`-ийн ДАРАА
  `custom/theme.css` import хийнэ
- **REST API v1:** `lib/api/v1.ts` — `GET /api/v1/tools`, `POST
  /api/v1/tools/<name>`; MCP-тэй ижил `resolveApiToken` + `writeModeOf` +
  `runAsOrg` + rate limit; `[CODE]` алдаа → 422 `{ok:false, code, error}`.
  Тусдаа логик ХОРИОТОЙ — tool давхаргаар л
- **Deployment-ийн лиценз:** production нэвтрэлт `ENTRY_LICENSE` (Console-оос
  олгосон гарын үсэгтэй, appUrl-даа уягдсан token) шаардана — offline шалгалт
  `lib/licensing/license.ts`, олгогч `scripts/issue-license.mjs` (нууц түлхүүр
  repo-д байхгүй); `next dev`-д шалгалтгүй. Дэлгэрэнгүй docs/deployment/README.md
- **Харилцагчийн repo үүсгэх:** `.github/workflows/provision-customer.yml`
  (workflow_dispatch; Entry Console — тусдаа `entry-console` repo — үүнийг
  dispatch хийнэ). Харилцагч = topic `entry-customer`-тэй `entry-<slug>` repo;
  тохиргоо repo variables (`ENTRY_DISPLAY_NAME`, `ENTRY_APP_URL`). Template
  repo ХОРИОТОЙ (түүхгүй → sync merge хийгдэхгүй)
- **Cowork master data импорт:** `.claude/skills/master-data-import/SKILL.md`
  (repo-д tracked — `.gitignore` `.claude/*` + `!.claude/skills/`), загвар
  `docs/deployment/master-data/*.csv`. Дараалал: данс → харилцагч → бараа/
  агуулах → касс → ажилтан → ҮХ → АР/АП нээлт → бараа нээлт → нээлтийн журнал
  (НЭГ ноорог, `externalRef: opening-balance:<огноо>`) → тулгалт
