"use client";

// Платформ: багцууд — platform admin-ы бүх байгууллагын subscription жагсаалт
// (DataGridDynamic) + давхар даралт → засах диалог (FormField, ui-kit).
// docs/billing/00-proposal.md §5.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams, RowDoubleClickedEvent } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { savePlatformSubscription, type PlatformSubscriptionRow } from "@/lib/actions/billing";
import {
  PLAN_IDS,
  PLAN_LABELS,
  STATUS_LABELS,
  type PlanId,
  type SubscriptionStatus,
} from "@/lib/billing/plans";

const STATUS_TONE: Record<SubscriptionStatus, StatusTone> = {
  trialing: "warning",
  active: "success",
  past_due: "warning",
  suspended: "danger",
  cancelled: "muted",
};
const STATUSES: SubscriptionStatus[] = ["trialing", "active", "past_due", "suspended", "cancelled"];
const EDITABLE_PLANS = PLAN_IDS.filter((id) => id !== "dedicated");

type Draft = {
  planId: PlanId;
  status: SubscriptionStatus;
  seats: string;
  trialEndsAt: string;
  currentPeriodEnd: string;
  overridesJson: string;
  note: string;
};

export function PlatformSubscriptionsView({ rows }: { rows: PlatformSubscriptionRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PlatformSubscriptionRow | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();

  function open(row: PlatformSubscriptionRow) {
    setEditing(row);
    setDraft({
      planId: row.planId === "dedicated" ? "standard" : row.planId,
      status: row.status,
      seats: row.seats?.toString() ?? "",
      trialEndsAt: row.trialEndsAt ?? "",
      currentPeriodEnd: row.currentPeriodEnd ?? "",
      overridesJson: row.overridesJson,
      note: row.note ?? "",
    });
  }

  function save() {
    if (!editing || !draft) return;
    startTransition(async () => {
      const res = await savePlatformSubscription({
        organizationId: editing.organizationId,
        planId: draft.planId,
        status: draft.status,
        seats: draft.seats.trim() ? Number(draft.seats) : null,
        trialEndsAt: draft.trialEndsAt || null,
        currentPeriodEnd: draft.currentPeriodEnd || null,
        overridesJson: draft.overridesJson,
        note: draft.note,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${editing.orgName} — багц хадгалагдлаа`);
      setEditing(null);
      router.refresh();
    });
  }

  const columnDefs = useMemo<ColDef<PlatformSubscriptionRow>[]>(
    () => [
      { headerName: "Байгууллага", field: "orgName", minWidth: 200, flex: 1 },
      { headerName: "ТТД", field: "registryNo", width: 110 },
      { headerName: "Эзэн", field: "ownerEmail", minWidth: 180 },
      {
        headerName: "Багц",
        field: "planId",
        width: 120,
        valueFormatter: (p) => PLAN_LABELS[p.value as PlanId] ?? p.value,
      },
      {
        headerName: "Статус",
        field: "status",
        width: 150,
        cellRenderer: (p: ICellRendererParams<PlatformSubscriptionRow>) =>
          p.data ? (
            <span className="flex items-center gap-1.5">
              <StatusBadge tone={STATUS_TONE[p.data.status]} size="sm">
                {STATUS_LABELS[p.data.status]}
              </StatusBadge>
              {!p.data.writable ? (
                <StatusBadge tone="danger" size="sm">
                  read-only
                </StatusBadge>
              ) : null}
            </span>
          ) : null,
      },
      {
        headerName: "Суудал",
        width: 110,
        cellClass: "text-right font-mono",
        valueGetter: (p) => (p.data ? `${p.data.seatsUsed} / ${p.data.seats ?? "∞"}` : ""),
      },
      { headerName: "Гишүүд", field: "memberCount", width: 90, cellClass: "text-right font-mono" },
      {
        headerName: "Хугацаа",
        width: 130,
        valueGetter: (p) =>
          p.data
            ? p.data.status === "trialing"
              ? p.data.trialEndsAt ?? ""
              : p.data.currentPeriodEnd ?? ""
            : "",
      },
      {
        headerName: "Үлдсэн",
        field: "daysLeft",
        width: 90,
        cellClass: "text-right font-mono",
        valueFormatter: (p) => (p.value === null || p.value === undefined ? "" : `${p.value} х`),
      },
      { headerName: "Үүссэн", field: "createdAt", width: 110 },
      { headerName: "Тэмдэглэл", field: "note", minWidth: 160, flex: 1 },
    ],
    []
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Платформ: багцууд</h2>
        <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
          Бүх байгууллагын subscription — давхар даралтаар засна. Мөргүй байгууллага = trial (үүссэнээс 14 хоног).
          Өөрчлөлт тухайн байгууллагын аудитын мөрд бичигдэнэ.
        </p>
      </div>
      <DataGridDynamic<PlatformSubscriptionRow>
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(params) => params.data.organizationId}
        height="flex"
        wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        suppressCellFocus
        onRowDoubleClicked={(event: RowDoubleClickedEvent<PlatformSubscriptionRow>) => {
          if (event.data) open(event.data);
        }}
      />

      <Dialog open={!!editing} onOpenChange={(value) => !value && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.orgName} — багц</DialogTitle>
            <DialogDescription>
              Суудал хоосон = багцын default. Override JSON: {"{ \"features\": { \"api.rest\": true }, \"limits\": { \"companies\": 3 } }"}
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Багц">
                <select
                  className="ea-form-select h-8 w-full text-sm"
                  value={draft.planId}
                  onChange={(e) => setDraft({ ...draft, planId: e.target.value as PlanId })}
                >
                  {EDITABLE_PLANS.map((id) => (
                    <option key={id} value={id}>
                      {PLAN_LABELS[id]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Статус">
                <select
                  className="ea-form-select h-8 w-full text-sm"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as SubscriptionStatus })}
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Төлсөн суудал" hint={`Ашиглаж буй: ${editing?.seatsUsed ?? 0}`}>
                <Input type="number" min={1} value={draft.seats} onChange={(e) => setDraft({ ...draft, seats: e.target.value })} placeholder="default" />
              </FormField>
              <FormField label="Trial дуусах" hint="trialing статуст">
                <Input type="date" value={draft.trialEndsAt} onChange={(e) => setDraft({ ...draft, trialEndsAt: e.target.value })} />
              </FormField>
              <FormField label="Төлсөн хугацааны эцэс" hint="past_due-ийн grace эндээс 14 хоног">
                <Input type="date" value={draft.currentPeriodEnd} onChange={(e) => setDraft({ ...draft, currentPeriodEnd: e.target.value })} />
              </FormField>
              <FormField label="Тэмдэглэл">
                <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Гэрээ №, төлбөрийн нөхцөл…" />
              </FormField>
              <FormField label="Override JSON" className="sm:col-span-2">
                <Input value={draft.overridesJson} onChange={(e) => setDraft({ ...draft, overridesJson: e.target.value })} placeholder='{"features":{},"limits":{}}' className="font-mono text-xs" />
              </FormField>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Болих
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
