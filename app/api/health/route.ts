import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posEbarimtSubmissions, posQpayIntents, posSettings } from "@/lib/db/schema";
import { QPAY_PAID_UNFINALIZED_MINUTES } from "@/lib/qpay/constants";
import { knowledgeStats } from "@/lib/knowledge/store";
import { aiLoggingHealthStats } from "@/lib/ai-logging/service";
import { deploymentLicenseStatus } from "@/lib/licensing/license";
import { deploymentMode } from "@/lib/deployment-mode";
import { APP_VERSION, GIT_SHA } from "@/lib/version";

export const dynamic = "force-dynamic";

// Railway healthcheck + fork/deploy-ийн хувилбар шалгах цэг (нэвтрэлтгүй,
// нууцгүй): { ok, version, sha, license, ebarimt, qpay, knowledge, aiLog }.
// license.reason нь хэрэглэгчид харуулах ерөнхий текст — нууц агуулаагүй. ebarimt нь Entry Console-ийн
// хяналтад (docs/pos/03 §3.1): зөвхөн тоолуур — ТТД, нууц байхгүй.
async function ebarimtHealth() {
  try {
    const [orgs] = await db
      .select({
        enabled: sql<number>`count(*) filter (where ${posSettings.ebarimtEnabled})`,
        server: sql<number>`count(*) filter (where ${posSettings.ebarimtEnabled} and ${posSettings.ebarimtMode} = 'server')`,
      })
      .from(posSettings);
    const [queue] = await db
      .select({
        pending: sql<number>`count(*) filter (where ${posEbarimtSubmissions.status} in ('pending', 'claimed'))`,
        failed: sql<number>`count(*) filter (where ${posEbarimtSubmissions.status} = 'failed')`,
        lastSentAt: sql<Date | null>`max(${posEbarimtSubmissions.sentAt})`,
      })
      .from(posEbarimtSubmissions);
    return {
      enabledOrganizations: Number(orgs?.enabled ?? 0),
      serverModeOrganizations: Number(orgs?.server ?? 0),
      pending: Number(queue?.pending ?? 0),
      failed: Number(queue?.failed ?? 0),
      lastSentAt: queue?.lastSentAt ? new Date(queue.lastSentAt).toISOString() : null,
    };
  } catch {
    // Хүснэгт хараахан үүсээгүй (push дуусаагүй) — health унагахгүй.
    return null;
  }
}

/** QPay — зөвхөн тоолуур (нууц, мерчант id БАЙХГҮЙ). */
/** Мэдлэгийн сан — зөвхөн тоолуур (seed ажилласан эсэхийг deploy-ийн дараа шалгана). */
async function knowledgeHealth() {
  try {
    return await knowledgeStats();
  } catch {
    return null;
  }
}

async function qpayHealth() {
  try {
    const [orgs] = await db
      .select({ enabled: sql<number>`count(*) filter (where ${posSettings.qpayEnabled})` })
      .from(posSettings);
    const cutoff = new Date(Date.now() - QPAY_PAID_UNFINALIZED_MINUTES * 60_000);
    const [intents] = await db
      .select({
        open: sql<number>`count(*) filter (where ${posQpayIntents.status} = 'open')`,
        paidUnfinalized: sql<number>`count(*) filter (where ${posQpayIntents.status} = 'paid' and ${posQpayIntents.saleId} is null and ${posQpayIntents.paidAt} < ${cutoff.toISOString()}::timestamptz)`,
        lastPaidAt: sql<Date | null>`max(${posQpayIntents.paidAt})`,
      })
      .from(posQpayIntents);
    return {
      enabledOrganizations: Number(orgs?.enabled ?? 0),
      openIntents: Number(intents?.open ?? 0),
      paidUnfinalized: Number(intents?.paidUnfinalized ?? 0),
      lastPaidAt: intents?.lastPaidAt ? new Date(intents.lastPaidAt).toISOString() : null,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const license = deploymentLicenseStatus();
  const meta = {
    version: APP_VERSION,
    sha: GIT_SHA,
    license: { ok: license.ok, mode: license.mode, reason: license.reason },
    deploymentMode: deploymentMode(),
  };
  try {
    await db.execute(sql`select 1`);
    const ebarimt = await ebarimtHealth();
    // aiLog — ML сургалтын шошготой бүртгэл хуримтлагдаж буй эсэх (зөвхөн тоо,
    // docs/ai-logging.md §11).
    const [qpay, knowledge, aiLog] = await Promise.all([
      qpayHealth(),
      knowledgeHealth(),
      aiLoggingHealthStats(),
    ]);
    return NextResponse.json({ ok: true, ...meta, ebarimt, qpay, knowledge, aiLog });
  } catch (err) {
    return NextResponse.json(
      { ok: false, ...meta, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
