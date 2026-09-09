# Харилцагчид нэвтрүүлэх — Fork-д суурилсан playbook

*v1.0 · 2026-09-07 · Анхны туршилтын харилцагчаас эхлэн мөрдөнө*

Entry-г харилцагч бүр **өөрийн GitHub fork** дээр ажиллуулна. Core (энэ repo)
шинэчлэгдэхэд fork PR-аар татаж авна; харилцагч өөрөө (эсвэл Claude Code-той
"vibe coder" маягаар) `custom/` дотор өргөтгөнө; гадаад системүүд MCP эсвэл
REST API-аар холбогдоно; анхны мэдээллийг Claude Cowork-оор оруулна.

```
Tuguldur0107/entry-accounting (core)         <харилцагч>/entry-accounting (fork)
   main ──tag v1.0.0──▶ Release                 main ◀── PR "Upstream sync: v1.0.0"
   main ──tag v1.1.0──▶ Release                 main ◀── PR "Upstream sync: v1.1.0"
            │                                     │  custom/  ← харилцагчийн код
            │  core код                            │  .env    ← харилцагчийн нууц
            ▼                                     ▼
       (custom/ хоосон)                     Railway/Vercel deploy → /api/health {version}
```

## 1. Шинэ харилцагч нэвтрүүлэх checklist

| # | Алхам | Хэн | Хэрэгсэл |
|---|-------|-----|----------|
| 1 | Харилцагчийн **тусдаа private repo** үүсгэх — Entry Console → «Харилцагч нэмэх» (§1a) | Бид | `provision-customer.yml` автоматаар |
| 2 | Repo-ийн Actions permission + `UPSTREAM_TOKEN` secret + хэрэглэгчийн урилга — мөн автоматаар (1-р алхамд) | — | — |
| 3 | Railway deploy — Entry Console автоматаар (§1b): `entry-<slug>` app + `entry-<slug>-db` Postgres, хувьсагчид, domain. Гараар бол: Postgres + repo холбох, `.env.example`-ийн DATABASE_URL, AUTH_SECRET, NEXT_PUBLIC_APP_URL | Бид | Console / Railway (`railway.toml` бэлэн: db:push + healthcheck) |
| 4 | `/api/health` → `{ok:true, version:"1.0.0", sha:"…"}` шалгах | Бид | curl |
| 5 | Эхний хэрэглэгч бүртгэх → байгууллага үүснэ → Тохиргоо → ЕЖ тохиргоо → стандарт данс sync | Харилцагч | Вэб |
| 6 | Тохиргоо → AI туслах → MCP холболт → token үүсгэх (эсвэл Cowork-д OAuth-оор Connect) | Харилцагч | Вэб |
| 7 | Master data импорт — Cowork + `master-data-import` skill | Харилцагч + Cowork | [master-data/README.md](master-data/README.md) |
| 8 | Нээлтийн баланс тулгалт (`get_trial_balance`, `reconcile_modules`) | Нягтланч | Cowork/вэб |
| 9 | Хэрэгтэй интеграци (POS, банк, CRM) — [api-integration.md](api-integration.md) | Харилцагч / бид | REST / MCP / custom hook |
| 10 | Өргөтгөл хэрэгтэй бол `custom/` — [../../custom/README.md](../../custom/README.md) | Харилцагч + Claude Code | fork дээр |

### 1a. Харилцагчийн repo хэрхэн үүсэх вэ

Core repo **private** тул GitHub-ийн "Fork" товч харилцагчийн акаунтад
ажиллахгүй (core-д унших эрх хэрэгтэй). "Fork" гэдэг нь энд **тусдаа repo +
`upstream` remote** гэсэн бүтэц. Template repo ашиглаж БОЛОХГҮЙ — түүхгүй
(нэг commit) үүсдэг тул upstream-sync merge хийгдэхгүй.

**Автомат зам (зөвлөж байна):** Entry Console (`entry-console` repo, Railway)
→ «Харилцагч нэмэх» → core repo-ийн `.github/workflows/provision-customer.yml`
ажиллаж: `entry-<slug>` private repo (topic `entry-customer`), core-ийн main +
tag push (бүтэн түүх), Actions permission, `UPSTREAM_TOKEN` secret,
`ENTRY_DISPLAY_NAME` / `ENTRY_APP_URL` variable, хэрэглэгчдийг Write эрхтэй
урих — бүгд нэг дор. Core repo-д нэг удаа `PROVISION_TOKEN`,
`UPSTREAM_READ_TOKEN` secret тавина (workflow-ийн толгойн тайлбар).

### 1b. Railway deploy хэрхэн автоматжих вэ

Console-д `RAILWAY_TOKEN` (account token) + `RAILWAY_PROJECT_ID` тавьсан бол
харилцагч нэмэхэд «Repo бэлэн болмогц Railway-д автоматаар deploy» чагт
(эсвэл харилцагчийн хуудасны «Railway-д deploy» товч) дараахыг хийнэ:

1. `entry-<slug>-db` — `postgres:16-alpine` image + volume, `DATABASE_URL`
   өөр дээрээ variable
2. `entry-<slug>` — хоосон service → `*.up.railway.app` domain →
   `DATABASE_URL=${{entry-<slug>-db.DATABASE_URL}}`, `AUTH_SECRET` (санамсаргүй),
   `NEXT_PUBLIC_APP_URL`, `NODE_ENV` → healthcheck `/api/health`, preDeploy
   `npm run db:push` → GitHub repo холбох (build эхэлнэ)
3. Domain нь console-д харилцагчийн Deploy хаяг болж хувилбарын хяналт ажиллана

Нэрээр байгаа service-ийг дахин ашигладаг тул унасан оролдлогыг аюулгүй
давтана. **Шаардлага:** Railway-ийн GitHub app `Entry-mn` org-д суусан байх
(github.com/apps/railway-app/installations/new); project token GitHub repo
холбож чадахгүй тул account token хэрэгтэй — зөвхөн project token байвал
service/DB/domain үүсээд repo-г Railway дээр гараар холбоно (console
«repo холбогдоогүй» гэж анхааруулна).

Гараар (console-гүй):

```bash
git clone --bare https://github.com/Tuguldur0107/entry-accounting.git
cd entry-accounting.git
git push https://github.com/<org>/entry-<харилцагч>.git main --tags   # шинэ хоосон private repo
```

Хаана байрлах вэ — хоёр сонголт:

| | Бидний org-д (`entry-<харилцагч>`) | Харилцагчийн org-д |
|--|--|--|
| Эзэмшил | Бид; харилцагч collaborator | Харилцагч; бид collaborator |
| Туршилтын үед | **Зөвлөж байна** — дэмжлэг, эрх, нууц удирдахад хялбар | Харилцагч DevOps-той бол |
| Дараа нь | GitHub *Transfer ownership*-оор харилцагч руу шилжүүлнэ — upstream-sync URL-д суурилдаг тул ажилласаар байна | — |

Хоёр тохиолдолд `upstream-sync.yml` ижил ажиллана: `UPSTREAM_TOKEN` secret
(core-г унших fine-grained PAT) байвал private core-оос татна; core public
болбол secret хэрэггүй.

## 2. Хувилбар (versioning)

- **SemVer**, эх сурвалж `package.json` → `lib/version.ts`. Tag = `vX.Y.Z`.
- Core дээр release гаргах:

  ```bash
  npm version minor --no-git-tag-version   # 1.0.0 → 1.1.0
  # CHANGELOG.md-д [1.1.0] хэсэг бич
  git commit -am "Release v1.1.0" && git tag v1.1.0 && git push origin main --tags
  ```

  `release.yml` tsc/eslint/тест ажиллуулаад GitHub Release үүсгэнэ (tag ≠
  package.json бол унана).
- Deploy дээр хувилбар харах: `/api/health`, `/settings/system`, MCP
  `initialize` → `serverInfo.version`, REST хариуны `X-Entry-Version` header.
- **MAJOR** = DB schema-д буцаагдахгүй өөрчлөлт эсвэл `custom/` interface
  (`lib/custom/types.ts`) эвдэрсэн. **MINOR** = шинэ модуль/tool. **PATCH** = засвар.

## 3. Core шинэчлэлтийг fork-д авах

`upstream-sync.yml` (харилцагчийн repo дээр л ажиллана) Даваа гараг бүр core `main`-ийг
шалгаж, шинэ commit байвал `upstream-sync/<ref>` салбар push хийгээд fork-ийн
`main` руу PR нээнэ. Тодорхой хувилбар авахдаа **Actions → Upstream sync →
Run workflow → ref: `v1.1.0`**.

Гараар:

```bash
git remote add upstream https://github.com/Tuguldur0107/entry-accounting.git
git fetch upstream --tags
git checkout -b upstream-sync/v1.1.0 && git merge v1.1.0
```

**Conflict гарахгүй байх гэрээ:** харилцагч ЗӨВХӨН `custom/`, `.env`, README-д
бичнэ; core `custom/` дотор хэзээ ч бичихгүй. Core файл өөрчилсөн бол тэр
өөрчлөлтийг (а) `custom/` руу нүүлгэ, эсвэл (б) core руу PR болгож явуул
(бүх харилцагчид хэрэгтэй сайжруулалт бол). Conflict гарсан PR-ыг Claude
Code-оор шийдүүлж болно: *"upstream-sync PR-ын conflict-ийг шийд, custom/
дахь миний дүрмүүдийг хадгал"*.

Merge хийсний дараа Railway автоматаар deploy хийж `preDeployCommand`
(`npm run db:push`) шинэ DDL-ийг хэрэглэнэ. **Deploy-ийн өмнө DB snapshot.**

## 4. Харилцагчийн өргөтгөл (vibe coding)

Fork дээр Claude Code нээгээд root `CLAUDE.md` + `custom/CLAUDE.md`-г уншина —
тэнд "core-д гар хүрэхгүй, custom/-д л бич" дүрэм бий. Боломжууд:

| Хэрэгцээ | Хаана | Жишээ |
|----------|-------|-------|
| Шинэ AI/MCP/REST tool (тайлан, шалгалт) | `custom/packages/<нэр>/index.ts` → `tools` | `get_journal_count_by_month` (demo) |
| Батлахын өмнөх нэмэлт дүрэм | `hooks.beforeJournalPost` | "Тайлбаргүй журнал батлагдахгүй" |
| Батлагдсаны дараа гадаад системд мэдэгдэх | `hooks.afterJournalPost` | Webhook → n8n/Slack/ERP |
| Сар хаахын өмнөх шалгалт | `hooks.beforePeriodClose` | "Банкны тулгалт дуусаагүй бол хаахгүй" |
| Брэндийн өнгө | `custom/theme.css` | `--ea-primary` override |
| Данс, харилцагч, бараа | Мэдээлэл — код биш | Cowork импорт / вэб |

Hook нь core guardrail-ийг (баланс, период, эрх, 10 сая ₮ хязгаар) сулруулж
чадахгүй — зөвхөн НЭМЭЛТ хориг. Custom tool чат, MCP, REST гурвуулаа
автоматаар харагдана (`allAiTools()`).

## 5. Интеграцийн замууд

| Зам | Хэзээ | Баримт |
|-----|-------|--------|
| **MCP** (`/api/mcp`) | Claude Code, Cowork, claude.ai, ChatGPT — хүн AI-тай ярьж ажиллуулна | Тохиргоо → AI туслах → MCP холболт |
| **REST API v1** (`/api/v1/tools/*`) | POS/ERP/банк/n8n скрипт машинаас дуудна — ижил token, ижил 90+ tool | [api-integration.md](api-integration.md) |
| **OAuth 2.1** | Custom connector-ийн "Connect" товч | `/.well-known/oauth-authorization-server` |
| **Outbound hook** | Entry-ээс гадагш (батлагдсан журнал → webhook) | `custom/packages/demo` `afterJournalPost` |
| **Excel** | Хүн гараар — журнал, АР/АП мөр | Вэб toolbar |

## 6. Аюулгүй байдал, нууц

- Token (`eak_`) нь хэрэглэгч бүрд 5 хүртэл, хугацаатай; DB-д sha256 л
  хадгалагдана. Интеграци бүрд ТУСДАА token (устгахад бусад нь салахгүй).
- Бүх бичилт ноорог-first; "Шууд бичих" горим + ≤10 сая ₮ л шууд батлагдана —
  интеграцийн скрипт ч ижил дүрэмтэй.
- Fork private байна; `.env*` git-д орохгүй (`.gitignore`); `custom/`-д нууц,
  URL хатуу бичихгүй — `process.env`.
- Rate limit: token бүрд 10 хүсэлт/минут (MCP + REST нийлээд).

## 7. Дараагийн шат (энэ PR-д ОРООГҮЙ)

- `npm run custom:seed` (custom/-ийн accounts.json-оор данс суулгах) —
  одоо Cowork импорт орлож байна
- `entry-package.json` манифест + `entryCompat` semver шалгалт (docs/opensource/02 Шат 3)
- Multi-instance rate limit (Redis) — нэг сервер дээр хэрэггүй
- FSL лиценз, CLA (docs/opensource/03) — fork private тул одоохондоо шаардлагагүй
