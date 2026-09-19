import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posEbarimtSubmissions, posSettings } from "@/lib/db/schema";
import { deploymentLicenseStatus } from "@/lib/licensing/license";
import { APP_VERSION, GIT_SHA } from "@/lib/version";

export const dynamic = "force-dynamic";

// Railway healthcheck + fork/deploy-ийн хувилбар шалгах цэг (нэвтрэлтгүй,
// нууцгүй): { ok, version, sha, license, ebarimt }. license.reason нь хэрэглэгчид
// харуулах ерөнхий текст — нууц агуулаагүй. ebarimt нь Entry Console-ийн
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

export async function GET() {
  const license = deploymentLicenseStatus();
  const meta = {
    version: APP_VERSION,
    sha: GIT_SHA,
    license: { ok: license.ok, mode: license.mode, reason: license.reason },
  };
  try {
    await db.execute(sql`select 1`);
    const ebarimt = await ebarimtHealth();
    return NextResponse.json({ ok: true, ...meta, ebarimt });
  } catch (err) {
    return NextResponse.json(
      { ok: false, ...meta, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
