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

export const db = drizzle(client, { schema });
