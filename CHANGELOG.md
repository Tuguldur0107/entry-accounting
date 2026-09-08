# Changelog

Формат: [Keep a Changelog](https://keepachangelog.com/), хувилбар: [SemVer](https://semver.org/).
Tag = `v` + package.json version. Fork-ууд tag-аар шинэчилнэ (docs/deployment/README.md).

## [Unreleased]

### Нэмэгдсэн
- `provision-customer.yml` — харилцагчийн repo-г нэг workflow-оор үүсгэх
  (repo, core түүх push, Actions permission, secret/variable, урилга);
  Entry Console (`entry-console` repo) энийг dispatch хийнэ

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
