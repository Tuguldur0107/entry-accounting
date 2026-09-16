// Beacon — deployment асахад Entry Console руу чимээгүй "би энд ажиллаж
// байна" дохио илгээнэ. Зорилго: зөвшөөрөлгүй хуулбарыг ИЛРҮҮЛЭХ (устгах
// БИШ — logic bomb хийхгүй, docs/deployment/README.md §лиценз).
//
// Хоёр гарал үүслийн дохио:
//   1. license  — ENTRY_LICENSE token (Console public key-ээр баталгаажна →
//                 slug + appUrl). Хулгайлсан DEPLOYMENT-ийг таньдаг.
//   2. origin   — repo-д commit хийгдсэн `.entry-origin` тэмдэг (аль харилцагчийн
//                 repo-оос clone хийснийг git-ээр дагадаг). Хулгайлсан КОДЫГ
//                 таньдаг — env байхгүй ч харагдана.
//
// Console тал (/api/beacon) хоёрыг тулгаж: лицензтэй+URL таарсан = хэвийн
// heartbeat; URL зөрсөн / лицензгүй / бүртгэлгүй = сэрэмжлүүлэг.
//
// Fire-and-forget: сүлжээ/алдаа хэзээ ч app-ыг унагахгүй. Гол урсгалыг
// саатуулахгүйн тулд await хийхгүй.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { APP_VERSION, GIT_SHA } from "@/lib/version";
import { deploymentLicenseStatus } from "@/lib/licensing/license";

/** Console-ийн хүлээн авагч — код дотор baked (env-ээр дарж болно). Env-ийг
 *  устгасан ч дохио зогсохгүй: default нь бодит Console. */
const BEACON_URL =
  process.env.ENTRY_BEACON_URL?.trim() ||
  "https://entry-console-production.up.railway.app/api/beacon";

/** Процессын амьдралын турш нэг ID — Console давхардлыг тоолж, нэг instance-ийн
 *  давтан дохиог ялгана. */
const INSTANCE_ID = randomUUID();

let started = false;

/** Repo-д commit хийгдсэн гарал үүслийн тэмдэг (аль харилцагчийнх). Байхгүй
 *  бол core өөрөө эсвэл тэмдэггүй хуулбар. */
function readOriginMarker(): { slug?: string; repo?: string } | null {
  try {
    const raw = readFileSync(join(process.cwd(), ".entry-origin"), "utf8");
    const parsed = JSON.parse(raw) as { slug?: string; repo?: string };
    if (parsed && typeof parsed.slug === "string") return parsed;
  } catch {
    /* тэмдэггүй — core эсвэл арилгасан */
  }
  return null;
}

function ownOrigin(): string | undefined {
  const url = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

async function fire(): Promise<void> {
  const origin = readOriginMarker();
  const license = deploymentLicenseStatus();

  const payload = {
    instanceId: INSTANCE_ID,
    appUrl: ownOrigin() ?? null,
    // ENTRY_LICENSE-ийг ТҮҮХИЙГЭЭР дамжуулна — Console public key-ээр өөрөө
    // баталгаажуулж slug/appUrl-ийг гаргана (хуурамч дохиог шүүнэ).
    license: process.env.ENTRY_LICENSE?.trim() || null,
    licenseMode: license.mode,
    originSlug: origin?.slug ?? null,
    originRepo: origin?.repo ?? null,
    version: APP_VERSION,
    sha: GIT_SHA,
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    at: new Date().toISOString(),
  };

  try {
    await fetch(BEACON_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* сүлжээгүй/Console унасан — дараагийн интервалд дахин оролдоно */
  }
}

/**
 * Асах үед нэг удаа + 12 цаг тутам давтан дохио. Дуудагдана:
 *   instrumentation.ts register() (nodejs runtime).
 *
 * Дохио илгээх нөхцөл:
 *   - production бол ҮРГЭЛЖ (raw core clone deploy-ийг ч барина)
 *   - dev бол ЗӨВХӨН .entry-origin тэмдэгтэй үед (= харилцагчийн repo-г local
 *     ажиллуулж байна; core-ийн өөрийн dev тэмдэггүй тул spam үүсэхгүй)
 */
export function startBeacon(): void {
  if (started) return;
  started = true;

  const isProd = process.env.NODE_ENV === "production";
  const hasMarker = readOriginMarker() !== null;
  if (!isProd && !hasMarker) return; // core-ийн локал хөгжүүлэлт — дохио хэрэггүй

  void fire();
  // Урт ажилладаг instance-ийг тогтмол харуулна; unref → shutdown-д саад болохгүй.
  const timer = setInterval(() => void fire(), 12 * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
}
