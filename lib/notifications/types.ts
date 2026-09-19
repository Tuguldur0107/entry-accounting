// Мэдэгдлийн нийтлэг төрлүүд — client-safe (DB import БАЙХГҮЙ).

import type { MembershipRole } from "@/lib/db/schema";

import type { NotificationSeverity, NotificationType } from "./catalog";

export type PermissionNeed = "read" | "write" | "post";

/**
 * Хэнд очих вэ — эрхээр шүүгдэнэ (lib/notifications/recipients.ts):
 *   module       — жагсаасан модулиудын АЛЬ НЭГЭНД ≥ minLevel эрхтэй гишүүд
 *   roles        — тухайн role-тэй гишүүд
 *   users        — тодорхой хэрэглэгчид (гишүүн хэвээр байгаа эсэхийг шалгана)
 *   everyone     — байгууллагын бүх гишүүн
 *   entity-owner — объектын userId (createdBy / гишүүн) — DB гүүр шийднэ
 * Actor (үйлдлийг хийсэн хүн) бүх төрөлд ХАСАГДАНА.
 */
export type NotificationAudience =
  | { kind: "module"; moduleKeys: string[]; minLevel: PermissionNeed }
  | { kind: "roles"; roles: MembershipRole[] }
  | { kind: "users"; userIds: string[] }
  | { kind: "everyone" }
  | { kind: "entity-owner" };

/** Бичигдэхээс өмнөх мэдэгдэл — дүрэм (rules/attention) үүнийг л буцаана. */
export interface NotificationDraft {
  type: NotificationType;
  /** Каталогийн default-ыг дарна (ж: хугацаа хэтэрсэн → danger). */
  severity?: NotificationSeverity;
  title: string;
  body: string;
  /** Панельгүй объектод дарахад очих зам. */
  href?: string;
  /** Панель нээх түлхүүр — аудитын entityType-тай ижил үгсийн сан. */
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  /** Дүрмийн «байгалийн үе» — (org, user, dedupeKey) давхардахгүй. */
  dedupeKey: string;
  audience: NotificationAudience;
}

/** Хүлээн авагчийг шүүхэд хэрэгтэй гишүүний хэсэг. */
export interface MemberLike {
  userId: string;
  role: MembershipRole;
  permissions: string | null;
}
