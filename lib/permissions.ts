// Гишүүний модулийн эрхийн ЦЭВЭР логик (тесттэй, client-safe).
//
// Түвшин: none < read < write < post
//   none  — модуль огт харагдахгүй (навигациас нуугдана, үйлдэл хаагдана)
//   read  — хуудас, тайлан харна
//   write — ноорог баримт үүсгэж засна
//   post  — батлах / буцаах / устгах (бүрэн)
//
// Хадгалалт: memberships.permissions (JSON текст, moduleKey → level).
// owner/admin ҮРГЭЛЖ бүрэн эрхтэй — override үйлчлэхгүй (админ өөрийгөө
// түгжихээс сэргийлнэ); accountant/viewer-т role-ийн default дээр
// модуль бүрээр нарийн тохируулна.

import type { MembershipRole } from "@/lib/db/schema";

export type PermissionLevel = "none" | "read" | "write" | "post";

export const PERMISSION_LEVELS: PermissionLevel[] = [
  "none",
  "read",
  "write",
  "post",
];

export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
  none: "Байхгүй",
  read: "Унших",
  write: "Бичих",
  post: "Батлах",
};

export const PERMISSION_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  post: 3,
};

/** moduleKey (lib/constants/app-modules.ts) → түвшин. */
export type ModulePermissions = Record<string, PermissionLevel>;

function isLevel(value: unknown): value is PermissionLevel {
  return (
    typeof value === "string" &&
    (PERMISSION_LEVELS as string[]).includes(value)
  );
}

/** Role-ийн default түвшин — override байхгүй модульд үйлчилнэ. */
export function defaultLevelForRole(role: MembershipRole): PermissionLevel {
  // accountant — одоогийн зан төлөвтэй ижил (бүх модульд бичиж батална);
  // viewer — зөвхөн унших.
  if (role === "viewer") return "read";
  return "post";
}

/** DB-ийн JSON текстийг задлана — танигдахгүй утгыг хаяна (fail-safe). */
export function parsePermissions(
  raw: string | null | undefined
): ModulePermissions {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const result: ModulePermissions = {};
    for (const [key, value] of Object.entries(parsed))
      if (isLevel(value)) result[key] = value;
    return result;
  } catch {
    return {};
  }
}

export function serializePermissions(permissions: ModulePermissions): string {
  return JSON.stringify(permissions);
}

/** Гишүүний тухайн модульд эдлэх БОДИТ түвшин. */
export function effectiveLevel(
  role: MembershipRole,
  rawPermissions: string | null | undefined,
  moduleKey: string
): PermissionLevel {
  if (role === "owner" || role === "admin") return "post";
  const overrides = parsePermissions(rawPermissions);
  return overrides[moduleKey] ?? defaultLevelForRole(role);
}

/** Шаардлагатай түвшинд хүрч буй эсэх. */
export function hasModuleLevel(
  role: MembershipRole,
  rawPermissions: string | null | undefined,
  moduleKey: string,
  needed: Exclude<PermissionLevel, "none">
): boolean {
  return (
    PERMISSION_RANK[effectiveLevel(role, rawPermissions, moduleKey)] >=
    PERMISSION_RANK[needed]
  );
}

/** Гишүүнд огт харагдахгүй ("none") модулиудын түлхүүрүүд. */
export function hiddenModuleKeys(
  role: MembershipRole,
  rawPermissions: string | null | undefined,
  moduleKeys: string[]
): string[] {
  return moduleKeys.filter(
    (key) => effectiveLevel(role, rawPermissions, key) === "none"
  );
}
