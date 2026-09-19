"use client";

// Мэдэгдлийн бүтэн жагсаалт — DataGridDynamic стандарт (CLAUDE.md хүснэгтийн
// стандарт): FilterChips (Бүгд / Уншаагүй), «Бүгдийг уншсан», давхар даралт →
// панель эсвэл href (lib/notifications/open-entity.ts).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, RowDoubleClickedEvent } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { fmtNotificationTime } from "@/components/layout/notification-bell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChips } from "@/components/ui/tabs";
import {
  markAllNotificationsRead,
  markNotificationsRead,
  type NotificationRow,
} from "@/lib/actions/notifications";
import {
  notificationCategoryLabel,
  notificationTypeLabel,
} from "@/lib/notifications/catalog";
import { openNotificationTarget } from "@/lib/notifications/open-entity";

type Filter = "all" | "unread";

const SEVERITY_LABEL: Record<NotificationRow["severity"], string> = {
  info: "Мэдээлэл",
  warning: "Анхааруулга",
  danger: "Яаралтай",
};

export function NotificationList({ initialRows }: { initialRows: NotificationRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>("all");
  const [isPending, startTransition] = useTransition();

  const unreadCount = rows.filter((row) => !row.readAt).length;
  const visible = useMemo(
    () => (filter === "unread" ? rows.filter((row) => !row.readAt) : rows),
    [rows, filter]
  );

  const columns = useMemo<ColDef<NotificationRow>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "createdAt",
        width: 130,
        cellClass: "font-mono text-xs",
        valueFormatter: (params) => fmtNotificationTime(params.value ?? ""),
      },
      {
        headerName: "Төлөв",
        field: "readAt",
        width: 100,
        valueFormatter: (params) => (params.value ? "Уншсан" : "Уншаагүй"),
        cellClass: (params) =>
          params.value ? "text-xs text-[var(--ea-text-3)]" : "text-xs font-semibold",
      },
      {
        headerName: "Түвшин",
        field: "severity",
        width: 110,
        valueFormatter: (params) =>
          SEVERITY_LABEL[(params.value as NotificationRow["severity"]) ?? "info"],
        cellClass: (params) =>
          params.value === "danger"
            ? "text-xs text-[var(--ea-danger-fg)]"
            : params.value === "warning"
              ? "text-xs text-[var(--ea-warning-fg)]"
              : "text-xs",
      },
      {
        headerName: "Ангилал",
        field: "category",
        width: 120,
        valueFormatter: (params) => notificationCategoryLabel(params.value ?? ""),
      },
      {
        headerName: "Төрөл",
        field: "type",
        width: 200,
        valueFormatter: (params) => notificationTypeLabel(params.value ?? ""),
      },
      {
        headerName: "Гарчиг",
        field: "title",
        minWidth: 240,
        flex: 1,
        cellClass: (params) => (params.data?.readAt ? "text-xs" : "text-xs font-semibold"),
      },
      {
        headerName: "Тайлбар",
        field: "body",
        minWidth: 280,
        flex: 1.4,
        cellClass: "text-xs",
      },
    ],
    []
  );

  function onRowDoubleClicked(event: RowDoubleClickedEvent<NotificationRow>) {
    const row = event.data;
    if (!row) return;
    if (!row.readAt) {
      setRows((current) =>
        current.map((r) => (r.id === row.id ? { ...r, readAt: new Date().toISOString() } : r))
      );
      void markNotificationsRead([row.id]);
    }
    openNotificationTarget(row, router);
  }

  function readAll() {
    startTransition(async () => {
      try {
        await markAllNotificationsRead();
        const now = new Date().toISOString();
        setRows((current) => current.map((r) => ({ ...r, readAt: r.readAt ?? now })));
        router.refresh();
      } catch {
        toast.error("Уншсан гэж тэмдэглэж чадсангүй");
      }
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Мэдэгдэл</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Татварын хугацаа, хуучирсан ноорог, хамт олны батлалт/буцаалт, сар хаалт —
          сүүлийн 200 мэдэгдэл. Давхар даралтаар баримт руу очно.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterChips<Filter>
          options={[
            { value: "all", label: "Бүгд", count: rows.length },
            { value: "unread", label: "Уншаагүй", count: unreadCount, tone: "warning" },
          ]}
          value={filter}
          onChange={setFilter}
        />
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={readAll} disabled={isPending}>
            Бүгдийг уншсан
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="bell"
          title={filter === "unread" ? "Уншаагүй мэдэгдэл алга" : "Мэдэгдэл алга"}
          description="Татварын хугацаа ойртох, ноорог хуучрах, хамт олон батлах/буцаах үед энд гарна."
          actions={[{ label: "Хяналтын самбар", href: "/", icon: "dashboard" }]}
        />
      ) : (
        <DataGridDynamic<NotificationRow>
          rowData={visible}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          onRowDoubleClicked={onRowDoubleClicked}
          suppressCellFocus
        />
      )}
    </section>
  );
}
