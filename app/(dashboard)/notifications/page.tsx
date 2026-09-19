// Мэдэгдлийн inbox — өөрийн (хэрэглэгч × идэвхтэй байгууллага) сүүлийн 200
// мэдэгдэл. Топбарын хонхноос орно (модулийн цэс биш).

import { NotificationList } from "@/components/notifications/notification-list";
import { listNotifications } from "@/lib/actions/notifications";

export const metadata = { title: "Мэдэгдэл — Entry Accounting" };

export default async function NotificationsPage() {
  const { rows } = await listNotifications({ limit: 200 });
  return <NotificationList initialRows={rows} />;
}
