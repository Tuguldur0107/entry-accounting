"use client";

// POS тохиргооны таб — docs/pos §3.1 (дансны рольууд), §3.4 (төлбөрийн
// хэлбэр), §3.5 (хөнгөлөлтийн дүрэм + симуляци). Дансны дугаар кодод байхгүй —
// бүгд `pos_settings`-ээс; энд ЗӨВХӨН хэрэглэгч засна.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { DiscountRuleDialog } from "@/components/pos/discount-rule-dialog";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { PageTabs, type TabOption } from "@/components/ui/tabs";
import {
  deleteDiscountRule,
  quotePosSale,
  savePaymentMethod,
  updatePosSettings,
  type SaleQuote,
} from "@/lib/actions/pos";
import type { CheckoutData } from "@/lib/pos/load-data";
import {
  DISCOUNT_RULE_TYPE_LABELS,
  DISCOUNT_SCOPE_LABELS,
  PAYMENT_KIND_LABELS,
  PAYMENT_KINDS,
  PAYMENT_KINDS_WITH_CASH_ACCOUNT,
  type PaymentKind,
} from "@/lib/pos/constants";
import type { DiscountRule, PaymentMethodView, PosSettingsView as PosSettings } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";
import { feedback } from "@/lib/ui/feedback";

export interface IssueTypeOption {
  id: string;
  code: string;
  name: string;
}

type SettingsSection = "general" | "methods" | "rules";

const SECTIONS: readonly TabOption<SettingsSection>[] = [
  { value: "general", label: "Ерөнхий" },
  { value: "methods", label: "Төлбөрийн хэлбэр" },
  { value: "rules", label: "Хөнгөлөлтийн дүрэм" },
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-[var(--ea-text-4)]">{hint}</p>}
    </div>
  );
}

function SwitchField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <Switch checked={checked} onCheckedChange={(value) => onChange(!!value)} className="mt-0.5" />
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-[11px] text-[var(--ea-text-4)]">{hint}</div>}
      </div>
    </div>
  );
}

const textareaClass =
  "min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function PosSettingsView({
  checkout,
  issueTypes,
}: {
  checkout: CheckoutData;
  issueTypes: IssueTypeOption[];
}) {
  const [section, setSection] = useState<SettingsSection>("general");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <PageTabs tabs={SECTIONS} value={section} onChange={setSection} />
      {section === "general" && (
        // Серверээс шинэ тохиргоо ирэхэд формыг цэвэрхэн remount хийнэ.
        <GeneralSettings key={JSON.stringify(checkout.settings)} checkout={checkout} issueTypes={issueTypes} />
      )}
      {section === "methods" && <PaymentMethodsSection methods={checkout.methods} cashAccounts={checkout.cashAccounts} />}
      {section === "rules" && <DiscountRulesSection checkout={checkout} />}
    </div>
  );
}

// ── Ерөнхий тохиргоо ─────────────────────────────────────────────────────────

const ACCOUNT_FIELDS: { key: keyof PosSettings; label: string; hint: string }[] = [
  { key: "revenueAccountNumber", label: "Борлуулалтын орлого", hint: "Барааны орлогын данс байхгүй үед" },
  { key: "discountAccountNumber", label: "Хөнгөлөлтийн данс (contra)", hint: "Зөвхөн contra горимд Dr" },
  { key: "giftCardLiabilityAccountNumber", label: "Бэлгийн картын өглөг", hint: "" },
  { key: "storeCreditLiabilityAccountNumber", label: "Дэлгүүрийн кредитийн өглөг", hint: "" },
  { key: "customerAdvanceAccountNumber", label: "Урьдчилгааны өглөг", hint: "" },
  { key: "cashOverAccountNumber", label: "Кассын илүү (орлого)", hint: "Ээлж хаалтын + зөрүү" },
  { key: "cashShortAccountNumber", label: "Кассын дутуу (зардал)", hint: "Ээлж хаалтын − зөрүү" },
  { key: "roundingAccountNumber", label: "Бөөрөнхийллийн данс", hint: "Бэлэн бөөрөнхийллийн зөрүү" },
];

function GeneralSettings({ checkout, issueTypes }: { checkout: CheckoutData; issueTypes: IssueTypeOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<PosSettings>(checkout.settings);
  const dirty = JSON.stringify(form) !== JSON.stringify(checkout.settings);
  const patch = (changes: Partial<PosSettings>) => setForm((current) => ({ ...current, ...changes }));

  const customerOptions = useMemo(
    () => checkout.customers.map((customer) => ({ value: customer.id, label: customer.name })),
    [checkout.customers]
  );

  function save() {
    startTransition(async () => {
      const result = await updatePosSettings(form);
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.saved("POS тохиргоо хадгалагдлаа");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">Дансны рольууд</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ACCOUNT_FIELDS.map((field) => (
            <Field key={field.key} label={field.label} hint={field.hint || "8 оронтой үндсэн данс"}>
              <Input
                value={String(form[field.key] ?? "")}
                maxLength={8}
                inputMode="numeric"
                className="font-mono"
                placeholder="XXXXXXXX"
                onChange={(e) => patch({ [field.key]: e.target.value.replace(/\D/g, "") } as Partial<PosSettings>)}
              />
            </Field>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">Бичилт ба хөнгөлөлт</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Хөнгөлөлтийн бичилт" hint="net — орлого цэвэр; contra — орлого бүтэн + Dr хөнгөлөлт">
            <select className="ea-form-select" value={form.discountPosting} onChange={(e) => patch({ discountPosting: e.target.value as "net" | "contra" })}>
              <option value="net">Цэвэр (net)</option>
              <option value="contra">Contra данс</option>
            </select>
          </Field>
          <Field label="Давхцах бодлого" hint="best_single — хамгийн ашигтай нэг; cumulative — stackable нийлнэ">
            <select className="ea-form-select" value={form.discountStacking} onChange={(e) => patch({ discountStacking: e.target.value as "best_single" | "cumulative" })}>
              <option value="best_single">Хамгийн ашигтай нэг</option>
              <option value="cumulative">Нийлүүлнэ</option>
            </select>
          </Field>
          <Field label="Гар хөнгөлөлтийн дээд %" hint="Дээш бол менежерийн зөвшөөрөл (pos:post)">
            <Input type="number" min="0" max="100" value={form.maxManualDiscountPercent} className="font-mono text-right" onChange={(e) => patch({ maxManualDiscountPercent: Number(e.target.value) })} />
          </Field>
          <Field label="Нийт хөнгөлөлтийн тааз %">
            <Input type="number" min="0" max="100" value={form.maxTotalDiscountPercent} className="font-mono text-right" onChange={(e) => patch({ maxTotalDiscountPercent: Number(e.target.value) })} />
          </Field>
          <Field label="Бэлэн бөөрөнхийлөл" hint="Зөвхөн бэлэн (₮) төлөх хэсэгт">
            <select className="ea-form-select" value={form.cashRoundingUnit} onChange={(e) => patch({ cashRoundingUnit: Number(e.target.value) })}>
              <option value={0}>Бөөрөнхийлөхгүй</option>
              <option value={10}>10 ₮</option>
              <option value={100}>100 ₮</option>
            </select>
          </Field>
          <Field label="Анхдагч агуулах">
            <select className="ea-form-select" value={form.defaultWarehouseId ?? ""} onChange={(e) => patch({ defaultWarehouseId: e.target.value || null })}>
              <option value="">— Ээлжийнхээр —</option>
              {checkout.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} · {warehouse.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Зарлагын төрөл (COGS чиглэл)">
            <select className="ea-form-select" value={form.issueTypeId ?? ""} onChange={(e) => patch({ issueTypeId: e.target.value || null })}>
              <option value="">— Анхдагч —</option>
              {issueTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.code} · {type.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Бэлэн худалдан авагч">
            <SearchableSelect
              value={form.walkInCounterpartyId ?? ""}
              onChange={(value) => patch({ walkInCounterpartyId: value || null })}
              options={customerOptions}
              hideValue
              placeholder="Харилцагч сонгох…"
            />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-6">
          <SwitchField
            label="Урьдчилсан COGS"
            hint="Борлуулалтын мөчид явцын дунджаар Dr COGS / Cr Бараа; сар хаалтад залруулна"
            checked={form.provisionalCogs}
            onChange={(v) => patch({ provisionalCogs: v })}
          />
          <SwitchField
            label="Хасах үлдэгдэлд борлуулахыг зөвшөөрөх"
            hint="Улбар шар анхааруулгатай, борлуулалт зогсохгүй (D9)"
            checked={form.allowNegativeStock}
            onChange={(v) => patch({ allowNegativeStock: v })}
          />
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">Баримт (80мм)</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Толгой" hint="Компанийн нэр, хаяг, утас, РД — мөр бүр шинэ мөрөнд">
            <textarea className={textareaClass} rows={4} value={form.receiptHeader} onChange={(e) => patch({ receiptHeader: e.target.value })} />
          </Field>
          <Field label="Хөл" hint="Талархал, буцаалтын нөхцөл г.м.">
            <textarea className={textareaClass} rows={4} value={form.receiptFooter} onChange={(e) => patch({ receiptFooter: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--ea-border)] pt-3">
        <Button variant="outline" onClick={() => setForm(checkout.settings)} disabled={!dirty || isPending}>
          Буцаах
        </Button>
        <Button onClick={save} disabled={!dirty || isPending}>
          <Icon name="save" size="sm" />
          Хадгалах
        </Button>
      </div>
    </div>
  );
}

// ── Төлбөрийн хэлбэр ─────────────────────────────────────────────────────────

function PaymentMethodsSection({
  methods,
  cashAccounts,
}: {
  methods: PaymentMethodView[];
  cashAccounts: CheckoutData["cashAccounts"];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PaymentMethodView | null | "new">(null);

  const columns = useMemo<ColDef<PaymentMethodView>[]>(
    () => [
      { headerName: "Код", field: "code", width: 100, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 160, flex: 1 },
      {
        headerName: "Төрөл",
        field: "kind",
        width: 190,
        valueFormatter: (p) => PAYMENT_KIND_LABELS[p.value as PaymentKind] ?? String(p.value ?? ""),
      },
      { headerName: "Касс / данс", field: "cashAccountName", minWidth: 150, flex: 1, valueFormatter: (p) => String(p.value ?? "—") },
      { headerName: "Валют", field: "currency", width: 80, cellClass: "font-mono text-xs" },
      {
        headerName: "Лавлах",
        field: "requiresReference",
        width: 90,
        cellClass: "ag-center-cell text-xs",
        valueFormatter: (p) => (p.value ? "заавал" : ""),
      },
      {
        headerName: "Хариулт",
        field: "allowsChange",
        width: 90,
        cellClass: "ag-center-cell text-xs",
        valueFormatter: (p) => (p.value ? "✓" : ""),
      },
      {
        headerName: "Буцаалт",
        field: "allowsRefund",
        width: 90,
        cellClass: "ag-center-cell text-xs",
        valueFormatter: (p) => (p.value ? "✓" : ""),
      },
      {
        headerName: "Шимтгэл %",
        field: "feePercent",
        width: 100,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => (p.value == null ? "" : String(p.value)),
      },
      { headerName: "Эрэмбэ", field: "sortOrder", width: 90, cellClass: "ag-right-aligned-cell font-mono text-xs", headerClass: "ag-right-aligned-header" },
      {
        headerName: "Статус",
        field: "isActive",
        width: 110,
        cellRenderer: (p: ICellRendererParams<PaymentMethodView>) =>
          p.data ? (
            <span className="flex h-full items-center">
              <StatusBadge tone={p.data.isActive ? "success" : "muted"} size="sm">
                {p.data.isActive ? "Идэвхтэй" : "Идэвхгүй"}
              </StatusBadge>
            </span>
          ) : null,
      },
    ],
    []
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--ea-text-3)]">
          `kind` бүртгэлийн замыг шийднэ; байгууллага өөрийн нэр/дансаар олон мөр үүсгэнэ. Давхар даралт → засах.
        </p>
        <Button onClick={() => setEditing("new")}>
          <Icon name="add" size="sm" />
          Хэлбэр нэмэх
        </Button>
      </div>
      {methods.length === 0 ? (
        <EmptyState icon="cash" title="Төлбөрийн хэлбэр алга" description="Бэлэн, карт, QPay… хэлбэрүүдээ бүртгэнэ үү." />
      ) : (
        <DataGridDynamic<PaymentMethodView>
          rowData={methods}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height={Math.min(480, 120 + methods.length * 38)}
          wrapperClassName="ea-clickable-rows rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onCellDoubleClicked={(event) => {
            if (event.data) setEditing(event.data);
          }}
        />
      )}
      <PaymentMethodDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        method={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        cashAccounts={cashAccounts}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

interface MethodForm {
  code: string;
  name: string;
  kind: PaymentKind;
  cashAccountId: string;
  requiresReference: boolean;
  allowsChange: boolean;
  allowsRefund: boolean;
  feePercent: string;
  sortOrder: string;
  isActive: boolean;
}

function toMethodForm(method: PaymentMethodView | null): MethodForm {
  return {
    code: method?.code ?? "",
    name: method?.name ?? "",
    kind: method?.kind ?? "cash",
    cashAccountId: method?.cashAccountId ?? "",
    requiresReference: method?.requiresReference ?? false,
    allowsChange: method?.allowsChange ?? true,
    allowsRefund: method?.allowsRefund ?? true,
    feePercent: method?.feePercent == null ? "" : String(method.feePercent),
    sortOrder: String(method?.sortOrder ?? 0),
    isActive: method?.isActive ?? true,
  };
}

function PaymentMethodDialog({
  method,
  open,
  onOpenChange,
  cashAccounts,
  onSaved,
}: {
  method: PaymentMethodView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cashAccounts: CheckoutData["cashAccounts"];
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  // Нээх бүрд эцэг `key`-ээр remount хийдэг тул initializer хангалттай.
  const [form, setForm] = useState<MethodForm>(() => toMethodForm(method));
  const patch = (changes: Partial<MethodForm>) => setForm((current) => ({ ...current, ...changes }));
  const needsAccount = PAYMENT_KINDS_WITH_CASH_ACCOUNT.includes(form.kind);
  const accountOptions = cashAccounts.filter((account) =>
    form.kind === "cash" ? account.currency === "MNT" : form.kind === "cash_fx" ? account.currency !== "MNT" : true
  );

  function submit() {
    startTransition(async () => {
      const result = await savePaymentMethod({
        id: method?.id ?? null,
        code: form.code,
        name: form.name,
        kind: form.kind,
        cashAccountId: needsAccount ? form.cashAccountId || null : null,
        requiresReference: form.requiresReference,
        allowsChange: form.kind === "cash" ? form.allowsChange : false,
        allowsRefund: form.allowsRefund,
        feePercent: form.feePercent.trim() === "" ? null : Number(form.feePercent),
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(method ? "Төлбөрийн хэлбэр шинэчлэгдлээ" : "Төлбөрийн хэлбэр нэмэгдлээ");
      onOpenChange(false);
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{method ? `Хэлбэр засах — ${method.code}` : "Шинэ төлбөрийн хэлбэр"}</DialogTitle>
          <DialogDescription>Мөнгө хүлээн авах касс/банк/түр данс нь төрлөөс хамаарна (§3.4).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Код">
            <Input value={form.code} className="font-mono uppercase" onChange={(e) => patch({ code: e.target.value })} />
          </Field>
          <Field label="Нэр">
            <Input value={form.name} placeholder="Хаан банк терминал" onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Төрөл (kind)">
            <select className="ea-form-select" value={form.kind} onChange={(e) => patch({ kind: e.target.value as PaymentKind, cashAccountId: "" })}>
              {PAYMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {PAYMENT_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </Field>
          {needsAccount && (
            <Field label="Касс / банк / түр данс" hint="Валют нь дансаас ирнэ">
              <select className="ea-form-select" value={form.cashAccountId} onChange={(e) => patch({ cashAccountId: e.target.value })}>
                <option value="">— Сонгох —</option>
                {accountOptions.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.currency}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Шимтгэл % (мэдээлэл)">
            <Input type="number" min="0" step="0.01" value={form.feePercent} className="font-mono text-right" onChange={(e) => patch({ feePercent: e.target.value })} />
          </Field>
          <Field label="Эрэмбэ">
            <Input type="number" value={form.sortOrder} className="font-mono text-right" onChange={(e) => patch({ sortOrder: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <SwitchField label="Лавлах дугаар заавал" checked={form.requiresReference} onChange={(v) => patch({ requiresReference: v })} />
          {form.kind === "cash" && (
            <SwitchField label="Хариулт өгнө" checked={form.allowsChange} onChange={(v) => patch({ allowsChange: v })} />
          )}
          <SwitchField label="Буцаалтад ашиглана" checked={form.allowsRefund} onChange={(v) => patch({ allowsRefund: v })} />
          <SwitchField label="Идэвхтэй" checked={form.isActive} onChange={(v) => patch({ isActive: v })} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Болих
          </Button>
          <Button onClick={submit} disabled={isPending}>
            <Icon name="save" size="sm" />
            Хадгалах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Хөнгөлөлтийн дүрэм + симуляци ────────────────────────────────────────────

function DiscountRulesSection({ checkout }: { checkout: CheckoutData }) {
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<DiscountRule | null | "new">(null);

  async function remove(rule: DiscountRule) {
    const ok = await confirm({
      title: "Дүрэм устгах",
      description: `${rule.code} · ${rule.name} — ашиглагдсан бол идэвхгүй болно, эс бол устана.`,
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteDiscountRule(rule.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${rule.code} устгагдлаа`);
      router.refresh();
    });
  }

  const columns = useMemo<ColDef<DiscountRule>[]>(
    () => [
      { headerName: "Код", field: "code", width: 110, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 160, flex: 1 },
      {
        headerName: "Төрөл",
        field: "ruleType",
        width: 170,
        valueFormatter: (p) => DISCOUNT_RULE_TYPE_LABELS[p.value as keyof typeof DISCOUNT_RULE_TYPE_LABELS] ?? String(p.value ?? ""),
      },
      {
        headerName: "Хамрах хүрээ",
        colId: "scope",
        width: 180,
        valueGetter: (p) =>
          p.data ? `${DISCOUNT_SCOPE_LABELS[p.data.scope]}${p.data.scopeRef ? ` · ${p.data.scopeRef}` : ""}` : "",
        cellClass: "text-xs",
      },
      {
        headerName: "Утга",
        colId: "value",
        width: 110,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueGetter: (p) => {
          const rule = p.data;
          if (!rule) return "";
          if (rule.ruleType === "buy_x_get_y") return `${rule.buyQty ?? 0}+${rule.getQty ?? 0}`;
          if (rule.ruleType === "qty_tier") return `${rule.tiers?.length ?? 0} шат`;
          return rule.valueType === "percent" ? `${rule.value}%` : fmtMnt(rule.value);
        },
      },
      {
        headerName: "Хугацаа",
        colId: "window",
        width: 180,
        cellClass: "font-mono text-[11px]",
        valueGetter: (p) => {
          const rule = p.data;
          if (!rule) return "";
          const parts: string[] = [];
          if (rule.dateFrom || rule.dateTo) parts.push(`${rule.dateFrom ?? "…"}→${rule.dateTo ?? "…"}`);
          if (rule.timeFrom || rule.timeTo) parts.push(`${rule.timeFrom ?? ""}–${rule.timeTo ?? ""}`);
          if (rule.weekdays) parts.push(`гараг ${rule.weekdays}`);
          return parts.join(" ");
        },
      },
      { headerName: "Купон", field: "couponCode", width: 110, cellClass: "font-mono text-xs", valueFormatter: (p) => String(p.value ?? "") },
      {
        headerName: "Хэрэглээ",
        field: "usedCount",
        width: 90,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
      },
      { headerName: "Priority", field: "priority", width: 90, cellClass: "ag-right-aligned-cell font-mono text-xs", headerClass: "ag-right-aligned-header" },
      {
        headerName: "Статус",
        colId: "status",
        width: 170,
        cellRenderer: (p: ICellRendererParams<DiscountRule>) =>
          p.data ? (
            <span className="flex h-full items-center gap-1">
              <StatusBadge tone={p.data.isActive ? "success" : "muted"} size="sm">
                {p.data.isActive ? "Идэвхтэй" : "Идэвхгүй"}
              </StatusBadge>
              {p.data.stackable && (
                <StatusBadge tone="muted" size="sm">
                  давхцана
                </StatusBadge>
              )}
              {p.data.requiresApproval && (
                <StatusBadge tone="warning" size="sm">
                  зөвшөөрөл
                </StatusBadge>
              )}
            </span>
          ) : null,
      },
      {
        headerName: "",
        colId: "actions",
        width: 60,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        cellRenderer: (p: ICellRendererParams<DiscountRule>) =>
          p.data ? (
            <button
              type="button"
              className="ea-btn ea-btn--icon ea-btn--danger"
              title="Устгах"
              aria-label="Устгах"
              onClick={() => void remove(p.data!)}
            >
              <Icon name="delete" />
            </button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--ea-text-3)]">Давхар даралт → засах. Ашиглагдсан дүрэм устгахад идэвхгүй болно.</p>
        <Button onClick={() => setEditing("new")} disabled={isPending}>
          <Icon name="add" size="sm" />
          Дүрэм нэмэх
        </Button>
      </div>
      {checkout.rules.length === 0 ? (
        <EmptyState icon="tune" title="Хөнгөлөлтийн дүрэм алга" description="Мөрийн %, урамшууллын үнэ, N+M, купон, харилцагчийн бүлэг… дүрмүүдээ бүртгэнэ үү." />
      ) : (
        <DataGridDynamic<DiscountRule>
          rowData={checkout.rules}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height={Math.min(480, 120 + checkout.rules.length * 38)}
          wrapperClassName="ea-clickable-rows rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onCellDoubleClicked={(event) => {
            if (event.column.getColId() === "actions") return;
            if (event.data) setEditing(event.data);
          }}
        />
      )}
      <DiscountRuleDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        rule={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        items={checkout.items}
        onSaved={() => router.refresh()}
      />
      <DiscountSimulation checkout={checkout} />
      {confirmDialog}
    </div>
  );
}

interface SimLine {
  itemId: string;
  quantity: string;
}

function DiscountSimulation({ checkout }: { checkout: CheckoutData }) {
  const [lines, setLines] = useState<SimLine[]>([{ itemId: "", quantity: "1" }]);
  const [customerId, setCustomerId] = useState("");
  const [coupon, setCoupon] = useState("");
  const [quote, setQuote] = useState<SaleQuote | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const itemOptions = useMemo(
    () => checkout.items.map((item) => ({ value: item.code, label: item.name })),
    [checkout.items]
  );
  const customerOptions = useMemo(
    () => checkout.customers.map((customer) => ({ value: customer.id, label: customer.name, hint: customer.customerGroup ?? undefined })),
    [checkout.customers]
  );

  function run() {
    const inputs = lines
      .filter((line) => line.itemId && Number(line.quantity) > 0)
      .map((line) => ({ itemId: line.itemId, quantity: Number(line.quantity) }));
    if (inputs.length === 0) return toast.error("Дор хаяж нэг бараа сонгоно уу");
    setError("");
    startTransition(async () => {
      const result = await quotePosSale({
        counterpartyId: customerId || null,
        lines: inputs,
        couponCodes: coupon.trim() ? [coupon.trim().toUpperCase()] : [],
      });
      if (result.error || !result.quote) {
        setError(result.error ?? "Үнийн санал тооцогдсонгүй");
        setQuote(null);
        return;
      }
      setQuote(result.quote);
    });
  }

  return (
    <div className="rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface)] p-3">
      <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">Симуляци</div>
      <p className="mb-3 text-xs text-[var(--ea-text-3)]">
        Сагс оруулж дүрмүүдийн үр дүнг урьдчилан харна — борлуулалттай ЯГ ижил хөдөлгөгч, одоогийн огноо/цагаар.
      </p>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_100px_auto] items-center gap-2">
              <SearchableSelect
                value={checkout.items.find((item) => item.id === line.itemId)?.code ?? ""}
                onChange={(code) =>
                  setLines((current) =>
                    current.map((entry, i) =>
                      i === index ? { ...entry, itemId: checkout.items.find((item) => item.code === code)?.id ?? "" } : entry
                    )
                  )
                }
                options={itemOptions}
                placeholder="Бараа…"
              />
              <Input
                type="number"
                min="0"
                value={line.quantity}
                className="font-mono text-right"
                onChange={(e) =>
                  setLines((current) => current.map((entry, i) => (i === index ? { ...entry, quantity: e.target.value } : entry)))
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                disabled={lines.length === 1}
                onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                aria-label="Мөр хасах"
              >
                <Icon name="close" size="sm" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={lines.length >= 3}
              onClick={() => setLines((current) => [...current, { itemId: "", quantity: "1" }])}
            >
              <Icon name="add" size="sm" />
              Мөр (≤3)
            </Button>
            <div className="w-56">
              <SearchableSelect value={customerId} onChange={setCustomerId} options={customerOptions} hideValue placeholder="Бэлэн худалдан авагч" />
            </div>
            <Input value={coupon} placeholder="Купон" className="w-36 font-mono uppercase" onChange={(e) => setCoupon(e.target.value)} />
            <Button size="sm" type="button" onClick={run} disabled={isPending}>
              <Icon name="approve" size="sm" />
              Тооцох
            </Button>
          </div>
          {error && <p className="text-xs text-[var(--ea-danger-fg)]">{error}</p>}
        </div>
        <div className="rounded-md bg-[var(--ea-bg)] p-3 text-sm">
          {!quote ? (
            <p className="text-xs text-[var(--ea-text-4)]">Үр дүн энд харагдана.</p>
          ) : (
            <div className="space-y-1">
              {quote.lines.map((line, index) => (
                <div key={index} className="border-b border-[var(--ea-border)] pb-1 text-xs">
                  <div className="flex justify-between">
                    <span className="truncate">{line.itemName} × {line.quantity}</span>
                    <span className="font-mono">{fmtMnt(line.lineTotal)}</span>
                  </div>
                  {line.discountDetail.map((detail, i) => (
                    <div key={i} className="flex justify-between pl-2 text-[var(--ea-text-3)]">
                      <span>{detail.ruleCode ?? detail.kind}</span>
                      <span className="font-mono">−{fmtMnt(detail.amount)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="flex justify-between text-xs">
                <span>Нийт (хөнг. өмнө)</span>
                <span className="font-mono">{fmtMnt(quote.grossAmount)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>Хөнгөлөлт</span>
                <span className="font-mono">−{fmtMnt(quote.discountTotal)}</span>
              </div>
              {quote.isVatPayer && (
                <div className="flex justify-between text-xs">
                  <span>НӨАТ</span>
                  <span className="font-mono">{fmtMnt(quote.vatAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <span>Төлөх</span>
                <span className="font-mono">{fmtMnt(quote.total)}</span>
              </div>
              {quote.approvalReasons.length > 0 && (
                <ul className="pt-1 text-[11px] text-[var(--ea-warning-fg)]">
                  {quote.approvalReasons.map((reason, i) => (
                    <li key={i}>• {reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
