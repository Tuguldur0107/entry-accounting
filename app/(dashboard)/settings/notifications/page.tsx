import { NotificationPreferencesForm } from "@/components/notifications/notification-preferences-form";
import { getNotificationPreferences } from "@/lib/actions/notification-preferences";
import { getTelegramLinkStatus } from "@/lib/actions/telegram-link";
import { activeNotificationChannels } from "@/lib/notifications/channel-delivery";

export const metadata = { title: "Мэдэгдлийн тохиргоо — Entry Accounting" };

export default async function NotificationSettingsPage() {
  const [initial, telegram] = await Promise.all([
    getNotificationPreferences(),
    getTelegramLinkStatus(),
  ]);
  // Нэмэлт сувгууд (Telegram + custom/) — матрицын багана болно.
  const extraChannels = activeNotificationChannels().map((channel) => ({
    key: channel.key,
    label: channel.label,
    defaultEnabled: channel.defaultEnabled ?? false,
  }));
  return (
    <NotificationPreferencesForm
      initial={initial}
      telegram={telegram}
      extraChannels={extraChannels}
    />
  );
}
