"use client";

import { useNewParam } from "@/components/ui/use-new-param";

// Ажилтны бүртгэл — цалингийн бодолтын суурь лавлах.
// Мөр дээр ДАВХАР даралт = засварын dialog (нэг даралт нээхгүй — UI стандарт).
// Дэлгэрэнгүй бүртгэл: хувийн / хөдөлмөр / банк / цалин 4 бүлэг талбар;
// Excel загвар татах → бөглөх → импорт (РД таарвал шинэчилнэ) → экспорт
// round-trip нэг спекээр (lib/excel/specs.ts employeesSpec).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CellDoubleClickedEvent, ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { ExcelImportDialog } from "@/components/excel/excel-import-dialog";
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
import { FormField } from "@/components/ui/form-field";
import {
  importEmployees,
  toggleEmployee,
  upsertEmployee,
  type EmploymentType,
} from "@/lib/actions/payroll";
import { downloadTemplate, downloadWorkbook } from "@/lib/excel/core";
import {
  employeesSpec,
  employmentTypeLabelOf,
  type EmployeeImport,
} from "@/lib/excel/specs";
import { col } from "@/lib/grid/columnTypes";
import { SwitchCellRenderer } from "@/lib/grid/editors/SwitchCellRenderer";
import { parseMntInput } from "@/lib/grid/formatters";

export interface EmployeeRow {
  id: string;
  name: string;
  lastName: string;
  registerNo: string | null;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  homeAddress: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  iban: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  department: string;
  employmentType: string;
  position: string;
  baseSalary: number;
  employerSiPercent: number;
  /** ХЧТА тэтгэмжийн хувь — null бол тэтгэмж автоматаар бодогдохгүй. */
  sickBenefitPercent: number | null;
  isActive: boolean;
}

interface Props {
  rows: EmployeeRow[];
}

interface FormState {
  id?: string;
  lastName: string;
  name: string;
  registerNo: string;
  birthDate: string;
  phone: string;
  email: string;
  homeAddress: string;
  bankName: string;
  bankAccountNo: string;
  iban: string;
  hireDate: string;
  terminationDate: string;
  department: string;
  employmentType: EmploymentType;
  position: string;
  baseSalary: string;
  employerSiPercent: string;
  sickBenefitPercent: string;
}

const EMPTY_FORM: FormState = {
  lastName: "",
  name: "",
  registerNo: "",
  birthDate: "",
  phone: "",
  email: "",
  homeAddress: "",
  bankName: "",
  bankAccountNo: "",
  iban: "",
  hireDate: "",
  terminationDate: "",
  department: "",
  employmentType: "primary",
  position: "",
  baseSalary: "",
  employerSiPercent: "12.5",
  sickBenefitPercent: "",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Алдаа гарлаа";
}

/** Овог Нэр хэлбэрийн харагдац. */
const fullNameOf = (row: EmployeeRow) =>
  [row.lastName, row.name].filter(Boolean).join(" ");

/** Ажилласан жил — ажилд орсон огнооноос (гарсан бол тэр хүртэл) автоматаар. */
function yearsWorkedOf(row: EmployeeRow): string {
  if (!row.hireDate) return "—";
  const start = Date.parse(`${row.hireDate}T00:00:00Z`);
  const endDate = row.terminationDate ?? new Date().toISOString().slice(0, 10);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const years = (end - start) / (365.25 * 86_400_000);
  return `${years.toFixed(1)} жил`;
}

export function EmployeesView({ rows }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const spec = useMemo(() => employeesSpec(), []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setOpen(true);
  }
  // SIM2-032: «+ Шинэ» цэсийн «Лавлах» (?new=1).
  useNewParam(openCreate);

  function openEdit(row: EmployeeRow) {
    setForm({
      id: row.id,
      lastName: row.lastName,
      name: row.name,
      registerNo: row.registerNo ?? "",
      birthDate: row.birthDate ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      homeAddress: row.homeAddress ?? "",
      bankName: row.bankName ?? "",
      bankAccountNo: row.bankAccountNo ?? "",
      iban: row.iban ?? "",
      hireDate: row.hireDate ?? "",
      terminationDate: row.terminationDate ?? "",
      department: row.department,
      employmentType: (["primary", "contract", "hourly"].includes(
        row.employmentType
      )
        ? row.employmentType
        : "primary") as EmploymentType,
      position: row.position,
      baseSalary: row.baseSalary.toLocaleString("en-US"),
      employerSiPercent: String(row.employerSiPercent),
      sickBenefitPercent:
        row.sickBenefitPercent === null ? "" : String(row.sickBenefitPercent),
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
    const employerSiPercent = Number(form.employerSiPercent);
    // Хоосон = тохируулаагүй (null) — ХЧТА тэтгэмж автоматаар бодогдохгүй.
    const sickPercentRaw = form.sickBenefitPercent.trim();
    const sickBenefitPercent = sickPercentRaw === "" ? null : Number(sickPercentRaw);
    startTransition(async () => {
      try {
        const saved = await upsertEmployee({
          id: form.id,
          name: form.name,
          lastName: form.lastName || undefined,
          registerNo: form.registerNo || undefined,
          birthDate: form.birthDate || undefined,
          phone: form.phone || undefined,
          email: form.email || undefined,
          homeAddress: form.homeAddress || undefined,
          bankName: form.bankName || undefined,
          bankAccountNo: form.bankAccountNo || undefined,
          iban: form.iban || undefined,
          hireDate: form.hireDate || undefined,
          terminationDate: form.terminationDate || undefined,
          department: form.department || undefined,
          employmentType: form.employmentType,
          position: form.position || undefined,
          baseSalary: Number.isFinite(baseSalary) ? baseSalary : NaN,
          employerSiPercent,
          sickBenefitPercent,
        });
        if (saved.error !== undefined) {
          toast.error(saved.error);
          return;
        }
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
          next
            ? `${fullNameOf(row)} идэвхтэй боллоо`
            : `${fullNameOf(row)} идэвхгүй боллоо`
        );
        router.refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  async function handleImport(values: EmployeeImport[]) {
    try {
      const result = await importEmployees(values);
      if (result.error !== undefined) return result.error;
      const parts = [
        result.created > 0 ? `${result.created} шинээр бүртгэгдэв` : null,
        result.updated > 0 ? `${result.updated} шинэчлэгдэв` : null,
      ].filter(Boolean);
      if (result.errors.length > 0) {
        return `${parts.join(", ") || "Юу ч ороогүй"}. Алдаа: ${result.errors
          .slice(0, 3)
          .map((entry) => `${entry.index + 1}-р мөр — ${entry.message}`)
          .join("; ")}${result.errors.length > 3 ? " …" : ""}`;
      }
      toast.success(parts.join(", ") || "Өөрчлөлт ороогүй");
      router.refresh();
    } catch (error) {
      return errorMessage(error);
    }
  }

  function exportEmployees() {
    void downloadWorkbook({
      slug: "entry-employees",
      sheetName: "Ажилтнууд",
      columns: spec.columns.map((column) => ({
        header: column.header,
        width: column.key === "homeAddress" ? 30 : 16,
        kind:
          column.key === "baseSalary" || column.key === "employerSiPercent"
            ? "number"
            : "text",
      })),
      rows: rows.map((row) => [
        row.lastName,
        row.name,
        row.registerNo ?? "",
        row.position,
        row.department,
        employmentTypeLabelOf(row.employmentType),
        row.hireDate ?? "",
        row.baseSalary,
        row.employerSiPercent,
        row.bankName ?? "",
        row.bankAccountNo ?? "",
        row.iban ?? "",
        row.phone ?? "",
        row.email ?? "",
        row.homeAddress ?? "",
        row.birthDate ?? "",
        row.isActive ? "Тийм" : "Үгүй",
      ]),
    });
  }

  const columns = useMemo<ColDef<EmployeeRow>[]>(
    () => [
      {
        headerName: "Овог Нэр",
        colId: "fullName",
        minWidth: 170,
        flex: 1,
        valueGetter: (params) => (params.data ? fullNameOf(params.data) : ""),
      },
      col<EmployeeRow>({
        eaType: "readonly-text",
        headerName: "Регистр",
        field: "registerNo",
        width: 120,
        cellClass: "font-mono text-xs",
      }),
      col<EmployeeRow>({
        eaType: "readonly-text",
        headerName: "Албан тушаал",
        field: "position",
        minWidth: 130,
        cellClass: "text-xs text-[var(--ea-text-3)]",
      }),
      col<EmployeeRow>({
        eaType: "readonly-text",
        headerName: "Хэлтэс",
        field: "department",
        width: 110,
        cellClass: "text-xs text-[var(--ea-text-3)]",
      }),
      col<EmployeeRow>({
        eaType: "readonly-text",
        headerName: "Утас",
        field: "phone",
        width: 100,
        cellClass: "font-mono text-xs",
      }),
      {
        headerName: "Банк · Данс",
        colId: "bank",
        minWidth: 150,
        valueGetter: (params) =>
          params.data
            ? [params.data.bankName, params.data.bankAccountNo]
                .filter(Boolean)
                .join(" · ")
            : "",
        cellClass: "text-xs",
      },
      col<EmployeeRow>({
        eaType: "readonly-money",
        headerName: "Үндсэн цалин",
        field: "baseSalary",
        width: 130,
      }),
      {
        headerName: "Ажилласан",
        colId: "yearsWorked",
        width: 105,
        valueGetter: (params) =>
          params.data ? yearsWorkedOf(params.data) : "",
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Идэвхтэй",
        field: "isActive",
        width: 100,
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void downloadTemplate(spec)}
            title="Импортын загвар Excel файл татах"
          >
            <Icon name="download" size="sm" />
            Загвар
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <Icon name="upload" size="sm" />
            Excel импорт
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportEmployees}
            disabled={rows.length === 0}
          >
            <Icon name="download" size="sm" />
            Excel экспорт
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Icon name="add" size="sm" />
            Ажилтан
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Ажилтан бүртгэгдээгүй байна — «+ Ажилтан» товчоор эсвэл Excel
          импортоор нэмнэ.
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

      <ExcelImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        spec={spec}
        title="Ажилтан Excel-ээс импортлох"
        onImport={handleImport}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Ажилтны мэдээлэл засах" : "Ажилтан бүртгэх"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-5">
            <FormSection title="Хувийн мэдээлэл">
              <FormField label="Овог">
                <Input
                  value={form.lastName}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, lastName: event.target.value }))
                  }
                  placeholder="Бат"
                />
              </FormField>
              <FormField label="Нэр">
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, name: event.target.value }))
                  }
                  placeholder="Дорж"
                />
              </FormField>
              <FormField label="Регистрийн дугаар">
                <Input
                  value={form.registerNo}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, registerNo: event.target.value }))
                  }
                  placeholder="УК88010101"
                  className="font-mono"
                />
              </FormField>
              <FormField label="Төрсөн огноо">
                <Input
                  type="date"
                  value={form.birthDate}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, birthDate: event.target.value }))
                  }
                />
              </FormField>
              <FormField label="Утас">
                <Input
                  value={form.phone}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, phone: event.target.value }))
                  }
                  placeholder="99112233"
                />
              </FormField>
              <FormField label="И-мэйл">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, email: event.target.value }))
                  }
                  placeholder="dorj@company.mn"
                />
              </FormField>
              <FormField label="Гэрийн хаяг" className="sm:col-span-2">
                <Input
                  value={form.homeAddress}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, homeAddress: event.target.value }))
                  }
                  placeholder="БЗД, 26-р хороо ..."
                />
              </FormField>
            </FormSection>

            <FormSection title="Хөдөлмөрийн харилцаа">
              <FormField label="Албан тушаал">
                <Input
                  value={form.position}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, position: event.target.value }))
                  }
                  placeholder="Нягтлан бодогч"
                />
              </FormField>
              <FormField label="Хэлтэс">
                <Input
                  value={form.department}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, department: event.target.value }))
                  }
                  placeholder="Санхүү"
                />
              </FormField>
              <FormField label="Ажил эрхлэлт">
                <select
                  className="ea-form-select"
                  value={form.employmentType}
                  onChange={(event) =>
                    setForm((c) => ({
                      ...c,
                      employmentType: event.target.value as EmploymentType,
                    }))
                  }
                >
                  <option value="primary">Үндсэн</option>
                  <option value="contract">Гэрээт</option>
                  <option value="hourly">Цагийн</option>
                </select>
              </FormField>
              <FormField label="Ажилд орсон огноо">
                <Input
                  type="date"
                  value={form.hireDate}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, hireDate: event.target.value }))
                  }
                />
              </FormField>
              <FormField label="Гарсан огноо">
                <Input
                  type="date"
                  value={form.terminationDate}
                  onChange={(event) =>
                    setForm((c) => ({
                      ...c,
                      terminationDate: event.target.value,
                    }))
                  }
                />
              </FormField>
            </FormSection>

            <FormSection title="Банк">
              <FormField label="Банк">
                <Input
                  value={form.bankName}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, bankName: event.target.value }))
                  }
                  placeholder="Хаан банк"
                />
              </FormField>
              <FormField label="Дансны дугаар">
                <Input
                  value={form.bankAccountNo}
                  onChange={(event) =>
                    setForm((c) => ({
                      ...c,
                      bankAccountNo: event.target.value,
                    }))
                  }
                  placeholder="5041234567"
                  className="font-mono"
                />
              </FormField>
              <FormField label="IBAN" className="sm:col-span-2">
                <Input
                  value={form.iban}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, iban: event.target.value }))
                  }
                  placeholder="MN580005005041234567"
                  className="font-mono"
                />
              </FormField>
            </FormSection>

            <FormSection title="Цалин">
              <FormField label="Үндсэн цалин">
                <Input
                  value={form.baseSalary}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, baseSalary: event.target.value }))
                  }
                  placeholder="1,500,000"
                  className="font-mono"
                />
              </FormField>
              <FormField label="АО-НДШ %">
                <Input
                  value={form.employerSiPercent}
                  onChange={(event) =>
                    setForm((c) => ({
                      ...c,
                      employerSiPercent: event.target.value,
                    }))
                  }
                  placeholder="12.5"
                  className="font-mono"
                />
                <p className="text-xs text-[var(--ea-text-4)]">
                  Ажил олгогчийн нийт НДШ (ҮОМШӨ багтсан): оффис 12.5 ·
                  барилга 13.2 · уул уурхай 14.2–14.7. Ажилтны 11.5% тогтмол.
                </p>
              </FormField>
              <FormField label="ХЧТА тэтгэмжийн %">
                <Input
                  value={form.sickBenefitPercent}
                  onChange={(event) =>
                    setForm((c) => ({
                      ...c,
                      sickBenefitPercent: event.target.value,
                    }))
                  }
                  placeholder="Хоосон = автоматаар бодохгүй"
                  className="font-mono"
                />
                <p className="text-xs text-[var(--ea-text-4)]">
                  Хөдөлмөрийн чадвар түр алдалтын тэтгэмжийн хувь — НД-ын
                  шимтгэл төлсөн жилээс хамаарна. Хоосон бол цалингийн
                  бодолтод тэтгэмж АВТОМАТААР бодогдохгүй (хувийг зохиохгүй) —
                  дүнг тухайн сарын мөрөнд гараар оруулна.
                </p>
              </FormField>
            </FormSection>
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

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ea-text-3)]">
        {title}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

