import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// `node --test` (tsx --test) файл бүрийг тусдаа процесст ажиллуулдаг бөгөөд
// тест дууссаны дараа сул холболт амьд байх хугацаанд (idle_timeout) процесс
// гарахгүй — 20 сек × DB тестийн файл бүр ≈ CI-д 6 минут хоосон хүлээлт
// (main-ийн CI-г Railway deploy хүлээдэг тул deploy мөн удааширдаг байв).
// Тестийн процесст (runner `NODE_TEST_CONTEXT` тавьдаг) сул холболтыг 1 сек-д хаана.
const IDLE_TIMEOUT_SEC = process.env.NODE_TEST_CONTEXT ? 1 : 20;

const client = postgres(process.env.DATABASE_URL!, {
  max: 10,
  idle_timeout: IDLE_TIMEOUT_SEC,
});

const base = drizzle(client, { schema });

// Fork-ийн журналын hook (ontology-audit M4): транзакц бүрийн callback-ийн
// ДАРАА, commit-ийн ӨМНӨ батлагдсан журналуудад `beforeJournalPost`, commit-ийн
// ДАРАА `afterJournalPost` — БҮХ модуль нэг цэгээр (lib/custom/journal-hooks.ts).
// Hook бүртгээгүй бол шууд дамжуулна. Модулийг динамикаар ачаална — custom/
// багц нь `@/lib/db`-г импортлодог тул статик импорт цикл үүсгэнэ.
const rawTransaction = base.transaction.bind(base);
base.transaction = (async (callback, config) => {
  const hooks = await import("../custom/journal-hooks");
  if (!hooks.hasJournalHooks()) return rawTransaction(callback, config);
  let contexts: Awaited<ReturnType<typeof hooks.runJournalPostHooksInTx>> = [];
  const result = await rawTransaction(async (tx) => {
    const value = await callback(tx);
    contexts = await hooks.runJournalPostHooksInTx(tx);
    return value;
  }, config);
  await hooks.runAfterJournalPostHooks(contexts);
  return result;
}) as typeof base.transaction;

export const db = base;
