// Группын БАГЦ ӨВЛӨЛТ — нэг нягтлан / нэг эзэн олон компани хөтлөхөд.
//
// АСУУДАЛ: багц нь БАЙГУУЛЛАГА бүрд тусдаа мөртэй (organization_subscriptions
// нь org_ux unique) атлаа компанийн ХЯЗГААР нь ЭЗЭН хүнээр тоологддог
// (`countOwnedCompanies`). Улмаар «Platform багц = 10 компани» авсан
// харилцагчийн 2–10 дахь компани нь мөргүй үүсч, өөрийн 14 хоногийн trial
// дуусмагц БИЧИХ ЭРХГҮЙ болдог байв — төлбөрөө төлсөн атлаа.
//
// ШИЙДЭЛ: шинэ компани үүсэхэд ЭХ байгууллагынхаа багцыг өвлөнө. Console
// дээр НЭГ мөр удирдахад бүх групп ажиллана.
//
// ДҮРМҮҮД:
//  • Зөвхөн `saas` горимд (dedicated-д хязгаар байхгүй).
//  • Эх байгууллагад мөр БАЙХГҮЙ бол юу ч хийхгүй — шинэ компани өнөөдрийн
//    адил өөрийн trial-аа авна (мөр зохиохгүй).
//  • Үнэ ҮРГЭЛЖ 0 — багцын төлбөр ЭХ байгууллага дээр үлдэнэ, групп доторх
//    компани бүр дээр давхар тооцогдохгүй.
//  • Компанийн ХЯЗГААР өвлөгдөхгүй: групп доторх компаниас шинийг нэмэхэд
//    хязгаар нь эх байгууллагынхтай ИЖИЛ байх ёстой тул overrides хэвээр
//    дамжина (limits.companies нь эзний нийт компанид хамаарна).
//  • ХЭЗЭЭ Ч шидэхгүй — багц өвлөгдөөгүйгээс компани үүсэх нь зогсохгүй.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { organizationSubscriptions } from "@/lib/db/schema";
import { deploymentMode } from "@/lib/deployment-mode";

/** Өвлөгдсөн мөрийг ИЛ тэмдэглэнэ — Console дээр яагаад 0₮ болохыг хэлнэ. */
export const GROUP_INHERITED_NOTE = "Группын багцаас өвлөсөн (төлбөр эх байгууллага дээр)";

/** Өвлөх боломжтой талбарууд (DB-гүй хэлбэр — тесттэй). */
export type InheritableSubscription = {
  planId: string;
  status: string;
  seats: number | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  overrides: unknown;
};

export type InheritedPlan = InheritableSubscription & {
  /** Групп доторх компани ХЭЗЭЭ Ч дахин төлбөр үүсгэхгүй. */
  pricePerSeatMnt: 0;
  note: string;
};

/**
 * ЦЭВЭР төлөвлөгч: эх байгууллагын багцаас шинэ компанид бичих утгууд.
 * `null` = өвлөх зүйл алга (эх нь мөргүй, эсвэл багц нь бичих эрхгүй).
 *
 * `cancelled` / `suspended` багцыг өвлүүлэхгүй — тэгвэл шинэ компани
 * төрөхөөсөө read-only болно. Тэр тохиолдолд мөр үүсгэхгүй (trial дагана)
 * нь харилцагчид ИЛҮҮ ЗӨВ: 14 хоног ажиллаад асуудлаа шийдэх боломжтой.
 */
export function planInheritedSubscription(
  source: InheritableSubscription | null | undefined
): InheritedPlan | null {
  if (!source) return null;
  if (source.status === "cancelled" || source.status === "suspended") return null;
  return {
    planId: source.planId,
    status: source.status,
    seats: source.seats ?? null,
    trialEndsAt: source.trialEndsAt ?? null,
    currentPeriodEnd: source.currentPeriodEnd ?? null,
    overrides: source.overrides ?? null,
    pricePerSeatMnt: 0,
    note: GROUP_INHERITED_NOTE,
  };
}

/**
 * Шинэ компанид эх байгууллагын багцыг өвлүүлнэ. ХЭЗЭЭ Ч шидэхгүй.
 *
 * Идемпотент: шинэ байгууллагад мөр аль хэдийн байвал ХӨНДӨХГҮЙ
 * (`onConflictDoNothing`) — Console-оос гараар тавьсан утга дарагдахгүй.
 */
export async function inheritSubscriptionForNewOrg(
  sourceOrgId: string,
  newOrgId: string,
  actorUserId: string | null = null
): Promise<boolean> {
  try {
    if (deploymentMode() !== "saas") return false;
    if (!sourceOrgId || !newOrgId || sourceOrgId === newOrgId) return false;

    const source = await db.query.organizationSubscriptions.findFirst({
      where: eq(organizationSubscriptions.organizationId, sourceOrgId),
      columns: {
        planId: true,
        status: true,
        seats: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        overrides: true,
      },
    });
    const plan = planInheritedSubscription(source ?? null);
    if (!plan) return false;

    await db
      .insert(organizationSubscriptions)
      .values({
        organizationId: newOrgId,
        planId: plan.planId,
        status: plan.status,
        seats: plan.seats,
        trialEndsAt: plan.trialEndsAt,
        currentPeriodEnd: plan.currentPeriodEnd,
        overrides: plan.overrides as never,
        pricePerSeatMnt: plan.pricePerSeatMnt,
        note: plan.note,
        updatedBy: actorUserId,
      })
      .onConflictDoNothing({ target: organizationSubscriptions.organizationId });
    return true;
  } catch (error) {
    // Багц өвлөгдөхгүй байх нь компани үүсэхгүй байхаас ДЭЭР — шинэ компани
    // хамгийн муудаа өөрийн trial-аа авна, Console-оос гараар засаж болно.
    console.error("[billing] багц өвлүүлж чадсангүй:", error);
    return false;
  }
}
