"use client";

// Ажилтны бүртгэл — цалингийн бодолтын суурь лавлах.
// Мөр дээр ДАВХАР даралт = засварын dialog (нэг даралт нээхгүй — UI стандарт).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CellDoubleClickedEvent, ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toggleEmployee, upsertEmployee } from "@/lib/actions/payroll";
import { col } from "@/lib/grid/columnTypes";
import { SwitchCellRenderer } from "@/lib/grid/editors/SwitchCellRenderer";
import { parseMntInput } from "@/lib/grid/formatters";

export interface EmployeeRow {
  id: string;
  name: string;
  position: string;
  baseSalary: number;
  accidentRatePercent: number;
  isActive: boolean;
}

interface Props {
  rows: EmployeeRow[];
}

interface FormState {
  id?: string;
  name: string;
  position: string;
  baseSalary: string;
  accidentRatePercent: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  position: "",
  baseSalary: "",
  accidentRatePercent: "0.8",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Алдаа гарлаа";
}

export function EmployeesView({ rows }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function openCreate() {
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(row: EmployeeRow) {
    setForm({
      id: row.id,
      name: row.name,
      position: row.position,
      baseSalary: row.baseSalary.toLocaleString("en-US"),
      accidentRatePercent: String(row.accidentRatePercent),
    });
    setOpen(true);
  }

  function handleCellDoubleClicked(event: CellDoubleClickedEvent<EmployeeRow>) {
    // Switch багана дээрх давхар даралт dialog нээхгүй — toggle-ийн хэрэгсэл.
    if (!event.data || event.column.getColId() === "isActive") return;
    openEdit(event.data);
  }

  function save() {
    const baseSalary = parseMntInput(form.baseSalary);
    const accidentRatePercent = Number(form.accidentRatePercent);
    startTransition(async () => {
      try {
        await upsertEmployee({
          id: form.id,
          name: form.name,
          position: form.position || undefined,
          baseSalary: Number.isFinite(baseSalary) ? baseSalary : NaN,
          accidentRatePercent,
        });
        toast.success(
          form.id ? "Ажилтны мэдээлэл хадгалагдлаа" : "Ажилтан бүртгэгдлээ"
        );
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  function toggle(row: EmployeeRow, next: boolean) {
    startTransition(async () => {
      try {
        await toggleEmployee(row.id, next);
        toast.success(
          next ? `${row.name} идэвхтэй боллоо` : `${row.name} идэвхгүй боллоо`
        );
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  const columns = useMemo<ColDef<EmployeeRow>[]>(
    () => [
      col<EmployeeRow>({
        eaType: "readonly-text",
        headerName: "Нэр",
        field: "name",
        minWidth: 180,
        flex: 1,
      }),
      col<EmployeeRow>({
        eaType: "readonly-text",
        headerName: "Албан тушаал",
        field: "position",
        minWidth: 150,
        cellClass: "text-xs text-[var(--ea-text-3)]",
      }),
      col<EmployeeRow>({
        eaType: "readonly-money",
        headerName: "Үндсэн цалин",
        field: "baseSalary",
        width: 150,
      }),
      {
        headerName: "ҮОМШӨ %",
        field: "accidentRatePercent",
        width: 110,
        editable: false,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.value == null ? "" : `${params.value}%`,
      },
      {
        headerName: "Идэвхтэй",
        field: "isActive",
        width: 110,
        editable: false,
        sortable: false,
        cellRenderer: SwitchCellRenderer,
        cellRendererParams: {
          onToggle: (rowData: Record<string, unknown> | null, next: boolean) => {
            if (rowData) toggle(rowData as unknown as EmployeeRow, next);
          },
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Ажилтнууд
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Идэвхтэй ажилтан бүр сарын бодолтод орно. Мөр дээр давхар дарж
            мэдээллийг засна.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Icon name="add" size="sm" />
          Ажилтан
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Ажилтан бүртгэгдээгүй байна — «+ Ажилтан» товчоор нэмнэ.
        </div>
      ) : (
        <DataGridDynamic<EmployeeRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          onCellDoubleClicked={handleCellDoubleClicked}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Ажилтны мэдээлэл засах" : "Ажилтан бүртгэх"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Нэр</Label>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((c) => ({ ...c, name: event.target.value }))
                }
                placeholder="Овог Нэр"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Албан тушаал</Label>
              <Input
                value={form.position}
                onChange={(event) =>
                  setForm((c) => ({ ...c, position: event.target.value }))
                }
                placeholder="Нягтлан бодогч"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Үндсэн цалин</Label>
              <Input
                value={form.baseSalary}
                onChange={(event) =>
                  setForm((c) => ({ ...c, baseSalary: event.target.value }))
                }
                placeholder="1,500,000"
                className="font-mono"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>ҮОМШӨ %</Label>
              <Input
                value={form.accidentRatePercent}
                onChange={(event) =>
                  setForm((c) => ({
                    ...c,
                    accidentRatePercent: event.target.value,
                  }))
                }
                placeholder="0.8"
                className="font-mono"
              />
              <p className="text-xs text-[var(--ea-text-4)]">
                оффис 0.8 · барилга 1.5 · уул уурхай 2.5–3
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button onClick={save} disabled={isPending || !form.name.trim()}>
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
