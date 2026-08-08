# Migration-ийн төлөв (2026-08-08 нэгтгэл)

## Одоогийн байдал

- **Journal гинж бүрэн:** `_journal.json` 0000→0015, файл бүр journal-тайгаа
  нийцтэй. Шинэ орчинг `npx drizzle-kit migrate`-ээр TEG-ээс босгож болно.
- **Production (Railway):** `npm run db:push`-ээр удирдагдсаар ирсэн — push нь
  live DB-тэй diff хийдэг тул journaled гинжтэй зэрэгцэн ажиллана.
  0015_dusty_ink-ийн DDL нь `2026-08-08-hot-path-indexes.sql`-тай ижил агуулгатай.

## legacy/ хавтас

2026-08-08-ны аудитаар journal-д бүртгэлгүй, дугаар нь давхардсан 4 файл
олдсон (`0013_ai_messages.sql`, `0014_ai_settings_attachments.sql`,
`0015_fa_depreciation_method.sql`, `0016_fa_custodian.sql`). Шалгахад эдгээрийн
агуулга journaled `0013_lethal_sersi.sql` / `0014_misty_iron_fist.sql`-д
бүрэн давхардсан байсан тул гинжээс хасаж энд архивлав. Устгаж болно.

## Дүрэм (цаашид)

1. Schema өөрчлөлт → `npx drizzle-kit generate` (journal автоматаар шинэчлэгдэнэ)
2. Production-д түгээх → `npm run db:push`
3. Migration файлыг ГАРААР үүсгэхгүй, дугаар давхардуулахгүй
4. Гараар SQL ажиллуулсан бол энэ хавтаст тэмдэглэнэ

## ⚠️ db:push-ийн анхааруулга

- `drizzle-kit push` (v0.31) нь `cash_documents_user_id_document_no_unique`
  constraint DB-д БАЙСААР байтал "нэмэх үү, truncate хийх үү?" гэж асуудаг
  introspection-ийн алдаатай. **"Truncate" гэж ХЭЗЭЭ Ч хариулахгүй** —
  "No" сонго (constraint аль хэдийн бий тул statement алдаа өгөөд өнгөрнө).
- Аюулгүй хувилбар: `npx tsx scripts/apply-audit-ddl.ts` (идемпотент,
  truncate огт хийдэггүй) + `npx tsx scripts/verify-audit-ddl.ts` (шалгалт).
  2026-08-08-нд бүх объект ийм замаар түгээгдэж баталгаажсан.
