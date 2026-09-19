// Хэрэглэгчийн мэдэгдлийн тохиргооны ЦЭВЭР тайлбар (тесттэй, client-safe).
// notification_preferences.channels нь JSON текст: category → { inApp, email }.
// Мөр/талбар байхгүй бол каталогийн default. Танигдахгүй утга fail-safe
// (default руу) — lib/permissions.ts parsePermissions-тэй ижил зарчим.

import {
  NOTIFICATION_CATALOG,
  type EmailMode,
  type NotificationCategory,
  type NotificationType,
} from "./catalog";

export interface CategoryChannelPref {
  inApp: boolean;
  email: EmailMode;
}

export type ChannelPrefs = Partial<Record<NotificationCategory, Partial<CategoryChannelPref>>>;

const EMAIL_MODES: EmailMode[] = ["off", "instant", "digest"];

export function parseChannelPrefs(raw: string | null | undefined): ChannelPrefs {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ChannelPrefs = {};
    for (const [category, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const pref: Partial<CategoryChannelPref> = {};
      const inApp = (value as { inApp?: unknown }).inApp;
      const email = (value as { email?: unknown }).email;
      if (typeof inApp === "boolean") pref.inApp = inApp;
      if (typeof email === "string" && EMAIL_MODES.includes(email as EmailMode))
        pref.email = email as EmailMode;
      out[category as NotificationCategory] = pref;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeChannelPrefs(prefs: ChannelPrefs): string {
  return JSON.stringify(prefs);
}

/** Тухайн төрөл in-app-д харагдах уу — тохиргоо → каталог default. */
export function isInAppEnabled(prefs: ChannelPrefs, type: NotificationType): boolean {
  const def = NOTIFICATION_CATALOG[type];
  return prefs[def.category]?.inApp ?? def.inApp;
}

/** Тухайн төрлийн и-мэйл горим — тохиргоо → каталог default (фаз 1). */
export function emailModeFor(prefs: ChannelPrefs, type: NotificationType): EmailMode {
  const def = NOTIFICATION_CATALOG[type];
  return prefs[def.category]?.email ?? def.email;
}
