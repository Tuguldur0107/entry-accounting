"use client";

// П8 — Банкны хуулгын ДҮРМИЙН удирдлага (жагсаалт + форм нэг диалогт).
// Дүрэм нь импортын мөрийг л бөглөдөг тул энд бизнесийн баримт хөндөгдөхгүй;
// хадгалсны дараа эцэг component-д мэдэгдэж саналын лавлахыг сэргээнэ.

import { useCallback, useEffect, useState, useTransition } from "react";

import { AccountInput } from "@/components/account/account-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  createBankRule,
  deleteBankRule,
  listBankRules,
  toggleBankRule,
  updateBankRule,
  type BankRuleInput,
} from "@/lib/actions/bank-rules";
import type {
  BankRule,
  BankRuleMode,
  BankRuleSide,
} from "@/lib/cash/bank-rules";
import { fmtMnt, parseMntInput } from "@/lib/grid/formatters";
import { fmtAccountDisplay } from "@/lib/grid/segments";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

const SIDE_LABELS: Record<BankRuleSide, string> = {
  income: "Орлого",
  expense: "Зарлага",
  any: "Аль ч чиглэл",
};

const MODE_LABELS: Record<BankRuleMode, string> = {
  suggest: "Санал болгох",
  auto: "Шууд бөглөх",
};

/** Мөрөөс «Дүрэм үүсгэх» дарахад формд урьдчилан бөглөгдөх утгууд. */
export type BankRuleDraft = {
  matchText: string;
  side: BankRuleSide;
  counterAccountNumber: string;
};

type FormState = {
  name: string;
  matchText: string;
  side: BankRuleSide;
  minAmount: string;
  maxAmount: string;
  counterAccountNumber: string;
  setCounterparty: string;
  setDescription: string;
  mode: BankRuleMode;
  priority: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  matchText: "",
  side: "any",
  minAmount: "",
  maxAmount: "",
  counterAccountNumber: "",
  setCounterparty: "",
  setDescription: "",
  mode: "suggest",
  priority: "100",
};

function formFromRule(rule: BankRule): FormState {
  return {
    name: rule.name,
    matchText: rule.matchText,
    side: rule.side,
    minAmount: rule.minAmount == null ? "" : String(rule.minAmount),
    maxAmount: rule.maxAmount == null ? "" : String(rule.maxAmount),
    counterAccountNumber: rule.counterAccountNumber,
    setCounterparty: rule.setCounterparty ?? "",
    setDescription: rule.setDescription ?? "",
    mode: rule.mode,
    priority: String(rule.priority),
  };
}

function inputFromForm(form: FormState, isActive: boolean): BankRuleInput {
  const parseAmount = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return parseMntInput(trimmed);
  };
  return {
    name: form.name,
    matchText: form.matchText,
    side: form.side,
    minAmount: parseAmount(form.minAmount),
    maxAmount: parseAmount(form.maxAmount),
    counterAccountNumber: form.counterAccountNumber,
    setCounterparty: form.setCounterparty.trim() || null,
    setDescription: form.setDescription.trim() || null,
    mode: form.mode,
    priority: Number(form.priority) || 100,
    isActive,
  };
}

export function BankRulesDialog({
  open,
  onOpenChange,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  draft,
  onRulesChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  /** Мөрөөс урьдчилан бөглөх утга — диалог нээгдэхэд шинэ дүрмийн форм нээнэ. */
  draft?: BankRuleDraft | null;
  onRulesChanged: () => void;
}) {
  const [rules, setRules] = useState<BankRule[] | null>(null);
  // editing: null = жагсаалт, "new" = шинэ дүрэм, бусад = тухайн id-г засаж байна
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const loadRules = useCallback(() => {
    startTransition(async () => {
      const result = await listBankRules();
      if (result.error) setError(result.error);
      else setRules(result.rules ?? []);
    });
  }, []);

  // Нээгдэх мөчид синхрон reset — React-ийн "adjust state when props change"
  // хэв маяг (render үед өөрийн state-ээ нөхцөлтэйгөөр тохируулна; effect
  // дотор setState хийхийг lint хориглодог). draft нь нээх мөчид л утгатай.
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setError("");
      setRules(null);
      if (draft) {
        setEditing("new");
        setForm({
          ...EMPTY_FORM,
          matchText: draft.matchText,
          side: draft.side,
          counterAccountNumber: draft.counterAccountNumber,
        });
      } else {
        setEditing(null);
        setForm(EMPTY_FORM);
      }
    }
  }

  // Жагсаалтын ачаалалт — transition дотор тул энд шууд setState байхгүй.
  useEffect(() => {
    if (open) loadRules();
  }, [open, loadRules]);

  function startEdit(rule: BankRule) {
    setError("");
    setEditing(rule.id);
    setForm(formFromRule(rule));
  }

  function startCreate() {
    setError("");
    setEditing("new");
    setForm(EMPTY_FORM);
  }

  function submitForm() {
    setError("");
    startTransition(async () => {
      const existing =
        editing !== "new" ? rules?.find((rule) => rule.id === editing) : null;
      const input = inputFromForm(form, existing?.isActive ?? true);
      const result =
        editing === "new"
          ? await createBankRule(input)
          : await updateBankRule(editing as string, input);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(null);
      loadRules();
      onRulesChanged();
    });
  }

  function handleToggle(rule: BankRule, isActive: boolean) {
    setError("");
    // Оптимист шинэчлэл — амжилтгүй бол жагсаалт дахин ачаалагдана.
    setRules(
      (current) =>
        current?.map((item) =>
          item.id === rule.id ? { ...item, isActive } : item
        ) ?? null
    );
    startTransition(async () => {
      const result = await toggleBankRule(rule.id, isActive);
      if (result.error) {
        setError(result.error);
        loadRules();
        return;
      }
      onRulesChanged();
    });
  }

  async function handleDelete(rule: BankRule) {
    const ok = await confirm({
      title: `«${rule.name}» дүрмийг устгах уу?`,
      description:
        "Дүрэм нь зөвхөн импортын мөр бөглөдөг тул өмнө хадгалсан баримтад нөлөөгүй.",
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    setError("");
    startTransition(async () => {
      const result = await deleteBankRule(rule.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      loadRules();
      onRulesChanged();
    });
  }

  function ruleConditionSummary(rule: BankRule) {
    const parts = [`«${rule.matchText}»`, SIDE_LABELS[rule.side]];
    if (rule.minAmount != null) parts.push(`≥ ${fmtMnt(rule.minAmount)}`);
    if (rule.maxAmount != null) parts.push(`≤ ${fmtMnt(rule.maxAmount)}`);
    return parts.join(" · ");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Банкны хуулгын дүрэм</DialogTitle>
        </DialogHeader>

        {editing === null ? (
          <div className="space-y-3">
            <p className="text-xs text-[var(--ea-text-3)]">
              Нөхцөл таарсан мөрөнд харьцах данс, харилцагч, тайлбар автоматаар
              бөглөгдөнө. «Шууд бөглөх» дүрэм уншигдмагц хэрэгжинэ, «Санал
              болгох» нь «Санал» баганад нэхэмжлэхийн өмнө гарна.
            </p>

            {rules === null ? (
              <p className="py-6 text-center text-xs text-[var(--ea-text-3)]">
                Ачаалж байна…
              </p>
            ) : rules.length === 0 ? (
              <p className="rounded-md border border-[var(--ea-border)] px-3 py-6 text-center text-xs text-[var(--ea-text-3)]">
                Дүрэм алга — «Шинэ дүрэм» дарж эхний дүрмээ үүсгээрэй, эсвэл
                хүснэгтэд мөр сонгоод «Мөрөөс дүрэм» ашиглаарай.
              </p>
            ) : (
              <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                {rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="flex items-center gap-2 rounded-md border border-[var(--ea-border)] px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--ea-text-1)]">
                          {rule.name}
                        </span>
                        <StatusBadge
                          tone={rule.mode === "auto" ? "success" : "muted"}
                          size="sm"
                        >
                          {MODE_LABELS[rule.mode]}
                        </StatusBadge>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--ea-text-3)]">
                        {ruleConditionSummary(rule)} →{" "}
                        <span className="font-mono">
                          {fmtAccountDisplay(
                            rule.counterAccountNumber,
                            activeSegIds
                          ) || rule.counterAccountNumber}
                        </span>
                      </div>
                    </div>
                    <Switch
                      checked={rule.isActive}
                      onCheckedChange={(checked) =>
                        handleToggle(rule, checked)
                      }
                      disabled={isPending}
                    />
                    <IconAction
                      name="edit"
                      label="Засах"
                      size="sm"
                      onClick={() => startEdit(rule)}
                    />
                    <IconAction
                      name="delete"
                      label="Устгах"
                      size="sm"
                      variant="danger"
                      onClick={() => void handleDelete(rule)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {error ? (
              <p className="text-xs text-[var(--ea-danger-fg)]">{error}</p>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={startCreate}>
                <Icon name="add" />
                Шинэ дүрэм
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bank-rule-name">Дүрмийн нэр</Label>
                <Input
                  id="bank-rule-name"
                  value={form.name}
                  placeholder="ж: Цахилгааны төлбөр"
                  onChange={(event) =>
                    setForm((f) => ({ ...f, name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bank-rule-match">Текст агуулна</Label>
                <Input
                  id="bank-rule-match"
                  value={form.matchText}
                  placeholder="гүйлгээний утга/харилцагчид хайх текст"
                  onChange={(event) =>
                    setForm((f) => ({ ...f, matchText: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bank-rule-side">Чиглэл</Label>
                {/* Native select — Dialog доторх Base UI popup давхарга
                    дарагддаг тул энэ хуудасны ea-form-select идиомыг дагана */}
                <select
                  id="bank-rule-side"
                  value={form.side}
                  onChange={(event) =>
                    setForm((f) => ({
                      ...f,
                      side: event.target.value as BankRuleSide,
                    }))
                  }
                  className="ea-form-select w-full"
                >
                  {(Object.keys(SIDE_LABELS) as BankRuleSide[]).map((side) => (
                    <option key={side} value={side}>
                      {SIDE_LABELS[side]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bank-rule-mode">Горим</Label>
                <select
                  id="bank-rule-mode"
                  value={form.mode}
                  onChange={(event) =>
                    setForm((f) => ({
                      ...f,
                      mode: event.target.value as BankRuleMode,
                    }))
                  }
                  className="ea-form-select w-full"
                >
                  {(Object.keys(MODE_LABELS) as BankRuleMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bank-rule-min">Доод дүн (хоосон = хязгааргүй)</Label>
                <Input
                  id="bank-rule-min"
                  inputMode="decimal"
                  value={form.minAmount}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, minAmount: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bank-rule-max">Дээд дүн (хоосон = хязгааргүй)</Label>
                <Input
                  id="bank-rule-max"
                  inputMode="decimal"
                  value={form.maxAmount}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, maxAmount: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Харьцах данс (үйлдэл)</Label>
              <AccountInput
                value={form.counterAccountNumber}
                onChange={(code) =>
                  setForm((f) => ({ ...f, counterAccountNumber: code }))
                }
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
              />
              <p className="text-xs text-[var(--ea-text-3)]">
                Орлогын мөрөнд кредит, зарлагын мөрөнд дебет талд бөглөгдөнө.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bank-rule-cp">Харилцагч болгох (заавал биш)</Label>
                <Input
                  id="bank-rule-cp"
                  value={form.setCounterparty}
                  onChange={(event) =>
                    setForm((f) => ({
                      ...f,
                      setCounterparty: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bank-rule-desc">Тайлбар болгох (заавал биш)</Label>
                <Input
                  id="bank-rule-desc"
                  value={form.setDescription}
                  onChange={(event) =>
                    setForm((f) => ({
                      ...f,
                      setDescription: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bank-rule-priority">
                Эрэмбэ (бага тоо түрүүлж шалгагдана)
              </Label>
              <Input
                id="bank-rule-priority"
                inputMode="numeric"
                className="w-32"
                value={form.priority}
                onChange={(event) =>
                  setForm((f) => ({ ...f, priority: event.target.value }))
                }
              />
            </div>

            {error ? (
              <p className="text-xs text-[var(--ea-danger-fg)]">{error}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Буцах
              </Button>
              <Button onClick={submitForm} disabled={isPending}>
                {isPending
                  ? "Хадгалж байна…"
                  : editing === "new"
                    ? "Дүрэм үүсгэх"
                    : "Хадгалах"}
              </Button>
            </div>
          </div>
        )}

        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}
