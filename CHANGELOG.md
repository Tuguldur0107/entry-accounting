# Changelog

Формат: [Keep a Changelog](https://keepachangelog.com/), хувилбар: [SemVer](https://semver.org/).
Tag = `v` + package.json version. Fork-ууд tag-аар шинэчилнэ (docs/deployment/README.md).

## [Unreleased]

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
- `provision-customer.yml` нийтлэг `UPSTREAM_TOKEN` тавихаа больсон
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
