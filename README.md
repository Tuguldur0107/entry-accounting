# Entry Accounting

Монгол стандартад нийцсэн, AI-first нягтлан бодох бүртгэлийн систем —
ерөнхий журнал, касс/банк, АР/АП, бараа материал (хугацааны жигнэсэн дундаж
өртөг), үндсэн хөрөнгө, НӨАТ, цалин, сар хаалт, аудитын мөр, AI туслах
(90+ tool, MCP + REST API).

## Fork-д суурилсан нэвтрүүлэлт

Харилцагч бүр **өөрийн GitHub fork** дээр ажиллана:

- Core шинэчлэлт → `Upstream sync` workflow PR-аар (`vX.Y.Z` tag)
- Өргөтгөл → зөвхөн [`custom/`](custom/README.md) (tool, hook, theme) — conflict-гүй
- Интеграци → [MCP + REST API v1](docs/deployment/api-integration.md), ижил token
- Анхны мэдээлэл → Claude Cowork + [`master-data-import` skill](.claude/skills/master-data-import/SKILL.md)

Бүрэн заавар: **[docs/deployment/README.md](docs/deployment/README.md)**

## Quickstart (локал)

```bash
git clone <fork-url> && cd entry-accounting
npm ci
cp .env.example .env.local      # DATABASE_URL, AUTH_SECRET, NEXT_PUBLIC_APP_URL
npm run db:push                 # Drizzle schema → PostgreSQL
npm run dev                     # http://localhost:3000 → бүртгүүлэх
```

Production: Railway (`railway.toml` — `db:push` preDeploy, `/api/health`).

## Шалгалт

```bash
npx tsc --noEmit && npx eslint . && npm test
```

## Хувилбар

`package.json` version = git tag (`v1.0.0`). Deploy дээр: `/api/health`,
`/settings/system`. Өөрчлөлтүүд: [CHANGELOG.md](CHANGELOG.md).

## Баримт бичиг

| | |
|--|--|
| Хөгжүүлэгчийн дүрэм (Claude Code уншина) | [CLAUDE.md](CLAUDE.md) |
| Нэвтрүүлэлт, fork, хувилбар | [docs/deployment/](docs/deployment/README.md) |
| Өргөтгөл | [custom/README.md](custom/README.md), [custom/CLAUDE.md](custom/CLAUDE.md) |
| Өртгийн бүртгэл | [docs/cost/](docs/cost/README.md) |
| Open source стратеги | [docs/OPEN-SOURCE-STRATEGY.md](docs/OPEN-SOURCE-STRATEGY.md) |
| Мэргэжлийн мэдлэгийн сан | `knowledge/` |
| Лиценз — юу зөвшөөрөгдөх вэ | [docs/licensing/](docs/licensing/README.md) |

## Лиценз

[FSL-1.1-Apache-2.0](LICENSE) — өөрийн бизнест ашиглах, өөрчлөх, өөрийн серверт
байршуулах бүрэн чөлөөтэй. Зөвхөн үүнийг гуравдагч этгээдэд бүтээгдэхүүн болгон
санал болгох нь хориотой. Хувилбар бүр хоёр жилийн дараа Apache 2.0 болж бүрэн
нээгдэнэ. Энгийн тайлбар: [docs/licensing/README.md](docs/licensing/README.md).
