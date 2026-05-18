# Knowledge Base — Мэргэжлийн мэдлэгийн сан

Accounting_System_Chipmo (Entry) системээс авсан мэргэжлийн мэдлэгийн файлууд. 4 бүлгээр зохион байгуулагдсан.

---

## 01 — Онол, Хууль, Стандарт

**`01-онол-хууль-стандарт/`**

| Хавтас | Агуулга |
|--------|---------|
| `ifrs/` | 30 IAS/IFRS стандарт — тус бүр тусдаа файл (IAS 1–41, IFRS 3–16) |
| `tax/` | Монгол Улсын татварын хуулиуд: НӨАТ, ААНОАТ, ХАОАТ, WHT, eBarimt, торгууль, 2026 шинэчлэлт |
| `reference-data/` | Effective-dated JSON: tax-rates, pit-brackets, si-rates, minimum-wage, tax-calendar, ifrs-module-mapping |
| `ifrs-cross-module-mapping.md` | 27 IFRS стандарт ↔ модуль ↔ данс ↔ journal загвар |
| `tax-cross-module-mapping.md` | Монгол татварын бүх төрөл ↔ tax_settings ↔ GL данс ↔ filing хуваарь |

---

## 02 — Нягтлан Бодох Бүртгэлийн Мэргэжлийн

**`02-нягтлан-бодох-мэргэжлийн/`**

| Хавтас / Файл | Агуулга |
|---------------|---------|
| `expert-accountant-SKILL.md` | Мэргэшсэн нягтлан бодогчын ерөнхий skill manifest |
| `payroll/` | Цалин тооцоолол: Gross→Net, НДШ/ЭМД, ХАОАТ, илүү цаг, GL журнал, worked example |
| `workflows/` | Ажлын урсгал: journal-entry, vat-return, payroll-run, period-close, module-mapping |
| `guardrails/` | Хориглол / дүрэм: journal-balance, effective-date, si-cap, human-in-the-loop, domain-separation |
| `01-gl-posting-matrix.md` | GL posting матриц — модуль бүрийн journal template |
| `02-period-close.md` | Period close процедур (depreciation → FX → accruals → CIT → ECL → NRV) |

---

## 03 — Стандарт

**`03-стандарт/`**

| Файл / Хавтас | Агуулга |
|---------------|---------|
| `chart-of-accounts.md` | Монгол улсын стандарт дансны төлөвлөгөө |
| `segment-strategy.md` | 10-сегментийн стратеги: ашиглалт, validation, defaulting, reporting + Segment3 дансны бүрэн жагсаалт (§7.1.1–7.1.2) |
| `segment-active-inactive-rule.md` | **Заавал мөрдөх стандарт** — идэвхтэй/идэвхгүй сегментийн UI харагдац, DB write (0-padded), DB read ("all" wildcard) дүрэм |
| `05-event-flows.md` | Cross-module үйл явдлын урсгал |
| `ui-standards/01-tables.md` | `<StandardTable>` стандарт — Excel-маягийн хүснэгт |
| `ui-standards/02-search-filters.md` | Хайх/шүүлтүүр: CalendarRange, PeriodSelector, SegmentAccountInput гэх мэт |
| `ui-standards/03-popups-modals.md` | Modal/Popup стандарт |
| `ui-standards/04-theme-glass.md` | Glass UI theme tokens |
| `ui-standards/05-i18n.md` | i18n стандарт (mn/en/zh/ru) |
| `ui-standards/06-component-conventions.md` | Component бичих конвенц |
| `ui-standards/07-table-inventory.md` | Бүх хүснэгтийн inventory |
| `ui-standards/08-rollout-plan.md` | Стандарт хэрэгжилтийн төлөвлөгөө |

---

## 04 — AI Agent

**`04-ai-agent/`**

| Хавтас / Файл | Загвар | Хариуцах хүрээ |
|---------------|--------|----------------|
| `agents/chief-accountant.md` | Opus | Cross-module архитектур, year-end close, consolidation |
| `agents/gl-accountant.md` | Opus | GL журнал, period close, IFRS-driven код |
| `agents/tax-specialist.md` | Opus | НӨАТ, ААНОАТ, ХАОАТ, WHT, eBarimt |
| `agents/payroll-dev.md` | Sonnet | Цалин тооцоолол, НДШ/ЭМД, payroll GL |
| `skills/ifrs/SKILL.md` | — | IFRS/IAS skill: account codes, GL загвар, standard citation |
| `skills/mongolian-tax/SKILL.md` | — | Монгол татварын skill: rates, brackets, GL |
| `skills/payroll/SKILL.md` | — | Цалингийн skill: Gross→Net, SI/PIT, GL |
| `skills/coa/SKILL.md` | — | Chart of Accounts skill: 10-сегмент, 8-digit код |

---

## Нийт файл

| Бүлэг | Файлын тоо |
|-------|-----------|
| 01 Онол хууль стандарт | 50 |
| 02 Нягтлан бодох мэргэжлийн | 22 |
| 03 Стандарт | 11 |
| 04 AI Agent | 8 |
| **Нийт** | **91** |
