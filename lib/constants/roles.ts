// Гишүүнчлэлийн ролийн UI шошго — НЭГ эх сурвалж (өмнө нь Байгууллага,
// Хэрэглэгчдийн эрх хоёр файлд давхар зарлагдаж байсан).

import type { MembershipRole } from "@/lib/db/schema";

export const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Эзэмшигч",
  admin: "Админ",
  accountant: "Нягтлан",
  viewer: "Үзэгч",
};

/** Урилгаар олгож болох ролиуд — эзэмшигч зөвхөн үүсгэлтээр тодорно. */
export const INVITABLE_ROLES: MembershipRole[] = [
  "admin",
  "accountant",
  "viewer",
];
