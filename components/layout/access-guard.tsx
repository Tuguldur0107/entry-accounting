// Route-ийн түвшний эрхийн хаалт — модуль бүрийн layout.tsx-д суудаг.
//
// ШАЛТГААН: гишүүний модулийн эрх «Байхгүй» (none) байхад навигаци нуугддаг
// ч URL-ээр шууд орвол хуудас ачаалагдаж байсан (уншилтын loader-ууд
// getActiveOrg-оор л scope авдаг). Server action-ууд бичилтийг хаадаг
// (requireModuleAction) — энэ guard УНШИЛТЫГ хаана. Layout нь тухайн модулийн
// БҮХ хуудсыг хамардаг тул шинэ хуудас нэмэхэд мартагдахгүй.
//
// `tests/module-route-guards.test.ts` модулийн хавтас бүрд guard-тай layout
// байгааг статикаар шалгана.

import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { ModuleAccessProvider } from "@/components/layout/module-access-context";
import { getActiveOrg, moduleAccess } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { getEntitlements } from "@/lib/billing/load";
import type { MembershipRole } from "@/lib/db/schema";
import { roleAtLeast } from "@/lib/permissions";

export function AccessDenied({
  title = "Энэ хэсэгт хандах эрх байхгүй",
  description = "Тохиргоо → Хэрэглэгчдийн эрх хэсгээс байгууллагын админ эрх олгоно.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col">
      <EmptyState
        icon="locked"
        title={title}
        description={description}
        actions={[{ label: "Хяналтын самбар руу буцах", href: "/", icon: "dashboard", primary: true }]}
      />
    </div>
  );
}

/**
 * Модулийн уншилтын guard — `moduleKeys`-ийн АЛЬ НЭГД нь ядаж «Унших»
 * түвшинтэй бол хүүхдүүдээ render хийнэ, үгүй бол AccessDenied.
 * (Хоёр түлхүүр — АР/АП-ийн хамтарсан хуудас гэх мэт.)
 */
export async function ModuleGuard({
  moduleKeys,
  children,
}: {
  moduleKeys: string | string[];
  children: ReactNode;
}) {
  const keys = Array.isArray(moduleKeys) ? moduleKeys : [moduleKeys];
  const { active, levels } = await moduleAccess(keys);
  // «AI нягтлан» (skills) багц — нягтлан бодох систем ороогүй (action-ууд
  // requireModuleAction-оор мөн хаагдана; энэ нь URL-ээр орсон үеийн хуудас).
  if (!hasFeature(await getEntitlements(active.orgId), "accounting"))
    return (
      <AccessDenied
        title="«AI нягтлан» багцад нягтлан бодох систем ороогүй"
        description="Мэдлэгийн сангаа өөрийн ChatGPT / Claude-оос ашиглана — холбох заавар нүүр хуудсанд. Системийг ашиглах бол Тохиргоо → Багц, төлбөр."
      />
    );
  const allowed = keys.some((key) => levels[key] !== "none");
  if (!allowed) return <AccessDenied />;
  // SIM2-047: эрхийн түвшин client-д — бичих товчнууд урьдчилан идэвхгүй.
  return <ModuleAccessProvider levels={levels}>{children}</ModuleAccessProvider>;
}

/** Role-ийн guard — admin+ хуудсууд (Удирдлага, Хэрэглэгчдийн эрх). */
export async function RoleGuard({
  minRole,
  children,
}: {
  minRole: MembershipRole;
  children: ReactNode;
}) {
  const { role } = await getActiveOrg();
  if (!roleAtLeast(role, minRole))
    return (
      <AccessDenied
        title="Энэ хэсэг зөвхөн байгууллагын админд нээлттэй"
        description="Гишүүд, урилга, эрхийн тохиргоог эзэмшигч эсвэл админ удирдана."
      />
    );
  return <>{children}</>;
}
