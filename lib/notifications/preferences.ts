// Хэрэглэгчийн мэдэгдлийн тохиргооны ЦЭВЭР тайлбар (тесттэй, client-safe).
// notification_preferences.channels нь JSON текст:
//   category → { inApp: boolean, email: "off"|"instant"|"digest", <суваг>: boolean }
// <суваг> = telegram эсвэл custom/ багцын сувгийн түлхүүр (фаз 2).
// Мөр/талбар байхгүй бол каталогийн (эсвэл сувгийн) default. Танигдахгүй утга
// fail-safe (default руу) — lib/permissions.ts parsePermissions-тэй ижил зарчим.

import {
  NOTIFICATION_CATALOG,
  type EmailMode,
  type NotificationCategory,
  type NotificationType,
} from "./catalog";

export interface CategoryChannelPref {
  inApp: boolean;
  email: EmailMode;
  /** Нэмэлт сувгууд (telegram, custom) — түлхүүр → асаалттай эсэх. */
  channels: Record<string, boolean>;
}

export type ChannelPrefs = Partial<
  Record<NotificationCategory, Partial<Omit<CategoryChannelPref, "channels">> & { channels?: Record<string, boolean> }>
>;

const EMAIL_MODES: EmailMode[] = ["off", "instant", "digest"];
const RESERVED_KEYS = new Set(["inApp", "email"]);
const CHANNEL_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;

export function parseChannelPrefs(raw: string | null | undefined): ChannelPrefs {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ChannelPrefs = {};
    for (const [category, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const pref: NonNullable<ChannelPrefs[NotificationCategory]> = {};
      const record = value as Record<string, unknown>;
      if (typeof record.inApp === "boolean") pref.inApp = record.inApp;
      if (typeof record.email === "string" && EMAIL_MODES.includes(record.email as EmailMode))
        pref.email = record.email as EmailMode;
      for (const [key, flag] of Object.entries(record)) {
        if (RESERVED_KEYS.has(key) || typeof flag !== "boolean" || !CHANNEL_KEY_RE.test(key))
          continue;
        (pref.channels ??= {})[key] = flag;
      }
      out[category as NotificationCategory] = pref;
    }
    return out;
  } catch {
    return {};
  }
}

/** JSON — нэмэлт сувгууд inApp/email-тэй нэг түвшинд хавтгайрна. */
export function serializeChannelPrefs(prefs: ChannelPrefs): string {
  const flat: Record<string, Record<string, unknown>> = {};
  for (const [category, pref] of Object.entries(prefs)) {
    if (!pref) continue;
    const { channels, ...rest } = pref;
    flat[category] = { ...rest, ...(channels ?? {}) };
  }
  return JSON.stringify(flat);
}

/** Тухайн төрөл in-app-д харагдах уу — тохиргоо → каталог default. */
export function isInAppEnabled(prefs: ChannelPrefs, type: NotificationType): boolean {
  const def = NOTIFICATION_CATALOG[type];
  return prefs[def.category]?.inApp ?? def.inApp;
}

/** Тухайн төрлийн и-мэйл горим — тохиргоо → каталог default. */
export function emailModeFor(prefs: ChannelPrefs, type: NotificationType): EmailMode {
  const def = NOTIFICATION_CATALOG[type];
  return prefs[def.category]?.email ?? def.email;
}

/** Нэмэлт суваг (telegram, custom) тухайн төрөлд асаалттай юу — тохиргоо → сувгийн default. */
export function isChannelEnabled(
  prefs: ChannelPrefs,
  type: NotificationType,
  channelKey: string,
  defaultEnabled: boolean
): boolean {
  const def = NOTIFICATION_CATALOG[type];
  return prefs[def.category]?.channels?.[channelKey] ?? defaultEnabled;
}
