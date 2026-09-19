"use client";

// Хөнгөлөлтийн дүрмийн нэмэх/засах диалог — docs/pos §3.5. Талбарууд
// `ruleType`-аас хамаарч солигдоно: утга (хувь / ₮ / урамшууллын үнэ),
// хамрах хүрээ (бүх / бүлэг / бараа / харилцагчийн бүлэг), шатлал (qty_tier),
// N/M (buy_x_get_y), купоны код + хязгаар, огноо/цаг/гарагийн цонх.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { saveDiscountRule } from "@/lib/actions/pos";
import {
  DISCOUNT_RULE_TYPE_LABELS,
  DISCOUNT_RULE_TYPES,
  DISCOUNT_SCOPE_LABELS,
  DISCOUNT_SCOPES,
  type DiscountRuleType,
  type DiscountScope,
  type DiscountValueType,
} from "@/lib/pos/constants";
import type { CheckoutItem } from "@/lib/pos/load-data";
import type { DiscountRule } from "@/lib/pos/types";

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Да" },
  { value: 2, label: "Мя" },
  { value: 3, label: "Лх" },
  { value: 4, label: "Пү" },
  { value: 5, label: "Ба" },
  { value: 6, label: "Бя" },
  { value: 7, label: "Ня" },
];

interface TierRow {
  minQty: string;
  mode: "percent" | "price";
  value: string;
}

interface RuleForm {
  code: string;
  name: string;
  ruleType: DiscountRuleType;
  scope: DiscountScope;
  scopeRef: string;
  valueType: DiscountValueType;
  value: string;
  minQty: string;
  minAmount: string;
  buyQty: string;
  getQty: string;
  tiers: TierRow[];
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  weekdays: number[];
  couponCode: string;
  maxUsesTotal: string;
  maxUsesPerCustomer: string;
  stackable: boolean;
  priority: string;
  requiresApproval: boolean;
  isActive: boolean;
}

const numberOrEmpty = (value: number | null | undefined) => (value == null ? "" : String(value));

function toForm(rule: DiscountRule | null): RuleForm {
  return {
    code: rule?.code ?? "",
    name: rule?.name ?? "",
    ruleType: rule?.ruleType ?? "line_percent",
    scope: rule?.scope ?? "all",
    scopeRef: rule?.scopeRef ?? "",
    valueType: rule?.valueType ?? "percent",
    value: numberOrEmpty(rule?.value),
    minQty: numberOrEmpty(rule?.minQty),
    minAmount: numberOrEmpty(rule?.minAmount),
    buyQty: numberOrEmpty(rule?.buyQty),
    getQty: numberOrEmpty(rule?.getQty),
    tiers: (rule?.tiers ?? []).map((tier) => ({
      minQty: String(tier.minQty),
      mode: tier.price != null ? "price" : "percent",
      value: String(tier.price ?? tier.percent ?? ""),
    })),
    dateFrom: rule?.dateFrom ?? "",
    dateTo: rule?.dateTo ?? "",
    timeFrom: rule?.timeFrom ?? "",
    timeTo: rule?.timeTo ?? "",
    weekdays: (rule?.weekdays ?? "")
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((entry) => entry >= 1 && entry <= 7),
    couponCode: rule?.couponCode ?? "",
    maxUsesTotal: numberOrEmpty(rule?.maxUsesTotal),
    maxUsesPerCustomer: numberOrEmpty(rule?.maxUsesPerCustomer),
    stackable: rule?.stackable ?? false,
    priority: String(rule?.priority ?? 100),
    requiresApproval: rule?.requiresApproval ?? false,
    isActive: rule?.isActive ?? true,
  };
}

const optionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));

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
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Switch checked={checked} onCheckedChange={(value) => onChange(!!value)} />
      {label}
    </label>
  );
}

export function DiscountRuleDialog({
  rule,
  open,
  onOpenChange,
  items,
  onSaved,
}: {
  /** null = шинэ дүрэм. */
  rule: DiscountRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CheckoutItem[];
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  // Нээх бүрд эцэг `key`-ээр remount хийдэг тул initializer хангалттай.
  const [form, setForm] = useState<RuleForm>(() => toForm(rule));

  const patch = (changes: Partial<RuleForm>) => setForm((current) => ({ ...current, ...changes }));

  const type = form.ruleType;
  const showValue = !["qty_tier", "buy_x_get_y"].includes(type);
  const isFixedPrice = type === "fixed_price";
  const isCoupon = type === "coupon";
  const isTier = type === "qty_tier";
  const isBogo = type === "buy_x_get_y";
  const isBasket = type === "basket_threshold";
  const isTimeWindow = type === "time_window";
  const isCustomerGroup = type === "customer_group";

  const itemOptions = items.map((item) => ({ value: item.code, label: item.name, hint: item.id }));
  // scope=item → scopeRef нь барааны ID (сервер шалгана); сонгогч кодоор харуулна.
  const selectedItemCode = items.find((item) => item.id === form.scopeRef)?.code ?? "";

  function submit() {
    if (!form.code.trim()) return toast.error("Код оруулна уу");
    if (!form.name.trim()) return toast.error("Нэр оруулна уу");
    const tiers = isTier
      ? form.tiers
          .filter((tier) => tier.minQty.trim() !== "" && tier.value.trim() !== "")
          .map((tier) =>
            tier.mode === "price"
              ? { minQty: Number(tier.minQty), price: Number(tier.value) }
              : { minQty: Number(tier.minQty), percent: Number(tier.value) }
          )
      : null;
    startTransition(async () => {
      const result = await saveDiscountRule({
        id: rule?.id ?? undefined,
        code: form.code,
        name: form.name,
        ruleType: form.ruleType,
        scope: isCustomerGroup ? "customer_group" : form.scope,
        scopeRef: form.scopeRef.trim() || null,
        valueType: isFixedPrice ? "fixed_price" : form.valueType,
        value: showValue ? Number(form.value) || 0 : 0,
        minQty: optionalNumber(form.minQty),
        minAmount: optionalNumber(form.minAmount),
        buyQty: isBogo ? optionalNumber(form.buyQty) : null,
        getQty: isBogo ? optionalNumber(form.getQty) : null,
        tiers,
        dateFrom: form.dateFrom || null,
        dateTo: form.dateTo || null,
        timeFrom: form.timeFrom || null,
        timeTo: form.timeTo || null,
        weekdays: form.weekdays.length ? [...form.weekdays].sort().join(",") : null,
        couponCode: isCoupon ? form.couponCode.trim() || null : null,
        maxUsesTotal: isCoupon ? optionalNumber(form.maxUsesTotal) : null,
        maxUsesPerCustomer: isCoupon ? optionalNumber(form.maxUsesPerCustomer) : null,
        stackable: form.stackable,
        priority: Number(form.priority) || 100,
        requiresApproval: form.requiresApproval,
        isActive: form.isActive,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(rule ? "Дүрэм шинэчлэгдлээ" : "Дүрэм үүслээ");
      onOpenChange(false);
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? `Дүрэм засах — ${rule.code}` : "Шинэ хөнгөлөлтийн дүрэм"}</DialogTitle>
          <DialogDescription>
            Дараалал: урамшууллын үнэ → мөрийн дүрэм (priority) → N+M → харилцагчийн бүлэг → купон → сагсны босго → гар.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Код">
            <Input value={form.code} className="font-mono uppercase" disabled={!!rule} onChange={(e) => patch({ code: e.target.value })} />
          </Field>
          <Field label="Нэр">
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Дүрмийн төрөл">
            <select
              className="ea-form-select"
              value={form.ruleType}
              onChange={(e) => {
                const next = e.target.value as DiscountRuleType;
                patch({
                  ruleType: next,
                  scope: next === "customer_group" ? "customer_group" : next === "fixed_price" ? "item" : form.scope,
                  valueType: next === "fixed_price" ? "fixed_price" : next === "line_amount" ? "amount" : form.valueType === "fixed_price" ? "percent" : form.valueType,
                });
              }}
            >
              {DISCOUNT_RULE_TYPES.map((entry) => (
                <option key={entry} value={entry}>
                  {DISCOUNT_RULE_TYPE_LABELS[entry]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Давуу эрэмбэ (priority)" hint="Бага тоо түрүүлж ажиллана">
            <Input type="number" value={form.priority} className="font-mono" onChange={(e) => patch({ priority: e.target.value })} />
          </Field>

          {!isCustomerGroup && (
            <Field label="Хамрах хүрээ">
              <select
                className="ea-form-select"
                value={form.scope}
                onChange={(e) => patch({ scope: e.target.value as DiscountScope, scopeRef: "" })}
              >
                {DISCOUNT_SCOPES.filter((scope) => scope !== "customer_group" || !isBasket).map((scope) => (
                  <option key={scope} value={scope}>
                    {DISCOUNT_SCOPE_LABELS[scope]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(isCustomerGroup || form.scope === "customer_group") && (
            <Field label="Харилцагчийн бүлэг" hint="Харилцагчийн картын «Хөнгөлөлтийн бүлэг» талбартай ЯГ таарна (VIP, ажилтан…)">
              <Input value={form.scopeRef} onChange={(e) => patch({ scopeRef: e.target.value })} />
            </Field>
          )}
          {!isCustomerGroup && form.scope === "category" && (
            <Field label="Барааны бүлгийн код">
              <Input value={form.scopeRef} className="font-mono" onChange={(e) => patch({ scopeRef: e.target.value })} />
            </Field>
          )}
          {!isCustomerGroup && form.scope === "item" && (
            <Field label="Бараа">
              <SearchableSelect
                value={selectedItemCode}
                onChange={(code) => patch({ scopeRef: items.find((item) => item.code === code)?.id ?? "" })}
                options={itemOptions}
                placeholder="Бараа сонгох…"
              />
            </Field>
          )}

          {showValue && (
            <>
              {!isFixedPrice && (
                <Field label="Утгын төрөл">
                  <select
                    className="ea-form-select"
                    value={form.valueType}
                    onChange={(e) => patch({ valueType: e.target.value as DiscountValueType })}
                  >
                    <option value="percent">Хувь (%)</option>
                    <option value="amount">Дүн (₮)</option>
                  </select>
                </Field>
              )}
              <Field label={isFixedPrice ? "Урамшууллын үнэ (₮)" : form.valueType === "percent" ? "Хувь (%)" : "Дүн (₮)"}>
                <Input type="number" min="0" value={form.value} className="font-mono text-right" onChange={(e) => patch({ value: e.target.value })} />
              </Field>
            </>
          )}

          {isBogo && (
            <>
              <Field label="N авбал (buyQty)">
                <Input type="number" min="1" value={form.buyQty} className="font-mono" onChange={(e) => patch({ buyQty: e.target.value })} />
              </Field>
              <Field label="M үнэгүй (getQty)">
                <Input type="number" min="1" value={form.getQty} className="font-mono" onChange={(e) => patch({ getQty: e.target.value })} />
              </Field>
            </>
          )}

          {!isBogo && !isTier && (
            <Field label="Доод тоо (minQty)">
              <Input type="number" min="0" value={form.minQty} className="font-mono" onChange={(e) => patch({ minQty: e.target.value })} />
            </Field>
          )}
          <Field label={isBasket ? "Сагсны босго (₮)" : "Доод дүн (minAmount)"}>
            <Input type="number" min="0" value={form.minAmount} className="font-mono" onChange={(e) => patch({ minAmount: e.target.value })} />
          </Field>

          {isCoupon && (
            <>
              <Field label="Купоны код">
                <Input value={form.couponCode} className="font-mono uppercase" onChange={(e) => patch({ couponCode: e.target.value })} />
              </Field>
              <Field label="Нийт хэрэглээний хязгаар">
                <Input type="number" min="0" value={form.maxUsesTotal} className="font-mono" onChange={(e) => patch({ maxUsesTotal: e.target.value })} />
              </Field>
              <Field label="Харилцагч бүрийн хязгаар">
                <Input type="number" min="0" value={form.maxUsesPerCustomer} className="font-mono" onChange={(e) => patch({ maxUsesPerCustomer: e.target.value })} />
              </Field>
            </>
          )}
        </div>

        {isTier && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Шатлал (minQty → % эсвэл үнэ)</Label>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => patch({ tiers: [...form.tiers, { minQty: "", mode: "percent", value: "" }] })}
              >
                <Icon name="add" size="sm" />
                Мөр нэмэх
              </Button>
            </div>
            {form.tiers.length === 0 && (
              <p className="text-xs text-[var(--ea-text-3)]">Жишээ: 1ш 0% · 10ш 5% · 50ш 10%</p>
            )}
            <div className="space-y-1.5">
              {form.tiers.map((tier, index) => (
                <div key={index} className="grid grid-cols-[1fr_120px_1fr_auto] items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    placeholder="Доод тоо"
                    value={tier.minQty}
                    className="font-mono"
                    onChange={(e) =>
                      patch({ tiers: form.tiers.map((t, i) => (i === index ? { ...t, minQty: e.target.value } : t)) })
                    }
                  />
                  <select
                    className="ea-form-select"
                    value={tier.mode}
                    onChange={(e) =>
                      patch({
                        tiers: form.tiers.map((t, i) =>
                          i === index ? { ...t, mode: e.target.value as "percent" | "price" } : t
                        ),
                      })
                    }
                  >
                    <option value="percent">Хувь %</option>
                    <option value="price">Үнэ ₮</option>
                  </select>
                  <Input
                    type="number"
                    min="0"
                    placeholder={tier.mode === "price" ? "Нэгж үнэ" : "%"}
                    value={tier.value}
                    className="font-mono text-right"
                    onChange={(e) =>
                      patch({ tiers: form.tiers.map((t, i) => (i === index ? { ...t, value: e.target.value } : t)) })
                    }
                  />
                  <IconAction
                    name="close"
                    label="Мөр хасах"
                    size="sm"
                    onClick={() => patch({ tiers: form.tiers.filter((_, i) => i !== index) })}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Огноо (эхлэх)">
            <Input type="date" value={form.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} />
          </Field>
          <Field label="Огноо (дуусах)">
            <Input type="date" value={form.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} />
          </Field>
          <Field label={isTimeWindow ? "Цаг (эхлэх)" : "Цаг (эхлэх, сонголтоор)"}>
            <Input type="time" value={form.timeFrom} onChange={(e) => patch({ timeFrom: e.target.value })} />
          </Field>
          <Field label={isTimeWindow ? "Цаг (дуусах)" : "Цаг (дуусах, сонголтоор)"}>
            <Input type="time" value={form.timeTo} onChange={(e) => patch({ timeTo: e.target.value })} />
          </Field>
        </div>

        <div>
          <Label className="mb-1.5">Гараг (хоосон = бүх өдөр)</Label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => (
              <label key={day.value} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={form.weekdays.includes(day.value)}
                  onChange={(e) =>
                    patch({
                      weekdays: e.target.checked
                        ? [...form.weekdays, day.value]
                        : form.weekdays.filter((entry) => entry !== day.value),
                    })
                  }
                />
                {day.label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <SwitchField label="Давхцах боломжтой (stackable)" checked={form.stackable} onChange={(v) => patch({ stackable: v })} />
          <SwitchField label="Менежерийн зөвшөөрөл шаардана" checked={form.requiresApproval} onChange={(v) => patch({ requiresApproval: v })} />
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
