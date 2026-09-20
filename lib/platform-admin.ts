// Platform admin — Entry-ийн ажилтан, SaaS үндсэн сервис дээр бүх байгууллагын
// багц/subscription-ыг удирдана. Env `ENTRY_PLATFORM_ADMIN_EMAILS` (таслалаар,
// case-insensitive); ЗӨВХӨН saas горимд (dedicated deploy-д platform admin байхгүй —
// харилцагч өөрөө эзэн). Байгууллагын owner/admin-тай ХОЛИЛДОХГҮЙ тусдаа эрх.

import { deploymentMode } from "@/lib/deployment-mode";

export function platformAdminEmails(env: { ENTRY_PLATFORM_ADMIN_EMAILS?: string } = process.env as { ENTRY_PLATFORM_ADMIN_EMAILS?: string }): string[] {
  return (env.ENTRY_PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdminEmail(
  email: string | null | undefined,
  env?: { ENTRY_PLATFORM_ADMIN_EMAILS?: string; ENTRY_DEPLOYMENT_MODE?: string }
): boolean {
  if (!email) return false;
  if (deploymentMode(env) !== "saas") return false;
  return platformAdminEmails(env).includes(email.trim().toLowerCase());
}
