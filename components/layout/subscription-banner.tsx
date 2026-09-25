// Багцын баннер — топбарын доор (server component). Trial/grace ≤ 7 хоног
// эсвэл read-only үед л гарна; dedicated горимд хэзээ ч гарахгүй.
import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { hasFeature, READ_ONLY_MESSAGES, type Entitlements } from "@/lib/billing/entitlements";

const ALERT_DAYS = 7;

export function SubscriptionBanner({ entitlements: ent }: { entitlements: Entitlements }) {
  if (ent.mode === "dedicated") return null;
  // «AI нягтлан» (skills) — төлөв, сунгалт нүүрний хуудсанд ил; «бичилт хаагдана»
  // гэсэн нягтлан бодох системийн баннер энэ багцад хамаарахгүй.
  if (!hasFeature(ent, "accounting")) return null;
  let text: string | null = null;
  let danger = false;
  if (ent.readOnlyReason) {
    text = READ_ONLY_MESSAGES[ent.readOnlyReason];
    danger = true;
  } else if (ent.daysLeft !== null && ent.daysLeft <= ALERT_DAYS) {
    const what = ent.status === "trialing" ? "Туршилтын хугацаа" : "Төлбөрийн хоцрогдлын хугацаа";
    text = `${what} ${ent.daysLeft === 0 ? "өнөөдөр" : `${ent.daysLeft} хоногийн дараа`} дуусна — дараа нь бичилт хаагдана (унших, тайлан хэвээр).`;
    danger = ent.daysLeft <= 1;
  }
  if (!text) return null;
  const tone = danger ? "var(--ea-danger)" : "var(--ea-warning)";
  const fg = danger ? "var(--ea-danger-fg)" : "var(--ea-warning-fg)";
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs md:px-6"
      style={{
        borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`,
        background: `color-mix(in srgb, ${tone} 8%, var(--ea-surface))`,
        color: "var(--ea-text-2)",
      }}
    >
      <Icon name={danger ? "error" : "warning"} size="sm" style={{ color: fg }} />
      <span className="min-w-0 flex-1">{text}</span>
      <Link href="/settings/billing" className="font-medium" style={{ color: "var(--ea-primary)" }}>
        Багц, төлбөр →
      </Link>
    </div>
  );
}
