# Changelog

Формат: [Keep a Changelog](https://keepachangelog.com/), хувилбар: [SemVer](https://semver.org/).
Tag = `v` + package.json version. Fork-ууд tag-аар шинэчилнэ (docs/deployment/README.md).

## [Unreleased]

### Засагдсан
- **Нэвтрэх / бүртгүүлэх нь proxy-ийн ард унадаг байсан.** NextAuth v5 нь
  Vercel-ээс бусад орчинд host-оо анхнаасаа итгэдэггүй тул
  `/api/auth/callback/credentials` нь `UntrustedHost` алдаа өгч, хэрэглэгчид
  «There was a problem with the server configuration» гэж харагддаг байв.
  `lib/auth.config.ts`-д `trustHost: true` — Railway, Nginx, харилцагчийн
  өөрийн сервер аль ч дээр орчны хувьсагчгүйгээр ажиллана

### Өөрчлөгдсөн
- **`/register` нь эхний хэрэглэгчийн дараа хаагдана.** Харилцагчийн апп
  нээлттэй интернэтэд байдаг тул хэн ч бүртгүүлж чаддаг байсан (дата нь
  `organizationId`-аар тусгаарлагдсан тул харагддаггүй ч, хог бүртгэл үүсэх
  ба ажилтнууд өөрсдөө бүртгүүлээд ХООСОН компанид ордог байв). Одоо
  `users` хүснэгт хоосон үед л нээлттэй; дараа нь зөвхөн
  `/register?invite=<token>` (Удирдлага → Байгууллага → Гишүүн урих).
  Хориг нь `registerUser` server action дотор тул формыг тойрч дуудсан ч
  хүчинтэй. Зориуд нээлттэй байлгах бол `ENTRY_OPEN_REGISTRATION=1`

## [1.1.0] — 2026-09-12 — Лиценз, харилцагч тус бүрийн шинэчлэлтийн эрх

### Нэмэгдсэн
- **Лиценз: FSL-1.1-Apache-2.0** (`LICENSE`, `NOTICE`). Өөрийн бизнест ашиглах,
  кодыг өөрчлөх, өөрийн серверт байршуулах чөлөөтэй; гуравдагч этгээдэд
  бүтээгдэхүүн болгон санал болгох хориотой; хувилбар бүр 2 жилийн дараа
  Apache 2.0 болно. Монгол тайлбар: `docs/licensing/README.md`
- `provision-customer.yml` — харилцагчийн repo-г нэг workflow-оор үүсгэх
  (repo, core түүх push, Actions permission, variable, урилга);
  Entry Console (`entry-console` repo) энийг dispatch хийнэ

### Өөрчлөгдсөн
- `upstream-sync.yml` нь `UPSTREAM_SSH_KEY`-ээр core-оос татна — харилцагч
  бүрд ТУСДАА олгогдсон deploy key. Нэгийг цуцлахад бусад нь хөндөгдөхгүй;
  цуцлагдсан ч байгаа код, deploy хэвээр (зөвхөн шинэ хувилбар ирэхээ болино).
  Хуучин нийтлэг `UPSTREAM_TOKEN` fallback хэвээр
- `upstream-sync.yml` merge-ийг ТУРШИЖ (`--no-ff`) tsc/lint/тест ажиллуулаад
  үр дүнг PR label болгоно (`sync-checks-passed` / `-failed` / `sync-conflict`)
  — console-ийн авто merge үүнийг уншина
- **`upstream-sync.yml` sync салбарыг SSH түлхүүрээр (`SYNC_PUSH_KEY`) push
  хийнэ.** GITHUB_TOKEN нь `.github/workflows/` доторх файлыг push хийж чаддаггүй
  («refusing to allow a GitHub App to create or update workflow … without
  `workflows` permission») тул workflow хөндсөн шинэчлэлт бүр унадаг байсан.
  Deploy key нь GitHub App биш тул энэ хязгаарлалтад ороогүй
- **`upstream-sync.yml` PR нээхээ больж, Entry Console нээдэг болов.**
  GITHUB_TOKEN нь `pull-requests: write` эрхтэй байсан ч org-ийн repo дээр
  `createPullRequest`-ийг GitHub татгалздаг («Resource not accessible by
  integration») — амьд туршилтаар батлагдсан. Workflow нь салбар push хийж,
  merge/шалгалтыг ХОЁР тусдаа нэртэй алхмаар гүйцэтгэнэ; console алхмуудын
  үр дүнг API-аар уншиж conflict / failed / passed-ийг ялган PR-ыг зөв
  label-тай нээнэ. Workflow-ийн эрх зөвхөн `contents: write` болж багасав
- `provision-customer.yml` нийтлэг `UPSTREAM_TOKEN` тавихаа больсон
- `release.yml` нь `workflow_dispatch`-ээр ч ажиллана — **Actions → Release →
  Run workflow** дарахад tag + GitHub Release үүснэ (локал git хэрэггүй);
  tag нь `package.json` version-той таарахгүй бол ажил унана
- `docs/deployment/README.md` — нээлттэй `/signup` хүсэлт → батлах алхам,
  Railway автоматжилт §1b (backup, domain, хяналт, авто sync, устгах)

## [1.0.0] — 2026-09-07 — Анхны харилцагчийн туршилтын нэвтрүүлэлт

### Нэмэгдсэн
- `custom/` өргөтгөлийн давхарга — fork хийсэн хэрэглэгч core-д гар хүрэлгүй
  tool, hook (beforeJournalPost / afterJournalPost / beforePeriodClose), theme
  нэмнэ; чат БА MCP хоёуланд автоматаар харагдана. Жишээ: `custom/packages/demo`
- REST API v1 — `GET /api/v1/tools`, `POST /api/v1/tools/<name>` (MCP-тэй ижил
  Bearer token, ижил tool давхарга) — гадаад системийн интеграцид
- Master data batch tools: `create_gl_accounts_batch`, `create_inventory_items_batch`,
  `create_employees_batch`, `create_fixed_assets_batch` — Cowork/MCP-ээр анхны
  мэдээлэл оруулахад
- Хувилбарын систем: `lib/version.ts`, `/api/health` → `{version, sha}`,
  `/settings/system` хуудас, MCP serverInfo.version
- GitHub Actions: `release.yml` (tag → Release), `upstream-sync.yml` (fork → PR)
- Баримт: `docs/deployment/` (fork нэвтрүүлэлтийн playbook, API integration,
  master data импорт), `.claude/skills/master-data-import`, `.env.example`

### Өөрчлөгдсөн
- `closePeriod` үр дүнд `hook-rejected` код нэмэгдэв
