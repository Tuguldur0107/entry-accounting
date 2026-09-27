"use client";

// Төлбөрийн автомат сануулга (docs/dev/arap.md §5g): тохиргоо (асаах, шатууд),
// сануулга явуулахгүй харилцагчид, илгээсэн сануулгын түүх. Илгээлт өөрөө
// өдөрт нэг удаа 10:00-оос хойш (lib/arap/reminders-run.ts).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { useModuleCan } from "@/components/layout/module-access-context";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField, SwitchField } from "@/components/ui/form-field";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  saveArReminderSettings,
  setCounterpartyReminderOptOut,
  type ArReminderOverview,
  type ArReminderRow,
} from "@/lib/actions/ar-reminders";
import {
  REMINDER_CATCH_UP_DAYS,
  REMINDER_STATUS_LABELS,
  normalizeReminderSettings,
  parseDayList,
  reminderStageLabel,
} from "@/lib/arap/reminders";
import { REMINDER_STATUS_TONES } from "@/lib/status";
import { openArapDocPanel } from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

/** «2026-09-28 11:48» — Улаанбаатарын цагаар (sv-SE нь ISO хэлбэртэй). */
const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Ulaanbaatar",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "";

const COLUMNS: ColDef<ArReminderRow>[] = [
  { headerName: "Огноо", field: "createdAt", width: 150, valueFormatter: (p) => dateTime(p.value) },
  { headerName: "Нэхэмжлэх", field: "documentNo", width: 150 },
  { headerName: "Харилцагч", field: "counterpartyName", flex: 1, minWidth: 160 },
  { headerName: "Төлөх огноо", field: "dueDate", width: 120 },
  { headerName: "Шат", field: "stage", width: 150, valueFormatter: (p) => reminderStageLabel(String(p.value ?? "")) },
  { headerName: "Хүлээн авагч", field: "recipient", flex: 1, minWidth: 180 },
  {
    headerName: "Төлөв",
    field: "status",
    width: 130,
    cellRenderer: (p: { data?: ArReminderRow }) =>
      p.data ? (
        <StatusBadge tone={REMINDER_STATUS_TONES[p.data.status] ?? "muted"} size="sm">
          {REMINDER_STATUS_LABELS[p.data.status] ?? p.data.status}
        </StatusBadge>
      ) : null,
  },
  {
    headerName: "Тайлбар",
    field: "error",
    flex: 1,
    minWidth: 200,
    valueFormatter: (p) => (p.data?.status === "failed" ? `${p.value ?? ""} (${p.data.attempts} оролдлого)` : ""),
    tooltipField: "error",
  },
];

export function RemindersView({ overview, error }: { overview: ArReminderOverview | null; error: string | null }) {
  const router = useRouter();
  const canPost = useModuleCan("ar", "post");
  const canWrite = useModuleCan("ar", "write");
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(overview?.settings.enabled ?? false);
  const [beforeDays, setBeforeDays] = useState(
    overview?.settings.beforeDays == null ? "" : String(overview.settings.beforeDays)
  );
  const [afterDays, setAfterDays] = useState(overview?.settings.afterDays.join(", ") ?? "");
  const [excludeId, setExcludeId] = useState("");

  const parsedAfter = parseDayList(afterDays);
  const beforeValue = beforeDays.trim() === "" ? null : Number(beforeDays);
  const validation = useMemo(() => {
    if (parsedAfter === null) return "Хэтэрсний дараах хоногийг таслалаар бичнэ (жишээ нь 1, 7, 14)";
    if (beforeValue !== null && !Number.isInteger(beforeValue)) return "Урьдчилсан хоног бүхэл тоо байна";
    const result = normalizeReminderSettings({ enabled, beforeDays: beforeValue, afterDays: parsedAfter });
    return "error" in result ? result.error : null;
  }, [enabled, beforeValue, parsedAfter]);

  if (error || !overview)
    return (
      <div className="p-4">
        <EmptyState icon="warning" title="Сануулгын мэдээлэл уншигдсангүй" description={error ?? "Хуудсаа шинэчилнэ үү"} />
      </div>
    );

  const noEmail = overview.customers.filter((customer) => !customer.email?.trim()).length;

  function save() {
    if (validation || parsedAfter === null) return;
    startTransition(async () => {
      const result = await saveArReminderSettings({ enabled, beforeDays: beforeValue, afterDays: parsedAfter });
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.saved(result.settings?.enabled ? "Автомат сануулга асаалттай — өнөөдрөөс 10:00-аас хойш илгээгдэнэ" : "Автомат сануулга унтраалттай");
      router.refresh();
    });
  }

  function optOut(counterpartyId: string, disabled: boolean) {
    startTransition(async () => {
      const result = await setCounterpartyReminderOptOut(counterpartyId, disabled);
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      setExcludeId("");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Төлбөрийн автомат сануулга</h1>
        <p className="text-xs text-[var(--ea-text-3)]">
          Төлөгдөөгүй нэхэмжлэхийн харилцагчид нэхэмжлэхийн линктэй (QPay идэвхтэй бол шууд төлөх) и-мэйл өдөрт нэг удаа,
          10:00-оос хойш явна. Шат бүр нэг л удаа; алгассан шатыг {REMINDER_CATCH_UP_DAYS} хоногийн дотор нөхнө, түүнээс
          хуучин хэтэрсэн нэхэмжлэх рүү асаасан даруйд цацахгүй.
        </p>
      </div>

      {overview.problem && (
        <p className="rounded-md border border-[var(--ea-warning)] bg-[var(--ea-warning-bg)] px-3 py-2 text-xs text-[var(--ea-warning-fg)]">
          Илгээх боломжгүй: {overview.problem}. Нэхэмжлэх илгээх и-мэйлийн тохиргоо (Тохиргоо → Компанийн мэдээлэл)-той ижил.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4">
          <SwitchField
            label="Автомат сануулга илгээх"
            hint="Анхнаасаа унтраалттай. Асаахад и-мэйл илгээх тохиргоо бэлэн байх ёстой."
            checked={enabled}
            onChange={setEnabled}
            disabled={!canPost || isPending}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Хугацаанаас өмнө (хоног)" hint="Хоосон бол урьдчилсан сануулгагүй">
              <Input
                inputMode="numeric"
                value={beforeDays}
                onChange={(event) => setBeforeDays(event.target.value)}
                disabled={!canPost || isPending}
                placeholder="3"
              />
            </FormField>
            <FormField label="Хэтэрсний дараа (хоног)" hint="Таслалаар, 5 хүртэл шат — жишээ нь 1, 7, 14">
              <Input
                value={afterDays}
                onChange={(event) => setAfterDays(event.target.value)}
                disabled={!canPost || isPending}
                placeholder="1, 7, 14"
              />
            </FormField>
          </div>
          {validation && <p className="text-xs text-[var(--ea-danger-fg)]">{validation}</p>}
          <div className="flex justify-end">
            <Button
              onClick={save}
              disabled={!canPost || isPending || !!validation}
              title={canPost ? undefined : "Авлагын батлах эрх шаардана"}
            >
              Хадгалах
            </Button>
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4">
          <div>
            <div className="text-sm font-medium text-[var(--ea-text-1)]">Сануулга явуулахгүй харилцагч</div>
            <p className="text-[11px] text-[var(--ea-text-4)]">
              Гол харилцагч, гэрээгээр тохирсон төлбөр г.м. — эдгээрт автомат захиа очихгүй.
              {noEmail > 0 && ` ${noEmail} харилцагчид и-мэйл бүртгэлгүй тул сануулга очихгүй (Харилцагчид хэсэгт нэмнэ).`}
            </p>
          </div>
          <div className="flex gap-2">
            <SearchableSelect
              value={excludeId}
              onChange={setExcludeId}
              options={overview.customers.map((customer) => ({
                value: customer.id,
                label: customer.name,
                hint: customer.email ?? "и-мэйлгүй",
              }))}
              placeholder="— Харилцагч сонгох —"
              hideValue
              emptyLabel="Харилцагч алга"
              disabled={!canWrite || isPending}
            />
            <Button variant="outline" onClick={() => excludeId && optOut(excludeId, true)} disabled={!excludeId || !canWrite || isPending}>
              Хасах
            </Button>
          </div>
          {overview.excluded.length === 0 ? (
            <p className="text-xs text-[var(--ea-text-3)]">Хасагдсан харилцагч алга.</p>
          ) : (
            <ul className="divide-y divide-[var(--ea-border)] rounded-md border border-[var(--ea-border)]">
              {overview.excluded.map((row) => (
                <li key={row.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span>{row.name}</span>
                  <IconAction
                    name="close"
                    label="Сануулгад буцааж оруулах"
                    onClick={() => optOut(row.id, false)}
                    disabled={!canWrite || isPending}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="text-sm font-medium text-[var(--ea-text-1)]">Илгээсэн сануулга</div>
      {overview.recent.length === 0 ? (
        <EmptyState icon="mail" title="Сануулга илгээгдээгүй байна" description="Асаасны дараа илгээсэн захиа бүр энд харагдана." />
      ) : (
        <DataGridDynamic<ArReminderRow>
          rowData={overview.recent}
          columnDefs={COLUMNS}
          getRowId={(params) => params.data.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onRowDoubleClicked={(event) => {
            if (event.data)
              openArapDocPanel({
                documentId: event.data.documentId,
                mode: "receivable",
                title: `${event.data.documentNo} · ${event.data.counterpartyName}`,
              });
          }}
        />
      )}
    </div>
  );
}
