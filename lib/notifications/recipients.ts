// Хүлээн авагчийн ЦЭВЭР шүүлт (тесттэй) — гишүүд × audience → userId[].
// Эрхийн логик lib/permissions.ts-тэй НЭГ: owner/admin үргэлж бүрэн,
// "none" болгосон модулийн мэдэгдэл очихгүй (навигациас нуугдсан модулийн
// шуугиан үгүй). Actor хасагдана — өөрийн үйлдлээ өөртөө мэдэгдэхгүй.

import { hasModuleLevel } from "@/lib/permissions";

import type { MemberLike, NotificationAudience } from "./types";

export function selectRecipients(
  members: MemberLike[],
  audience: NotificationAudience,
  excludeUserId?: string | null
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (userId: string) => {
    if (excludeUserId && userId === excludeUserId) return;
    if (seen.has(userId)) return;
    seen.add(userId);
    out.push(userId);
  };

  switch (audience.kind) {
    case "everyone":
      for (const member of members) push(member.userId);
      break;
    case "roles": {
      const roles = new Set(audience.roles);
      for (const member of members) if (roles.has(member.role)) push(member.userId);
      break;
    }
    case "users": {
      const byId = new Map(members.map((member) => [member.userId, member]));
      for (const userId of audience.userIds) if (byId.has(userId)) push(userId);
      break;
    }
    case "module":
      for (const member of members) {
        const allowed = audience.moduleKeys.some((moduleKey) =>
          hasModuleLevel(member.role, member.permissions, moduleKey, audience.minLevel)
        );
        if (allowed) push(member.userId);
      }
      break;
    case "entity-owner":
      // DB гүүр (bridge.ts) энэ audience-ийг users болгож шийдсэн байх ёстой;
      // шийдэгдээгүй ирвэл хэнд ч очихгүй (таамаглахгүй).
      break;
  }
  return out;
}
