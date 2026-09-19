"use client";

// Мэдэгдлийн тохиргоо — категори × суваг матриц (in-app Switch, и-мэйл
// горим select, нэмэлт сувгууд Switch), нэгтгэлийн цаг, «Түр дуугүй»,
// Telegram холболт. Зөвхөн бэлэн ui-kit: Switch, Button, Label, Separator,
// Icon, StatusBadge, `.ea-form-select`.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  saveNotificationPreferences,
  type NotificationPreferencesData,
} from "@/lib/actions/notification-preferences";
import {
  startTelegramLink,
  unlinkTelegram,
  verifyTelegramLink,
  type TelegramLinkStatus,
} from "@/lib/actions/telegram-link";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_CATEGORY_LABELS,
  type EmailMode,
  type NotificationCategory,
} from "@/lib/notifications/catalog";
import type { ChannelPrefs } from "@/lib/notifications/preferences";

const EMAIL_MODE_LABELS: Record<EmailMode, string> = {
  off: "Илгээхгүй",
  instant: "Шууд",
  digest: "Өдрийн нэгтгэл",
};

const MUTE_OPTIONS: { value: string; label: string; hours: number | null }[] = [
  { value: "off", label: "Мэдэгдэл асаалттай", hours: null },
  { value: "1h", label: "1 цаг дуугүй", hours: 1 },
  { value: "today", label: "Өнөөдөр дуугүй", hours: 24 },
  { value: "week", label: "7 хоног дуугүй", hours: 24 * 7 },
];

const CATEGORY_HINT: Record<NotificationCategory, string> = {
  documents: "Миний ноорог батлагдсан, буцаалт, хуучирсан ноорог, цалингийн журнал",
  deadlines: "Татварын хугацаа (НӨАТ, НДШ, ХАОАТ, ААНОАТ), хэтэрсэн авлага/өглөг",
  close: "Сар хаалт хийх цаг, тайлант үе хаагдсан/дахин нээгдсэн",
  team: "Миний эрх өөрчлөгдсөн",
  security: "Лиценз, API token дуусах",
  procurement: "Захиалга батлагдсан/хаагдсан, хүлээн авалт",
};

/** Категорийн default (каталогийн төрлүүдээс): олонх нь ямар горимтой вэ. */
function categoryDefault(category: NotificationCategory): { inApp: boolean; email: EmailMode } {
  const defs = Object.values(NOTIFICATION_CATALOG).filter((d) => d.category === category);
  const instant = defs.some((d) => d.email === "instant");
  return { inApp: defs.every((d) => d.inApp), email: instant ? "instant" : "digest" };
}

function muteValue(mutedUntil: string | null): string {
  if (!mutedUntil || new Date(mutedUntil) <= new Date()) return "off";
  return "custom";
}

export interface ExtraChannelDef {
  key: string;
  label: string;
  defaultEnabled: boolean;
}

export function NotificationPreferencesForm({
  initial,
  telegram,
  extraChannels,
}: {
  initial: NotificationPreferencesData;
  telegram: TelegramLinkStatus;
  extraChannels: ExtraChannelDef[];
}) {
  const [channels, setChannels] = useState<ChannelPrefs>(initial.channels);
  const [tg, setTg] = useState(telegram);
  const [tgPending, startTg] = useTransition();
  const [digestHour, setDigestHour] = useState(initial.digestHour);
  const [mute, setMute] = useState(muteValue(initial.mutedUntil));
  const [isPending, startTransition] = useTransition();

  const categories = Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[];

  function effective(category: NotificationCategory) {
    const def = categoryDefault(category);
    return {
      inApp: channels[category]?.inApp ?? def.inApp,
      email: channels[category]?.email ?? def.email,
    };
  }

  function setPref(category: NotificationCategory, patch: Partial<{ inApp: boolean; email: EmailMode }>) {
    setChannels((current) => ({
      ...current,
      [category]: { ...current[category], ...patch },
    }));
  }

  function extraEnabled(category: NotificationCategory, channel: ExtraChannelDef) {
    return channels[category]?.channels?.[channel.key] ?? channel.defaultEnabled;
  }

  function setExtra(category: NotificationCategory, key: string, enabled: boolean) {
    setChannels((current) => ({
      ...current,
      [category]: {
        ...current[category],
        channels: { ...current[category]?.channels, [key]: enabled },
      },
    }));
  }

  function tgStart() {
    startTg(async () => {
      try {
        const result = await startTelegramLink();
        if (result.error !== undefined) {
          toast.error(result.error);
          return;
        }
        setTg((current) => ({
          ...current,
          code: result.code,
          botUsername: result.botUsername,
        }));
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : "Код үүсгэж чадсангүй");
      }
    });
  }

  function tgVerify() {
    startTg(async () => {
      try {
        const result = await verifyTelegramLink();
        if (result.error !== undefined) {
          toast.error(result.error);
          return;
        }
        if (result.linked) {
          setTg((current) => ({ ...current, linked: true, code: null }));
          toast.success("Telegram холбогдлоо");
        } else
          toast.error("Код bot-д ирээгүй байна — /start <код> илгээгээд дахин шалгана уу");
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : "Шалгаж чадсангүй");
      }
    });
  }

  function tgUnlink() {
    startTg(async () => {
      try {
        await unlinkTelegram();
        setTg((current) => ({ ...current, linked: false, code: null }));
        toast.success("Telegram салгагдлаа");
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : "Салгаж чадсангүй");
      }
    });
  }

  function save() {
    startTransition(async () => {
      try {
        let mutedUntil: string | null = null;
        if (mute === "custom") mutedUntil = initial.mutedUntil;
        else {
          const option = MUTE_OPTIONS.find((o) => o.value === mute);
          if (option?.hours)
            mutedUntil = new Date(Date.now() + option.hours * 3_600_000).toISOString();
        }
        const r = await saveNotificationPreferences({
          channels,
          digestHour,
          mutedUntil,
        });
        if (r.error !== undefined) {
          toast.error(r.error);
          return;
        }
        toast.success("Мэдэгдлийн тохиргоо хадгалагдлаа");
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : "Хадгалах амжилтгүй");
      }
    });
  }

  const muted = mute !== "off";
  const gridColumns = `minmax(0,1fr) 88px 160px${extraChannels.map(() => " 96px").join("")}`;

  return (
    <div className="max-w-3xl space-y-6">
      <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
              <Icon name="bell" size="sm" className="text-[var(--ea-text-3)]" />
              Мэдэгдлийн суваг
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
              Ангилал бүрд програм доторх хонх болон и-мэйлийн горимоо сонгоно.
              И-мэйл: <span className="font-mono">{initial.email || "—"}</span>
            </p>
          </div>
          {!initial.emailConfigured && (
            <StatusBadge tone="warning" size="sm">
              И-мэйл серверт тохируулагдаагүй
            </StatusBadge>
          )}
        </div>

        <div className="overflow-x-auto rounded-md border border-[var(--ea-border)]">
          <div
            className="grid items-center gap-3 bg-[var(--ea-bg-2)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ea-text-3)]"
            style={{ gridTemplateColumns: gridColumns }}
          >
            <span>Ангилал</span>
            <span className="text-center">Хонх</span>
            <span>И-мэйл</span>
            {extraChannels.map((channel) => (
              <span key={channel.key} className="text-center">
                {channel.label}
              </span>
            ))}
          </div>
          {categories.map((category, index) => {
            const value = effective(category);
            return (
              <div
                key={category}
                className="grid items-center gap-3 px-3 py-2.5"
                style={{
                  gridTemplateColumns: gridColumns,
                  borderTop: index === 0 ? undefined : "1px solid var(--ea-border)",
                }}
              >
                <div className="min-w-0">
                  <div className="text-sm text-[var(--ea-text-1)]">
                    {NOTIFICATION_CATEGORY_LABELS[category]}
                  </div>
                  <div className="truncate text-[11px] text-[var(--ea-text-4)]">
                    {CATEGORY_HINT[category]}
                  </div>
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={value.inApp}
                    onCheckedChange={(checked) => setPref(category, { inApp: checked })}
                    aria-label={`${NOTIFICATION_CATEGORY_LABELS[category]} — хонх`}
                  />
                </div>
                <select
                  className="ea-form-select"
                  value={value.email}
                  disabled={!initial.emailConfigured}
                  onChange={(event) =>
                    setPref(category, { email: event.target.value as EmailMode })
                  }
                  aria-label={`${NOTIFICATION_CATEGORY_LABELS[category]} — и-мэйл`}
                >
                  {(Object.keys(EMAIL_MODE_LABELS) as EmailMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {EMAIL_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
                {extraChannels.map((channel) => (
                  <div key={channel.key} className="flex justify-center">
                    <Switch
                      checked={extraEnabled(category, channel)}
                      disabled={channel.key === "telegram" && !tg.linked}
                      onCheckedChange={(checked) => setExtra(category, channel.key, checked)}
                      aria-label={`${NOTIFICATION_CATEGORY_LABELS[category]} — ${channel.label}`}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-[var(--ea-text-4)]">
          «Шууд» — мэдэгдэл үүсмэгц (15 минутын дотор); «Өдрийн нэгтгэл» — сонгосон
          цагт нэг и-мэйлээр. Гарчигт дүн бичигдэхгүй.
        </p>
      </section>

      <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Цаг, түр дуугүй</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="digest-hour">Өдрийн нэгтгэл илгээх цаг</Label>
            <select
              id="digest-hour"
              className="ea-form-select"
              value={digestHour}
              onChange={(event) => setDigestHour(Number(event.target.value))}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}:00 (Улаанбаатар)
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mute">Түр дуугүй</Label>
            <select
              id="mute"
              className="ea-form-select"
              value={mute}
              onChange={(event) => setMute(event.target.value)}
            >
              {mute === "custom" && (
                <option value="custom">
                  Дуугүй — {new Date(initial.mutedUntil!).toLocaleString("sv-SE", {
                    timeZone: "Asia/Ulaanbaatar",
                  })} хүртэл
                </option>
              )}
              {MUTE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {muted && (
              <p className="text-[11px] text-[var(--ea-warning-fg)]">
                Дуугүй үед мэдэгдэл ҮҮСЭХГҮЙ (дараа нь нөхөгдөхгүй).
              </p>
            )}
          </div>
        </div>
      </section>

      {tg.configured && (
        <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
                <Icon name="send" size="sm" className="text-[var(--ea-text-3)]" />
                Telegram
              </h2>
              <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
                Мэдэгдлийг Telegram-аар авах. Bot-той чатаа нэг удаа холбоно —
                дараа нь дээрх матрицын «Telegram» багана ажиллана.
              </p>
            </div>
            <StatusBadge tone={tg.linked ? "success" : "muted"} size="sm">
              {tg.linked ? "Холбогдсон" : "Холбогдоогүй"}
            </StatusBadge>
          </div>
          {tg.linked ? (
            <Button variant="outline" size="sm" onClick={tgUnlink} disabled={tgPending}>
              Салгах
            </Button>
          ) : tg.code ? (
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-5 text-xs text-[var(--ea-text-2)]">
                <li>
                  Telegram дээр{" "}
                  {tg.botUsername ? (
                    <a
                      href={`https://t.me/${tg.botUsername}?start=${tg.code}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--ea-interactive)] underline"
                    >
                      @{tg.botUsername}
                    </a>
                  ) : (
                    "bot"
                  )}{" "}
                  руу орж <span className="font-mono font-semibold">/start {tg.code}</span> гэж
                  илгээнэ (линк дээр дарвал автоматаар бөглөгдөнө).
                </li>
                <li>Дараа нь доорх «Холболт шалгах» товчийг дарна.</li>
              </ol>
              <div className="flex gap-2">
                <Button size="sm" onClick={tgVerify} disabled={tgPending}>
                  Холболт шалгах
                </Button>
                <Button variant="ghost" size="sm" onClick={tgStart} disabled={tgPending}>
                  Шинэ код
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={tgStart} disabled={tgPending}>
              Telegram холбох
            </Button>
          )}
        </section>
      )}

      <Separator />
      <div className="flex justify-end">
        <Button onClick={save} disabled={isPending}>
          {isPending ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
      </div>
    </div>
  );
}
