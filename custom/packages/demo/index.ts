// Жишээ багц — БҮХ төрлийн өргөтгөлийг нэг дор үзүүлнэ:
//   • custom AI/MCP tool (чат БА MCP хоёуланд автоматаар харагдана)
//   • beforeJournalPost hook — тайлбаргүй журналыг батлахаас сэргийлнэ
//   • afterJournalPost hook — гадаад системд webhook илгээнэ (integration)
//
// Идэвхжүүлэх: custom/index.ts-д
//   import { demoPackage } from "./packages/demo";
//   export const customization = mergeCustomizations(demoPackage);
//
// Хуулж өөрийн багцаа хийхэд: хавтсыг custom/packages/<нэр>/ болгож нэрлээд
// index.ts-ийн export нэрийг солино. Core файлд гар хүрэх ШААРДЛАГАГҮЙ.

import { and, eq, gte, lte } from "drizzle-orm";

import type { EntryCustomization } from "@/lib/custom/types";
import { db } from "@/lib/db";
import { journalVouchers } from "@/lib/db/schema";
import { periodRange, isPeriodCode } from "@/lib/periods/period";

export const demoPackage: EntryCustomization = {
  name: "demo",
  version: "1.0.0",

  tools: [
    {
      name: "get_journal_count_by_month",
      description:
        "Сонгосон сарын журналын тоог статусаар (ноорог / батлагдсан / буцаагдсан) тоолно. Custom багцын жишээ tool.",
      inputSchema: {
        type: "object",
        properties: {
          month: { type: "string", description: "Сар YYYY-MM" },
        },
        required: ["month"],
      },
      async execute(ctx, input) {
        const { month } = (input ?? {}) as { month?: string };
        if (!month || !isPeriodCode(month))
          throw new Error("month нь YYYY-MM хэлбэртэй байх ёстой");
        const { startDate, endDate } = periodRange(month);
        // orgId-аар ЗААВАЛ шүүнэ — бүх хүснэгт байгууллагаар тусгаарлагдсан.
        const rows = await db.query.journalVouchers.findMany({
          where: and(
            eq(journalVouchers.organizationId, ctx.orgId),
            gte(journalVouchers.date, startDate),
            lte(journalVouchers.date, endDate)
          ),
          columns: { status: true },
        });
        const counts: Record<string, number> = {};
        for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
        const text = Object.entries(counts)
          .map(([status, n]) => `${status}: ${n}`)
          .join(", ");
        return { resultText: `${month} — нийт ${rows.length} журнал (${text || "хоосон"})` };
      },
    },
  ],

  hooks: {
    async beforeJournalPost(ctx) {
      if (!ctx.description.trim())
        return { ok: false, reason: "Тайлбаргүй журнал батлагдахгүй (custom дүрэм)" };
      return { ok: true };
    },

    // Гадаад систем рүү (ERP, CRM, Slack, n8n, Make…) мэдэгдэл. URL нь env-д —
    // custom кодонд нууц/хаяг хатуу бичихгүй.
    async afterJournalPost(ctx) {
      const url = process.env.CUSTOM_WEBHOOK_URL;
      if (!url) return;
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "journal.posted",
          voucherId: ctx.voucherId,
          date: ctx.date,
          description: ctx.description,
          totalDebit: ctx.totalDebit,
          lines: ctx.lines,
        }),
        signal: AbortSignal.timeout(5000),
      });
    },
  },
};
