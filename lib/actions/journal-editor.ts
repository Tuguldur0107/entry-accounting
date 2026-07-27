"use server";

// Журналын засварлагчийг ПАНЕЛЬ дотор ачаалахад хэрэгтэй өгөгдөл.
// Standalone хуудас (app/(standalone)/gl/journal/...) серверээс шууд
// уншдаг; панель нь клиентээс нээгддэг тул энэ action-аар татна.
// Хоёулаа ижил дүрэм: readOnly = ноорог биш, дансны жагсаалт readOnly
// үед бүгд (идэвхгүй болсон данстай хуучин бичилтийн нэр харагдана).

import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  journalVouchers,
  segmentConfigs,
  segmentValues,
  type ChartOfAccount,
  type SegmentValue,
} from "@/lib/db/schema";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";

export interface JournalEditorData {
  accounts: ChartOfAccount[];
  segmentValues: SegmentValue[];
  activeSegIds: number[];
  defaultSegments: Record<number, string>;
  voucher: {
    id: string;
    date: string;
    description: string;
    status: string;
    createdAt: string;
    lines: {
      account: string;
      debit: string;
      credit: string;
      description: string;
    }[];
  } | null;
  readOnly: boolean;
}

// Алдааг throw хийхгүй — production build дээр Next.js server action-ий
// error message-ийг нууж "An error occurred..." болгодог тул код буцаана.
export type JournalEditorResult =
  | { ok: true; data: JournalEditorData }
  | { ok: false; code: "unauthenticated" | "not-found" };

export async function getJournalEditorData(
  voucherId?: string
): Promise<JournalEditorResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "unauthenticated" };

  const [voucher, accounts, rawSegConfigs, rawSegValues] = await Promise.all([
    voucherId
      ? db.query.journalVouchers.findFirst({
          where: and(
            eq(journalVouchers.id, voucherId),
            eq(journalVouchers.userId, userId)
          ),
          with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
        })
      : Promise.resolve(undefined),
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.userId, userId),
      orderBy: (account, { asc }) => [asc(account.number)],
    }),
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.userId, userId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.userId, userId),
        eq(segmentValues.isEnabled, true)
      ),
      orderBy: (value, { asc }) => [asc(value.segmentId), asc(value.code)],
    }),
  ]);

  if (voucherId && !voucher) return { ok: false, code: "not-found" };

  const segConfigMap = new Map(rawSegConfigs.map((c) => [c.segmentId, c]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (def) => def.id === 3 || segConfigMap.get(def.id)?.isEnabled === true
  ).map((def) => def.id);

  const defaultSegments: Record<number, string> = {};
  if (activeSegIds.includes(1)) {
    const s1Values = rawSegValues.filter((value) => value.segmentId === 1);
    if (s1Values.length === 1) defaultSegments[1] = s1Values[0].code;
  }

  return {
    ok: true,
    data: {
      accounts,
      segmentValues: rawSegValues,
      activeSegIds,
      defaultSegments,
      readOnly: voucher ? voucher.status !== "draft" : false,
      voucher: voucher
        ? {
            id: voucher.id,
            date: voucher.date,
            description: voucher.description,
            status: voucher.status,
            createdAt: voucher.createdAt
              .toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" })
              .slice(0, 16),
            lines: voucher.lines.map((line) => ({
              account: line.accountNumber,
              // Буцаалтын журналын дүн СӨРӨГ — 0-ээс ялгаатай бүгдийг дамжуулна.
              debit: Number(line.debit) !== 0 ? String(Number(line.debit)) : "",
              credit:
                Number(line.credit) !== 0 ? String(Number(line.credit)) : "",
              description: line.description ?? "",
            })),
          }
        : null,
    },
  };
}
