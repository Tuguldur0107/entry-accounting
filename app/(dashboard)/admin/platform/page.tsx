import { AccessDenied } from "@/components/layout/access-guard";
import { PlatformSubscriptionsView } from "@/components/settings/platform-subscriptions-view";
import { listPlatformSubscriptions } from "@/lib/actions/billing";
import { auth } from "@/lib/auth";
import { isPlatformAdminEmail } from "@/lib/platform-admin";

export const metadata = { title: "Платформ: багцууд — Entry Accounting" };
export const dynamic = "force-dynamic";

// Platform admin (ENTRY_PLATFORM_ADMIN_EMAILS, зөвхөн saas горим) — бүх
// байгууллагын subscription. Байгууллагын owner/admin эрхтэй ХОЛИЛДОХГҮЙ:
// admin layout (RoleGuard) + энд тусдаа platform шалгалт.
export default async function PlatformPage() {
  const session = await auth();
  if (!isPlatformAdminEmail(session?.user?.email))
    return (
      <AccessDenied
        title="Платформын удирдлага зөвхөн Entry-ийн ажилтанд"
        description="ENTRY_PLATFORM_ADMIN_EMAILS-д бүртгэлтэй и-мэйл, saas горимд л нээгдэнэ."
      />
    );
  const result = await listPlatformSubscriptions();
  if (result.error || !result.rows) return <AccessDenied title={result.error ?? "Жагсаалт ачаалагдсангүй"} />;
  return <PlatformSubscriptionsView rows={result.rows} />;
}
