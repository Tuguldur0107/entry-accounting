import { NextResponse } from "next/server";

import { processPendingEbarimt, releaseStaleClaims, runEbarimtSendData } from "@/lib/ebarimt/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// eBarimt worker-ийн гадаад оролт (Railway cron / гараар curl) — app/api/cron/
// notifications-тай ижил: Authorization: Bearer $CRON_SECRET; CRON_SECRET
// байхгүй бол 503 (in-process ticker lib/ebarimt/ticker.ts ажиллана).
// ?job=process|senddata|all (default process).

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.length > 0 && token === secret;
}

async function handle(request: Request) {
  if (!process.env.CRON_SECRET?.trim())
    return NextResponse.json({ ok: false, error: "CRON_SECRET тохируулаагүй — in-process worker ажиллаж байна" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Нэвтрэх эрхгүй" }, { status: 401 });
  const job = new URL(request.url).searchParams.get("job") ?? "process";
  if (!["process", "senddata", "all"].includes(job))
    return NextResponse.json({ ok: false, error: "job нь process | senddata | all" }, { status: 400 });
  try {
    await releaseStaleClaims();
    const process_ = job === "process" || job === "all" ? await processPendingEbarimt() : undefined;
    const sendData = job === "senddata" || job === "all" ? await runEbarimtSendData() : undefined;
    return NextResponse.json({ ok: true, process: process_, sendData });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
