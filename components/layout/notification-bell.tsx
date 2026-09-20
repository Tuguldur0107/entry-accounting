"use client";

// Топбарын хонх — уншаагүй тоо + сүүлийн мэдэгдлүүдийн dropdown.
// Тоолуур server-ээс анхны утгаа авч, 60 сек тутам + цонх фокуслоход
// шинэчлэгдэнэ (SSE хожим — docs/notifications §4.4). Дарахад уншсан гэж
// тэмдэглээд панель/href руу очно (lib/notifications/open-entity.ts).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Dropdown, DropdownSeparator } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type NotificationRow,
} from "@/lib/actions/notifications";
import { openNotificationTarget } from "@/lib/notifications/open-entity";
import { feedback } from "@/lib/ui/feedback";
import { cn } from "@/lib/utils";

const POLL_MS = 60 * 1000;
const PREVIEW_LIMIT = 10;

const TS_FORMAT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ulaanbaatar",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function fmtNotificationTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : TS_FORMAT.format(date);
}

export function severityClass(severity: NotificationRow["severity"]): string {
  return severity === "danger"
    ? "text-[var(--ea-danger-fg)]"
    : severity === "warning"
      ? "text-[var(--ea-warning-fg)]"
      : "text-[var(--ea-text-4)]";
}

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Polling-ийн хооронд шинэ мэдэгдэл ирвэл toast + зөөлөн дуу (ea-sound
  // toggle хүндэтгэнэ) — хамгийн сүүлийн уншаагүйг л харуулна.
  const knownUnread = useRef(initialUnread);
  const refreshCount = useCallback(async () => {
    try {
      const next = await getUnreadNotificationCount();
      setUnread(next);
      if (next > knownUnread.current) {
        const { rows: latest } = await listNotifications({ limit: 1, unreadOnly: true });
        const row = latest[0];
        if (row) {
          feedback.saved();
          toast(row.title, {
            description: row.body || undefined,
            action: { label: "Нээх", onClick: () => openNotificationTarget(row, router) },
          });
        }
      }
      knownUnread.current = next;
    } catch {
      /* сүлжээ/сесс — дараагийн удаа */
    }
  }, [router]);

  useEffect(() => {
    const timer = setInterval(() => void refreshCount(), POLL_MS);
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCount]);

  // Нээхэд л жагсаалтаа ачаална (effect дотор setState хийхгүй).
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listNotifications({ limit: PREVIEW_LIMIT });
      setRows(result.rows);
      setUnread(result.unread);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  async function openRow(row: NotificationRow) {
    setOpen(false);
    if (!row.readAt) {
      setUnread((n) => Math.max(0, n - 1));
      knownUnread.current = Math.max(0, knownUnread.current - 1);
      void markNotificationsRead([row.id]);
    }
    openNotificationTarget(row, router);
  }

  async function readAll() {
    setUnread(0);
    knownUnread.current = 0;
    setRows((current) =>
      current?.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })) ?? null
    );
    await markAllNotificationsRead();
  }

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      panelClassName="w-80 p-0"
      trigger={
        <span className="relative inline-flex">
          <IconAction
            name="bell"
            label={unread > 0 ? `Мэдэгдэл — ${unread} уншаагүй` : "Мэдэгдэл"}
            tooltip="Мэдэгдэл"
            size="lg"
            variant="outline"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              const next = !open;
              setOpen(next);
              if (next) void load();
            }}
          />
          {unread > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold"
              style={{ background: "var(--ea-danger)", color: "var(--primary-foreground)" }}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
      }
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold text-[var(--ea-text-1)]">Мэдэгдэл</span>
        <span className="flex items-center gap-2">
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void readAll()}
              className="text-[11px] text-[var(--ea-interactive)] hover:underline"
            >
              Бүгдийг уншсан
            </button>
          )}
          <Link
            href="/settings/notifications"
            onClick={() => setOpen(false)}
            title="Мэдэгдлийн тохиргоо"
            aria-label="Мэдэгдлийн тохиргоо"
            className="text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)]"
          >
            <Icon name="settings" size="sm" />
          </Link>
        </span>
      </div>
      <DropdownSeparator />
      <div className="max-h-96 overflow-y-auto">
        {rows === null || loading ? (
          <div className="px-3 py-6 text-center text-xs text-[var(--ea-text-3)]">
            Уншиж байна…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[var(--ea-text-3)]">
            Мэдэгдэл алга — анхаарах зүйл байхгүй.
          </div>
        ) : (
          <ul className="flex flex-col py-1">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void openRow(row)}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-[var(--ea-hover-subtle)]",
                    !row.readAt && "bg-[var(--ea-selected-bg)]"
                  )}
                >
                  <span className={cn("mt-0.5 shrink-0", severityClass(row.severity))}>
                    <Icon name={row.severity === "info" ? "info" : "warning"} size="sm" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-xs text-[var(--ea-text-1)]",
                        !row.readAt && "font-semibold"
                      )}
                    >
                      {row.title}
                    </span>
                    {row.body && (
                      <span className="block truncate text-[11px] text-[var(--ea-text-3)]">
                        {row.body}
                      </span>
                    )}
                    <span className="block font-mono text-[10px] text-[var(--ea-text-4)]">
                      {fmtNotificationTime(row.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <DropdownSeparator />
      <Link
        href="/notifications"
        onClick={() => setOpen(false)}
        className="block px-3 py-2 text-center text-xs text-[var(--ea-interactive)] hover:underline"
      >
        Бүгдийг харах
      </Link>
    </Dropdown>
  );
}
