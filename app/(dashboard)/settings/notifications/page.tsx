import { NotificationPreferencesForm } from "@/components/notifications/notification-preferences-form";
import { getNotificationPreferences } from "@/lib/actions/notification-preferences";

export const metadata = { title: "Мэдэгдлийн тохиргоо — Entry Accounting" };

export default async function NotificationSettingsPage() {
  const initial = await getNotificationPreferences();
  return <NotificationPreferencesForm initial={initial} />;
}
