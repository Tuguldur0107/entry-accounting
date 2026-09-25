// Платформын (Entry Console) байгууллага БҮРМӨСӨН устгах цөм — "use server" БИШ.
// Дуудагч: app/api/platform/organizations DELETE (Bearer ENTRY_PLATFORM_API_KEY).
//
// Апп доторх устгалт (lib/actions/org.ts deleteOrganization — эзэн өөрөө) болон
// энэ зам хоёул `purgeOrganization` (lib/org/purge.ts — RESTRICT FK-уудыг ил
// дарааллаар, НЭГ транзакц) ашиглана. Console нь туршилтын / хаагдсан
// байгууллагыг цэвэрлэхэд хэрэглэнэ: баталгаажуулалт = байгууллагын НЭР эсвэл ID
// яг таарах ёстой (санамсаргүй устгалтаас сэргийлнэ).
//
// Гишүүдийн хэрэглэгчийн бүртгэл: сонголтоор — өөр байгууллагад гишүүн БИШ
// (өнчин) хэрэглэгчийг л устгана. Бусад байгууллагад гишүүн хэрэглэгч хэвээр.

import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { memberships, organizations, users } from "@/lib/db/schema";
import { purgeOrganization } from "@/lib/org/purge";

export type PlatformOrgPurgeResult = {
  organizationId: string;
  orgName: string;
  /** Байгууллагад байсан гишүүний тоо. */
  memberCount: number;
  /** Өнчин болсон тул устгасан хэрэглэгчийн тоо (purgeOrphanUsers=false бол 0). */
  deletedUsers: number;
  /** Устгаж чадаагүй хэрэглэгч (FK RESTRICT г.м.) — бүртгэл нь үлдэнэ. */
  keptUsers: number;
};

/** Баталгаажуулах текст байгууллагатай таарах уу — ЦЭВЭР (нэр эсвэл ID, зай/том жижиг үсэг үл харгалзан). */
export function purgeConfirmationMatches(
  confirm: string,
  org: { id: string; name: string }
): boolean {
  const normalized = confirm.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  return normalized === org.id.toLowerCase() || normalized === org.name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function purgeOrganizationFromPlatform(input: {
  organizationId: string;
  confirm: string;
  purgeOrphanUsers: boolean;
  actor: string;
}): Promise<PlatformOrgPurgeResult | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, input.organizationId),
    columns: { id: true, name: true },
  });
  if (!org) return null;
  if (!purgeConfirmationMatches(input.confirm, org))
    throw new Error(`Баталгаажуулах нэр таарахгүй — «${org.name}» гэж яг бичнэ`);

  const members = await db.query.memberships.findMany({
    where: eq(memberships.organizationId, org.id),
    columns: { userId: true },
  });
  const memberIds = [...new Set(members.map((row) => row.userId))];

  await purgeOrganization(org.id);

  let deletedUsers = 0;
  let keptUsers = 0;
  if (input.purgeOrphanUsers && memberIds.length) {
    const remaining = await db.query.memberships.findMany({
      where: inArray(memberships.userId, memberIds),
      columns: { userId: true },
    });
    const stillMember = new Set(remaining.map((row) => row.userId));
    for (const userId of memberIds) {
      if (stillMember.has(userId)) continue;
      try {
        await db.delete(users).where(eq(users.id, userId));
        deletedUsers++;
      } catch (caught) {
        // Өөр байгууллагын бичилтэд RESTRICT-ээр заагдсан хэрэглэгч (ээлж
        // нээсэн кассчин г.м.) — бүртгэл нь үлдэнэ, устгалт зогсохгүй.
        keptUsers++;
        console.warn(
          `[platform-purge] хэрэглэгч ${userId} устгагдсангүй: ${caught instanceof Error ? caught.message : String(caught)}`
        );
      }
    }
  }
  // Байгууллага устсан тул аудитын мөр бичих газаргүй — серверийн лог л.
  console.warn(
    `[platform-purge] ${input.actor} байгууллага устгав: "${org.name}" (${org.id}) — гишүүн ${memberIds.length}, устгасан хэрэглэгч ${deletedUsers}, үлдсэн ${keptUsers}`
  );
  return { organizationId: org.id, orgName: org.name, memberCount: memberIds.length, deletedUsers, keptUsers };
}
