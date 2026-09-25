"use client";

// Авлагын ECL нөөц (IFRS 9 хялбаршуулсан арга, ENT-065): provision matrix-ийн
// бүлэг бүрийн үлдэгдэл → шаардлагатай нөөц → GL-ийн одоогийн нөөцтэй delta →
// НООРОГ журнал (§9 — батлах нь нягтланчийн). Тохиргоо: matrix, данс, ААНОАТ-ын хувь.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { useModuleCan } from "@/components/layout/module-access-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { runEclProvision, saveEclSettings } from "@/lib/actions/arap-ecl";
import {
  eclMatrixProblems,
  type EclBucketResult,
  type EclOverviewResult,
} from "@/lib/arap/ecl";
import { fmtMnt } from "@/lib/reports/balances";
import { openVoucherPanel } from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

const moneyCell = {
  cellClass: "ag-right-aligned-cell font-mono",
  headerClass: "ag-right-aligned-header",
  valueFormatter: (params: { value: unknown }) => fmtMnt(Number(params.value ?? 0)),
};

const COLUMNS: ColDef<EclBucketResult>[] = [
  { headerName: "Хугацаа хэтэрсэн", field: "label", flex: 1, minWidth: 180 },
  { headerName: "Баримт", field: "count", width: 100, cellClass: "ag-right-aligned-cell font-mono", headerClass: "ag-right-aligned-header" },
  { headerName: "Үлдэгдэл (₮)", field: "balance", width: 160, ...moneyCell },
  {
    headerName: "Хувь",
    field: "ratePct",
    width: 90,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
    valueFormatter: (params) => (Number.isFinite(params.value) ? `${params.value}%` : ""),
  },
  { headerName: "Шаардлагатай нөөц (₮)", field: "required", width: 190, ...moneyCell },
];

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2">
      <div className="text-[11px] text-[var(--ea-text-3)]">{label}</div>
      <div className={`font-mono text-sm font-semibold ${tone === "warning" ? "text-[var(--ea-warning-fg)]" : "text-[var(--ea-text-1)]"}`}>
        {value}
      </div>
    </div>
  );
}

export function EclView({
  asOf,
  overview,
  error,
}: {
  asOf: string;
  overview: EclOverviewResult | null;
  error: string | null;
}) {
  const router = useRouter();
  const canWrite = useModuleCan("ar", "write");
  const canPost = useModuleCan("ar", "post");
  const [isPending, startTransition] = useTransition();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const totals = useMemo(() => {
    if (!overview) return [];
    return [
      {
        label: "Нийт",
        count: overview.plan.buckets.reduce((sum, bucket) => sum + bucket.count, 0),
        balance: overview.plan.grossBalance,
        ratePct: Number.NaN,
        required: overview.plan.requiredAllowance,
      },
    ];
  }, [overview]);

  if (error || !overview)
    return (
      <div className="p-4">
        <EmptyState icon="warning" title="ECL тооцоо уншигдсангүй" description={error ?? "Хуудсаа шинэчилнэ үү"} />
      </div>
    );

  const { plan, settings, drafts } = overview;

  function run() {
    startTransition(async () => {
      const result = await runEclProvision({ asOf });
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      if (!result.voucherId) {
        feedback.saved("Нөөцөд өөрчлөлт алга — журнал үүсээгүй");
      } else {
        feedback.saved(`ECL ноорог журнал ${result.documentNo} үүслээ — шалгаад батална уу`);
        openVoucherPanel(result.voucherId);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Авлагын ECL нөөц (IFRS 9)</h1>
          <p className="text-xs text-[var(--ea-text-3)]">
            {asOf}-ны байдлаар · хялбаршуулсан арга, хугацаа хэтрэлтийн хувийн хүснэгт · нөөц {settings.allowanceAccountNumber}, зардал{" "}
            {settings.expenseAccountNumber}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size="sm" />
            Тохиргоо
          </Button>
          <Button
            onClick={run}
            disabled={isPending || !canWrite}
            title={canWrite ? "Delta-г НООРОГ журнал болгоно (өмнөх ноорог солигдоно)" : "Авлагын бичих эрх шаардана"}
          >
            <Icon name="journal" size="sm" />
            Ноорог журнал үүсгэх
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Нээлттэй авлага" value={`${fmtMnt(plan.grossBalance)}₮`} />
        <Stat label="Шаардлагатай нөөц" value={`${fmtMnt(plan.requiredAllowance)}₮`} />
        <Stat label="GL-ийн одоогийн нөөц" value={`${fmtMnt(plan.currentAllowance)}₮`} />
        <Stat
          label={plan.allowanceDelta >= 0 ? "Нэмж бичих" : "Эргүүлэх"}
          value={`${fmtMnt(Math.abs(plan.allowanceDelta))}₮`}
          tone={Math.abs(plan.allowanceDelta) >= 0.01 ? "warning" : undefined}
        />
      </div>

      <p className="text-xs text-[var(--ea-text-3)]">
        {plan.deferredTax
          ? `Хойшлогдсон татвар (IAS 12, ${plan.deferredTax.ratePct}%): DTA ${fmtMnt(plan.deferredTax.requiredAsset)}₮, одоо ${fmtMnt(plan.deferredTax.currentAsset)}₮, delta ${fmtMnt(plan.deferredTax.delta)}₮ — нөөц нь татварын хасагдах зардал биш гэж үзсэн.`
          : "Хойшлогдсон татвар бодогдоогүй — «Тохиргоо»-нд ААНОАТ-ын хувийг оруулна (хувь зохиохгүй)."}
        {drafts.length > 0 && ` Ноорог ECL журнал: ${drafts.map((draft) => draft.documentNo ?? draft.date).join(", ")}.`}
      </p>

      {plan.grossBalance <= 0 ? (
        <EmptyState
          icon="document"
          title="Нээлттэй авлага алга"
          description={`${asOf}-ны байдлаар батлагдсан нээлттэй авлагын нэхэмжлэл алга — нөөц шаардлагагүй (өмнөх нөөц байвал журнал эргүүлнэ).`}
        />
      ) : (
        <DataGridDynamic<EclBucketResult>
          rowData={plan.buckets}
          columnDefs={COLUMNS}
          getRowId={(params) => params.data.label}
          pinnedBottomRowData={totals}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      {settingsOpen && (
        <EclSettingsDialog
          settings={settings}
          canEdit={canPost}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EclSettingsDialog({
  settings,
  canEdit,
  onClose,
  onSaved,
}: {
  settings: EclOverviewResult["settings"];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [matrix, setMatrix] = useState(
    settings.matrix.map((row) => ({ maxDays: row.maxDays == null ? "" : String(row.maxDays), ratePct: String(row.ratePct) }))
  );
  const [accounts, setAccounts] = useState({
    allowanceAccountNumber: settings.allowanceAccountNumber,
    expenseAccountNumber: settings.expenseAccountNumber,
    deferredTaxAssetAccountNumber: settings.deferredTaxAssetAccountNumber,
    deferredTaxExpenseAccountNumber: settings.deferredTaxExpenseAccountNumber,
  });
  const [taxRate, setTaxRate] = useState(settings.taxRatePct == null ? "" : String(settings.taxRatePct));
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const parsed = matrix.map((row, index) => ({
    maxDays: index === matrix.length - 1 || row.maxDays === "" ? null : Number(row.maxDays),
    ratePct: Number(row.ratePct),
  }));
  const problems = eclMatrixProblems(parsed);

  function save() {
    setError("");
    startTransition(async () => {
      const result = await saveEclSettings({
        ...accounts,
        matrix: parsed,
        taxRatePct: taxRate.trim() === "" ? null : Number(taxRate),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      feedback.saved("ECL тохиргоо хадгалагдлаа");
      onSaved();
    });
  }

  const accountFields: { key: keyof typeof accounts; label: string }[] = [
    { key: "allowanceAccountNumber", label: "ECL нөөц (contra)" },
    { key: "expenseAccountNumber", label: "ECL зардал / сэргэлт" },
    { key: "deferredTaxAssetAccountNumber", label: "Хойшлогдсон татварын хөрөнгө" },
    { key: "deferredTaxExpenseAccountNumber", label: "Хойшлогдсон татварын зардал" },
  ];

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>ECL тохиргоо</DialogTitle>
          <DialogDescription>
            Хувийг байгууллагын түүхэн алдагдлаар тохируулна (IFRS 9 B5.5.35). Өөрчлөлт аудитад бичигдэнэ; засах нь
            админ + авлагын батлах эрх.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_1fr_32px] gap-2 px-1 text-[11px] text-[var(--ea-text-3)]">
            <span>Хугацаа хэтэрсэн хоног (хүртэл)</span>
            <span>Нөөцийн хувь %</span>
            <span />
          </div>
          {matrix.map((row, index) => {
            const last = index === matrix.length - 1;
            return (
              <div key={index} className="grid grid-cols-[1fr_1fr_32px] items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  disabled={!canEdit || last}
                  placeholder={last ? "дээд хилгүй (+)" : "хоног"}
                  value={last ? "" : row.maxDays}
                  aria-label={`${index + 1}-р бүлгийн хоног`}
                  onChange={(event) =>
                    setMatrix((current) => current.map((item, i) => (i === index ? { ...item, maxDays: event.target.value } : item)))
                  }
                />
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  disabled={!canEdit}
                  value={row.ratePct}
                  aria-label={`${index + 1}-р бүлгийн хувь`}
                  onChange={(event) =>
                    setMatrix((current) => current.map((item, i) => (i === index ? { ...item, ratePct: event.target.value } : item)))
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit || matrix.length <= 2}
                  aria-label="Бүлэг хасах"
                  onClick={() => setMatrix((current) => current.filter((_, i) => i !== index))}
                >
                  ×
                </Button>
              </div>
            );
          })}
          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit || matrix.length >= 12}
            onClick={() =>
              setMatrix((current) => [...current.slice(0, -1), { maxDays: "", ratePct: "" }, current[current.length - 1]])
            }
          >
            Бүлэг нэмэх
          </Button>
          {problems.length > 0 && <p className="text-xs text-[var(--ea-danger-fg)]">{problems.join("; ")}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {accountFields.map((field) => (
            <FormField key={field.key} label={field.label}>
              <Input
                value={accounts[field.key]}
                disabled={!canEdit}
                inputMode="numeric"
                className="font-mono"
                onChange={(event) => setAccounts((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            </FormField>
          ))}
          <FormField
            label="ААНОАТ-ын хувь % (хойшлогдсон татвар)"
            hint="Хоосон бол DTA бодогдохгүй. Байгууллагын хүлээгдэж буй хувь (жишээ: 10 эсвэл 25) — систем зохиохгүй."
          >
            <Input
              type="number"
              min="0"
              max="99"
              step="any"
              disabled={!canEdit}
              value={taxRate}
              onChange={(event) => setTaxRate(event.target.value)}
            />
          </FormField>
        </div>
        {error && <p className="text-sm text-[var(--ea-danger-fg)]">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Болих
          </Button>
          <Button onClick={save} disabled={!canEdit || isPending || problems.length > 0}>
            Хадгалах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
