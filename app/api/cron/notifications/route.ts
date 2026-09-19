import { NextResponse } from "next/server";

import { runDailyNotifications } from "@/lib/notifications/scheduler";
import { todayInUlaanbaatar } from "@/lib/periods/selection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Хуваарьт мэдэгдлийн КАНОНИК оролт (docs/notifications §4.2): Railway cron
// service / GitHub Actions schedule / гараар curl. proxy.ts matcher `/api`-г
// алгасдаг тул нэвтрэлтийн redirect-д орохгүй — ӨӨРӨӨ нууцаа шалгана:
//   Authorization: Bearer $CRON_SECRET
// CRON_SECRET тохируулаагүй deployment-д зам хаалттай (503) — in-process
// ticker (lib/notifications/ticker.ts) тэнд default-оор ажиллана.
//
// ?date=YYYY-MM-DD — тухайн өдрийг (backfill/тест) дахин ажиллуулна;
// байгууллага × өдөр нэг л удаа тул давхар дуудахад аюулгүй.

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.length > 0 && token === secret;
}

async function handle(request: Request) {
  if (!process.env.CRON_SECRET?.trim())
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET тохируулаагүй — in-process ticker ажиллаж байна" },
      { status: 503 }
    );
  if (!authorized(request))
    return NextResponse.json({ ok: false, error: "Нэвтрэх эрхгүй" }, { status: 401 });

  const date = new URL(request.url).searchParams.get("date") ?? todayInUlaanbaatar();
  try {
    const result = await runDailyNotifications(date);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
