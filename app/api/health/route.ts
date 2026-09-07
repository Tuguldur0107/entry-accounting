import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { APP_VERSION, GIT_SHA } from "@/lib/version";

export const dynamic = "force-dynamic";

// Railway healthcheck + fork/deploy-ийн хувилбар шалгах цэг (нэвтрэлтгүй,
// нууцгүй): { ok, version, sha }.
export async function GET() {
  const meta = { version: APP_VERSION, sha: GIT_SHA };
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, ...meta });
  } catch (err) {
    return NextResponse.json(
      { ok: false, ...meta, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
