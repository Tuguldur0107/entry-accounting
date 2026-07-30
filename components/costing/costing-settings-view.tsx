"use client";

// Өртгийн тохиргоо — 4 хэсэг:
//   Дансны рольууд      — клиринг / тооллого / NRV дансууд (JPR-006: кодод биш)
//   Зарлагын төрөл      — дебет чиглэлийг шийдэх master data (FR-MD-IT-*)
//   Өртгийн бүрэлдэхүүн — Inbound өртгийн ангилал (FR-MD-CC-*)
//   Барааны данс        — бараа бүрийн нөөц/өртгийн данс
//
// Master data-г УСТГАХГҮЙ, зөвхөн идэвхгүй болгоно (FR-AUD-004) — түүхэн
// бичилтүүд эдгээрт холбогдсон байдаг.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";

import { AccountInput } from "@/components/account/account-input";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { upsertCostingItemSetting } from "@/lib/actions/costing";
import {
  saveCostComponent,
  saveCostingAccountSettings,
  saveIssueType,
  toggleCostComponent,
  toggleIssueType,
} from "@/lib/actions/costing-master";
import {
  ProductionConfigSection,
  type ProductionConfigStage,
} from "@/components/costing/production-config-section";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { buildSegCode } from "@/lib/grid/segments";
import { extractMainAccount } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

export type CostingSettingRow = {
  itemId: string;
  itemLabel: string;
  inventoryAccountNumber: string;
  cogsAccountNumber: string;
};

export type IssueTypeRow = {
  id: string;
  code: string;
  name: string;
  destinationClass: string;
  debitAccountSource: string;
  debitAccountNumber: string | null;
  isActive: boolean;
};

export type CostComponentRow = {
  id: string;
  code: string;
  name: string;
  classification: string;
  accountNumber: string | null;
  isActive: boolean;
};

export type CostingAccountRolesRow = {
  clearingAccountNumber: string;
  adjustmentGainAccountNumber: string;
  adjustmentLossAccountNumber: string;
  nrvExpenseAccountNumber: string;
  nrvReserveAccountNumber: string;
};

type Tab = "accounts" | "issue-types" | "components" | "items" | "production";

const TABS: { value: Tab; label: string }[] = [
  { value: "accounts", label: "Дансны рольууд" },
  { value: "issue-types", label: "Зарлагын төрөл" },
  { value: "components", label: "Өртгийн бүрэлдэхүүн" },
  { value: "items", label: "Барааны данс" },
  { value: "production", label: "Үйлдвэрлэл" },
];

interface Props {
  rows: CostingSettingRow[];
  issueTypes: IssueTypeRow[];
  components: CostComponentRow[];
  accountRoles: CostingAccountRolesRow;
  productionStages: ProductionConfigStage[];
  costCenters: { code: string; name: string }[];
  glAccounts: { number: string; name: string }[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
}

/** Үндсэн дансыг ИДЭВХТЭЙ сегментүүдийн default-той бүтэн код болгоно. */
function fullCode(
  main: string,
  activeSegIds: number[],
  defaultSegments: Record<number, string>
) {
  return buildSegCode(
    { ...defaultSegments, 3: main },
    activeSegIds,
    defaultSegments
  );
}

export function CostingSettingsView({
  rows,
  issueTypes,
  components,
  accountRoles,
  productionStages,
  costCenters,
  glAccounts,
  activeSegIds,
  segmentOptions,
  defaultSegments,
}: Props) {
  const [tab, setTab] = useState<Tab>("accounts");

  const glNameMap = useMemo(
    () => new Map(glAccounts.map((account) => [account.number, account.name])),
    [glAccounts]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Өртгийн тохиргоо
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Өртгийн журнал эдгээр тохиргоогоор бичигдэнэ. Дансны дугаар кодод
          хатуу бичигдээгүй — бүгд эндээс өөрчлөгдөнө. Өртгийн арга: хугацааны
          жигнэсэн дундаж (Periodic Weighted Average).
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setTab(entry.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === entry.value
                ? "bg-[var(--ea-primary)] text-white"
                : "text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "accounts" && (
        <AccountRolesSection
          roles={accountRoles}
          activeSegIds={activeSegIds}
          segmentOptions={segmentOptions}
          defaultSegments={defaultSegments}
          glNameMap={glNameMap}
        />
      )}
      {tab === "issue-types" && (
        <IssueTypesSection
          issueTypes={issueTypes}
          activeSegIds={activeSegIds}
          segmentOptions={segmentOptions}
          defaultSegments={defaultSegments}
          glNameMap={glNameMap}
        />
      )}
      {tab === "components" && (
        <CostComponentsSection
          components={components}
          activeSegIds={activeSegIds}
          segmentOptions={segmentOptions}
          defaultSegments={defaultSegments}
          glNameMap={glNameMap}
        />
      )}
      {tab === "production" && (
        <ProductionConfigSection
          stages={productionStages}
          costCenters={costCenters}
        />
      )}
      {tab === "items" && (
        <ItemAccountsSection
          rows={rows}
          activeSegIds={activeSegIds}
          segmentOptions={segmentOptions}
          defaultSegments={defaultSegments}
          glNameMap={glNameMap}
        />
      )}
    </section>
  );
}

// ── Дансны рольууд ──────────────────────────────────────────────────────────

const ROLE_FIELDS: {
  key: keyof CostingAccountRolesRow;
  label: string;
  hint: string;
}[] = [
  {
    key: "clearingAccountNumber",
    label: "Худалдан авалтын клиринг",
    hint: "Орлогын эсрэг тал: Dr бараа / Cr клиринг. АП-ийн бараатай мөр энд суана.",
  },
  {
    key: "adjustmentGainAccountNumber",
    label: "Тооллогын илүүдэл",
    hint: "Тооллогоор илүү гарсан барааны эсрэг тал (орлого).",
  },
  {
    key: "adjustmentLossAccountNumber",
    label: "Тооллогын дутагдал",
    hint: "Тооллогоор дутсан барааны зардлын данс.",
  },
  {
    key: "nrvExpenseAccountNumber",
    label: "NRV бууруулалтын зардал",
    hint: "IAS 2 §28–33: цэвэр боломжит үнэ хүртэл бууруулах зардал.",
  },
  {
    key: "nrvReserveAccountNumber",
    label: "NRV нөөц (contra)",
    hint: "Бууруулалтын нөөц — өртгийн суурь дундаж хөндөгдөхгүй.",
  },
];

function AccountRolesSection({
  roles,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  glNameMap,
}: {
  roles: CostingAccountRolesRow;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  glNameMap: Map<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [form, setForm] = useState(
    () =>
      Object.fromEntries(
        ROLE_FIELDS.map((field) => [
          field.key,
          fullCode(roles[field.key], activeSegIds, defaultSegments),
        ])
      ) as Record<keyof CostingAccountRolesRow, string>
  );

  function save() {
    setError("");
    startTransition(async () => {
      const result = await saveCostingAccountSettings({
        clearingAccountNumber: form.clearingAccountNumber,
        adjustmentGainAccountNumber: form.adjustmentGainAccountNumber,
        adjustmentLossAccountNumber: form.adjustmentLossAccountNumber,
        nrvExpenseAccountNumber: form.nrvExpenseAccountNumber,
        nrvReserveAccountNumber: form.nrvReserveAccountNumber,
      });
      if (!result.ok) {
        setError(result.message ?? "Хадгалж чадсангүй");
        return;
      }
      toast.success("Дансны тохиргоо хадгалагдлаа");
      router.refresh();
    });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid max-w-3xl gap-4 pb-2">
        {ROLE_FIELDS.map((field) => {
          const main = extractMainAccount(form[field.key] ?? "");
          const name = main ? glNameMap.get(main) : "";
          return (
            <div key={field.key} className="grid gap-1.5">
              <Label>{field.label}</Label>
              <AccountInput
                value={form[field.key] ?? ""}
                onChange={(value) =>
                  setForm((current) => ({ ...current, [field.key]: value }))
                }
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
                placeholder="Данс сонгох..."
              />
              <p className="text-[11px] text-[var(--ea-text-4)]">
                {field.hint}
                {name ? ` · ${name}` : ""}
              </p>
            </div>
          );
        })}

        {error && (
          <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button onClick={save} disabled={isPending}>
            Хадгалах
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Зарлагын төрөл ──────────────────────────────────────────────────────────

const EMPTY_ISSUE_TYPE = {
  id: undefined as string | undefined,
  code: "",
  name: "",
  destinationClass: "",
  debitAccountSource: "fixed" as "fixed" | "item_cogs",
  debitAccountNumber: "",
};

function IssueTypesSection({
  issueTypes,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  glNameMap,
}: {
  issueTypes: IssueTypeRow[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  glNameMap: Map<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_ISSUE_TYPE);
  const [error, setError] = useState("");

  function openNew() {
    setForm(EMPTY_ISSUE_TYPE);
    setError("");
    setOpen(true);
  }

  function openEdit(row: IssueTypeRow) {
    setForm({
      id: row.id,
      code: row.code,
      name: row.name,
      destinationClass: row.destinationClass,
      debitAccountSource:
        row.debitAccountSource === "item_cogs" ? "item_cogs" : "fixed",
      debitAccountNumber: row.debitAccountNumber
        ? fullCode(row.debitAccountNumber, activeSegIds, defaultSegments)
        : "",
    });
    setError("");
    setOpen(true);
  }

  function save() {
    setError("");
    startTransition(async () => {
      const result = await saveIssueType({
        id: form.id,
        code: form.code,
        name: form.name,
        destinationClass: form.destinationClass,
        debitAccountSource: form.debitAccountSource,
        debitAccountNumber: form.debitAccountNumber,
      });
      if (!result.ok) {
        setError(result.message ?? "Хадгалж чадсангүй");
        return;
      }
      toast.success("Зарлагын төрөл хадгалагдлаа");
      setOpen(false);
      router.refresh();
    });
  }

  function toggle(row: IssueTypeRow) {
    startTransition(async () => {
      const result = await toggleIssueType(row.id, !row.isActive);
      if (!result.ok) {
        toast.error(result.message ?? "Үйлдэл амжилтгүй");
        return;
      }
      toast.success(row.isActive ? "Идэвхгүй боллоо" : "Идэвхжлээ");
      router.refresh();
    });
  }

  const columns = useMemo<ColDef<IssueTypeRow>[]>(
    () => [
      { headerName: "Код", field: "code", width: 130, cellClass: "font-mono" },
      { headerName: "Нэр", field: "name", minWidth: 190, flex: 1 },
      {
        headerName: "Зориулалт",
        field: "destinationClass",
        minWidth: 170,
        flex: 1,
        cellClass: "text-xs",
      },
      {
        headerName: "Дебет данс",
        colId: "debit",
        minWidth: 230,
        valueGetter: (params) => {
          const row = params.data;
          if (!row) return "";
          if (row.debitAccountSource === "item_cogs")
            return "Барааны COGS данс (profile)";
          const main = row.debitAccountNumber ?? "";
          return main ? `${main} ${glNameMap.get(main) ?? ""}`.trim() : "—";
        },
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Төлөв",
        field: "isActive",
        width: 120,
        cellRenderer: (params: ICellRendererParams<IssueTypeRow>) => (
          <div className="flex h-full items-center">
            <StatusBadge tone={params.data?.isActive ? "success" : "muted"}>
              {params.data?.isActive ? "Идэвхтэй" : "Идэвхгүй"}
            </StatusBadge>
          </div>
        ),
      },
      {
        headerName: "",
        colId: "actions",
        width: 100,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<IssueTypeRow>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <div className="flex h-full items-center justify-end gap-1">
              <button
                type="button"
                title="Засах"
                aria-label="Засах"
                onClick={() => openEdit(row)}
                className="flex size-6 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                title={row.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                aria-label={row.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                onClick={() => toggle(row)}
                className="flex size-6 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
              >
                <Power size={13} />
              </button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [glNameMap]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-[var(--ea-text-3)]">
          Зарлага бүр эдгээрийн аль нэгээр ДЕБЕТ чиглэлээ авна (COGS,
          удирдлагын зардал, үйлдвэрлэл/WIP, хорогдол…). Нөөцийн кредит данс нь
          барааны тохиргооноос ирнэ.
        </p>
        <Button size="sm" onClick={openNew} disabled={isPending}>
          <Plus size={14} />
          Нэмэх
        </Button>
      </div>

      <DataGridDynamic<IssueTypeRow>
        rowData={issueTypes}
        columnDefs={columns}
        getRowId={(params) => params.data.id}
        height="flex"
        wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        suppressCellFocus
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Зарлагын төрөл засах" : "Шинэ зарлагын төрөл"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Код</Label>
                <Input
                  value={form.code}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, code: event.target.value }))
                  }
                  placeholder="COGS"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Нэр</Label>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, name: event.target.value }))
                  }
                  placeholder="Борлуулалтын өртөг"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Зориулалтын ангилал</Label>
              <Input
                value={form.destinationClass}
                onChange={(event) =>
                  setForm((c) => ({
                    ...c,
                    destinationClass: event.target.value,
                  }))
                }
                placeholder="Удирдлагын зардал / Үйлдвэрлэл (WIP) / Хорогдол…"
              />
              <p className="text-[11px] text-[var(--ea-text-4)]">
                Чөлөөт текст — тайланд бүлэглэхэд хэрэглэгдэнэ.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label>Дебет дансыг хаанаас авах</Label>
              <select
                className="h-9 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-sm text-[var(--ea-text-1)]"
                value={form.debitAccountSource}
                onChange={(event) =>
                  setForm((c) => ({
                    ...c,
                    debitAccountSource: event.target.value as
                      | "fixed"
                      | "item_cogs",
                  }))
                }
              >
                <option value="fixed">Тогтмол данс</option>
                <option value="item_cogs">Барааны COGS данс (profile)</option>
              </select>
            </div>

            {form.debitAccountSource === "fixed" && (
              <div className="grid gap-1.5">
                <Label>Дебет данс</Label>
                <AccountInput
                  value={form.debitAccountNumber}
                  onChange={(value) =>
                    setForm((c) => ({ ...c, debitAccountNumber: value }))
                  }
                  activeSegIds={activeSegIds}
                  segmentOptions={segmentOptions}
                  defaultSegments={defaultSegments}
                  placeholder="Зардлын данс..."
                />
              </div>
            )}

            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button onClick={save} disabled={isPending}>
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Өртгийн бүрэлдэхүүн ─────────────────────────────────────────────────────

const EMPTY_COMPONENT = {
  id: undefined as string | undefined,
  code: "",
  name: "",
  classification: "",
  accountNumber: "",
};

function CostComponentsSection({
  components,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  glNameMap,
}: {
  components: CostComponentRow[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  glNameMap: Map<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_COMPONENT);
  const [error, setError] = useState("");

  function openNew() {
    setForm(EMPTY_COMPONENT);
    setError("");
    setOpen(true);
  }

  function openEdit(row: CostComponentRow) {
    setForm({
      id: row.id,
      code: row.code,
      name: row.name,
      classification: row.classification,
      accountNumber: row.accountNumber
        ? fullCode(row.accountNumber, activeSegIds, defaultSegments)
        : "",
    });
    setError("");
    setOpen(true);
  }

  function save() {
    setError("");
    startTransition(async () => {
      const result = await saveCostComponent({
        id: form.id,
        code: form.code,
        name: form.name,
        classification: form.classification,
        accountNumber: form.accountNumber,
      });
      if (!result.ok) {
        setError(result.message ?? "Хадгалж чадсангүй");
        return;
      }
      toast.success("Өртгийн бүрэлдэхүүн хадгалагдлаа");
      setOpen(false);
      router.refresh();
    });
  }

  function toggle(row: CostComponentRow) {
    startTransition(async () => {
      const result = await toggleCostComponent(row.id, !row.isActive);
      if (!result.ok) {
        toast.error(result.message ?? "Үйлдэл амжилтгүй");
        return;
      }
      toast.success(row.isActive ? "Идэвхгүй боллоо" : "Идэвхжлээ");
      router.refresh();
    });
  }

  const columns = useMemo<ColDef<CostComponentRow>[]>(
    () => [
      { headerName: "Код", field: "code", width: 140, cellClass: "font-mono" },
      { headerName: "Нэр", field: "name", minWidth: 190, flex: 1 },
      {
        headerName: "Ангилал",
        field: "classification",
        minWidth: 160,
        flex: 1,
        cellClass: "text-xs",
      },
      {
        headerName: "Данс",
        colId: "account",
        minWidth: 220,
        valueGetter: (params) => {
          const main = params.data?.accountNumber ?? "";
          return main ? `${main} ${glNameMap.get(main) ?? ""}`.trim() : "—";
        },
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Төлөв",
        field: "isActive",
        width: 120,
        cellRenderer: (params: ICellRendererParams<CostComponentRow>) => (
          <div className="flex h-full items-center">
            <StatusBadge tone={params.data?.isActive ? "success" : "muted"}>
              {params.data?.isActive ? "Идэвхтэй" : "Идэвхгүй"}
            </StatusBadge>
          </div>
        ),
      },
      {
        headerName: "",
        colId: "actions",
        width: 100,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<CostComponentRow>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <div className="flex h-full items-center justify-end gap-1">
              <button
                type="button"
                title="Засах"
                aria-label="Засах"
                onClick={() => openEdit(row)}
                className="flex size-6 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                title={row.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                aria-label={row.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                onClick={() => toggle(row)}
                className="flex size-6 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
              >
                <Power size={13} />
              </button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [glNameMap]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-[var(--ea-text-3)]">
          Барааны орлогын өртгийг бүрдүүлэгч ангилалууд (худалдан авах үнэ,
          тээвэр, гааль, даатгал, ажиллах хүч…). Жагсаалт нээлттэй — өөрийн
          бүрэлдэхүүнээ нэмнэ.
        </p>
        <Button size="sm" onClick={openNew} disabled={isPending}>
          <Plus size={14} />
          Нэмэх
        </Button>
      </div>

      {components.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Бүрэлдэхүүн бүртгээгүй байна
        </div>
      ) : (
        <DataGridDynamic<CostComponentRow>
          rowData={components}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Бүрэлдэхүүн засах" : "Шинэ өртгийн бүрэлдэхүүн"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Код</Label>
                <Input
                  value={form.code}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, code: event.target.value }))
                  }
                  placeholder="FREIGHT"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Нэр</Label>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, name: event.target.value }))
                  }
                  placeholder="Тээврийн зардал"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Ангилал</Label>
              <Input
                value={form.classification}
                onChange={(event) =>
                  setForm((c) => ({ ...c, classification: event.target.value }))
                }
                placeholder="Худалдан авалтын нэмэлт зардал…"
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Холбогдох данс (сонголтоор)</Label>
              <AccountInput
                value={form.accountNumber}
                onChange={(value) =>
                  setForm((c) => ({ ...c, accountNumber: value }))
                }
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
                placeholder="Данс сонгох..."
              />
            </div>

            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button onClick={save} disabled={isPending}>
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Барааны данс ────────────────────────────────────────────────────────────

function ItemAccountsSection({
  rows,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  glNameMap,
}: {
  rows: CostingSettingRow[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  glNameMap: Map<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editRow, setEditRow] = useState<CostingSettingRow | null>(null);
  const [form, setForm] = useState({ inventory: "", cogs: "" });
  const [error, setError] = useState("");

  function openEdit(row: CostingSettingRow) {
    setForm({
      inventory: fullCode(
        row.inventoryAccountNumber,
        activeSegIds,
        defaultSegments
      ),
      cogs: fullCode(row.cogsAccountNumber, activeSegIds, defaultSegments),
    });
    setError("");
    setEditRow(row);
  }

  function save() {
    if (!editRow) return;
    setError("");
    startTransition(async () => {
      try {
        await upsertCostingItemSetting({
          itemId: editRow.itemId,
          // AccountInput бүтэн 10 хэсэгт код буцаадаг — үндсэн дансыг нь
          // хадгална (mapping нь main-түвшний).
          inventoryAccountNumber: extractMainAccount(form.inventory),
          cogsAccountNumber: extractMainAccount(form.cogs),
        });
        toast.success("Дансны тохиргоо хадгалагдлаа");
        setEditRow(null);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Хадгалж чадсангүй");
      }
    });
  }

  const columns = useMemo<ColDef<CostingSettingRow>[]>(
    () => [
      { headerName: "Бараа", field: "itemLabel", minWidth: 220, flex: 1 },
      {
        headerName: "Бараа материалын данс",
        colId: "inventory",
        minWidth: 230,
        flex: 1,
        valueGetter: (params) => {
          const main = params.data?.inventoryAccountNumber ?? "";
          return main ? `${main} ${glNameMap.get(main) ?? ""}`.trim() : "";
        },
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Өртгийн (COGS) данс",
        colId: "cogs",
        minWidth: 230,
        flex: 1,
        valueGetter: (params) => {
          const main = params.data?.cogsAccountNumber ?? "";
          return main ? `${main} ${glNameMap.get(main) ?? ""}`.trim() : "";
        },
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "",
        colId: "actions",
        width: 64,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<CostingSettingRow>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <div className="flex h-full items-center justify-end">
              <button
                type="button"
                title="Данс өөрчлөх"
                aria-label="Данс өөрчлөх"
                onClick={() => openEdit(row)}
                className="flex size-6 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
              >
                <Pencil size={13} />
              </button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [glNameMap]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-xs text-[var(--ea-text-3)]">
        Бараа бүрийн нөөцийн (кредит) болон COGS данс. Зарлагын төрөл нь
        &quot;Барааны COGS данс&quot; profile-той бол дебет чиглэл эндээс
        шийдэгдэнэ.
      </p>

      {rows.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Бараа бүртгээгүй байна — эхлээд Бараа материал модульд бараа нэмнэ
        </div>
      ) : (
        <DataGridDynamic<CostingSettingRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.itemId}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRow?.itemLabel} — дансны mapping</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Бараа материалын данс (14-бүлэг)</Label>
              <AccountInput
                value={form.inventory}
                onChange={(value) =>
                  setForm((c) => ({ ...c, inventory: value }))
                }
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
                placeholder="Бараа материалын данс..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Өртгийн (COGS) данс (6-бүлэг)</Label>
              <AccountInput
                value={form.cogs}
                onChange={(value) => setForm((c) => ({ ...c, cogs: value }))}
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
                placeholder="COGS данс..."
              />
            </div>
            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditRow(null)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button onClick={save} disabled={isPending}>
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
