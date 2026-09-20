// QPay нэг товчны холболт — dashboard-аас буцах callback
// (docs/pos/04-qpay-integration-plan.md §3.6, dashboard docs/API.md «Connect»).
//
// GET ?state=<шифрлэсэн>&code=<нэг удаагийн> → state тайлна (org/user/apiUrl,
// 15 мин) → dashboard /api/connect/exchange (сервер-сервер) → API key +
// webhook secret encryptSecret-ээр pos_settings-д → «QPay» хэлбэр + түр данс
// seed → readiness бүрэн бол асаана → тохиргооны QPay таб руу redirect.
// Нууц URL, лог, аудитад ХЭЗЭЭ Ч орохгүй. Cookie session шаардахгүй (org нь
// state-ээс; state нь authenticated шифр тул зохиох боломжгүй).

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { encryptSecret } from "@/lib/ai/crypto";
import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { posSettings } from "@/lib/db/schema";
import { ensurePosSettings } from "@/lib/pos/load-data";
import { QpayError } from "@/lib/qpay/client";
import { exchangeConnectCode, parseConnectState } from "@/lib/qpay/connect";
import { QPAY_ERRORS } from "@/lib/qpay/constants";
import { ensureQpayPaymentMethod, loadQpayReadiness, publicAppUrl } from "@/lib/qpay/store";

export const dynamic = "force-dynamic";

const SETTINGS_PATH = "/inventory/sales?tab=settings&section=qpay";

function redirectTo(request: Request, params: Record<string, string>) {
  const base = publicAppUrl() ?? new URL(request.url).origin;
  const url = new URL(SETTINGS_PATH, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url.toString(), { status: 303 });
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const state = search.get("state")?.trim() ?? "";
  const code = search.get("code")?.trim() ?? "";
  const parsed = parseConnectState(state);
  if (!parsed) return redirectTo(request, { qpay: "error", reason: "state" });
  if (!/^qpc_[A-Za-z0-9_-]{20,}$/.test(code)) return redirectTo(request, { qpay: "error", reason: "code" });

  const { orgId, userId, apiUrl } = parsed;
  try {
    const settings = await ensurePosSettings(orgId, userId);
    const grant = await exchangeConnectCode(apiUrl, code, state);

    const seeded = await ensureQpayPaymentMethod(orgId, userId);
    const patch: Partial<typeof posSettings.$inferInsert> = {
      qpayApiUrl: apiUrl,
      qpayApiKeyEnc: encryptSecret(grant.apiKey),
      qpayWebhookSecretEnc: encryptSecret(grant.webhookSecret),
      qpayMerchantId: grant.merchantId,
      updatedAt: new Date(),
    };
    const readiness = await loadQpayReadiness(orgId, { ...settings, ...patch } as typeof settings, { seedOnEnable: false });
    if (readiness.ready) patch.qpayEnabled = true;
    await db.update(posSettings).set(patch).where(eq(posSettings.id, settings.id));

    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "connect_completed",
      entityType: "pos_settings",
      entityId: settings.id,
      // Нууцын утга ҮГҮЙ — зөвхөн мерчант id, асаасан эсэх, seed-ийн тайлбар.
      summary: `QPay холбогдов — мерчант ${grant.merchantId}${grant.merchantName ? ` (${grant.merchantName})` : ""}; ${
        readiness.ready ? "асаалттай" : `асаагаагүй: ${readiness.problems.join("; ")}`
      }${seeded.length ? `; ${seeded.join("; ")}` : ""}`,
    });
    return redirectTo(request, { qpay: readiness.ready ? "connected" : "connected-off" });
  } catch (caught) {
    const reason = caught instanceof QpayError && caught.code === QPAY_ERRORS.connectExpired ? "expired" : "exchange";
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "connect_failed",
      entityType: "pos_settings",
      entityId: orgId,
      summary: `QPay холболт амжилтгүй — ${caught instanceof Error ? caught.message : "тодорхойгүй"}`,
    });
    return redirectTo(request, { qpay: "error", reason });
  }
}
