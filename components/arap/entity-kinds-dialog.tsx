"use client";

// Харилцагчийн ТӨРӨЛ — байгууллага бүр нэмнэ (lib/arap/counterparty-kind.ts).
// «Байгууллага» / «Хувь хүн» нь СИСТЕМИЙН төрөл: нэрийг нь засна, устгахгүй.
// Шинэ төрөл «байгууллага шиг» эсвэл «хувь хүн шиг» суурьтай — регистрийн
// шалгалт, eBarimt B2B нь суурьаар ажиллана.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  deleteCounterpartyEntityKind,
  saveCounterpartyEntityKind,
} from "@/lib/actions/arap";
import {
  COUNTERPARTY_ENTITY_KIND_LABELS,
  type CounterpartyBaseKind,
  type EntityKindOption,
} from "@/lib/arap/counterparty-kind";
import type { CounterpartyView } from "@/lib/arap/types";

type Draft = { code: string; name: string; baseKind: CounterpartyBaseKind; isActive: boolean };

const emptyDraft: Draft = { code: "", name: "", baseKind: "organization", isActive: true };

export function EntityKindsDialog({
  open,
  onOpenChange,
  kinds,
  counterparties,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kinds: EntityKindOption[];
  counterparties: CounterpartyView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirm();

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cp of counterparties) counts.set(cp.entityKind, (counts.get(cp.entityKind) ?? 0) + 1);
    return counts;
  }, [counterparties]);

  function save(next: Draft, success: string, onDone?: () => void) {
    setError("");
    startTransition(async () => {
      const result = await saveCounterpartyEntityKind({
        code: next.code || null,
        name: next.name,
        baseKind: next.baseKind,
        isActive: next.isActive,
      });
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      onDone?.();
      router.refresh();
      toast.success(success);
    });
  }

  async function remove(kind: EntityKindOption) {
    const ok = await confirm({
      title: "Төрөл устгах",
      description: `«${kind.name}» төрлийг устгах уу? Энэ төрөлтэй харилцагч байвал устгагдахгүй — идэвхгүй болгоно уу.`,
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteCounterpartyEntityKind(kind.code);
      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      toast.success("Төрөл устгагдлаа");
    });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setDraft(null);
            setError("");
          }
          onOpenChange(next);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Харилцагчийн төрөл</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[var(--ea-text-3)]">
            «Байгууллага», «Хувь хүн» нь үндсэн төрөл (нэрийг засаж болно). Өөрийн төрөл
            нэмэхдээ аль суурьтай болохыг сонгоно — регистрийн шалгалт, eBarimt-ийн B2B
            баримт суурь төрлөөр ажиллана.
          </p>
          <div className="divide-y divide-[var(--ea-border)] rounded-md border border-[var(--ea-border)]">
            {kinds.map((kind) => (
              <div key={kind.code} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={kind.isActive ? "font-medium text-[var(--ea-text-1)]" : "text-[var(--ea-text-4)] line-through"}>
                      {kind.name}
                    </span>
                    {kind.isSystem && <StatusBadge tone="muted">Үндсэн</StatusBadge>}
                  </div>
                  <div className="text-[11px] text-[var(--ea-text-4)]">
                    суурь: {COUNTERPARTY_ENTITY_KIND_LABELS[kind.baseKind]} · {usage.get(kind.code) ?? 0} харилцагч
                    {!kind.isSystem && <span className="ml-1 font-mono">({kind.code})</span>}
                  </div>
                </div>
                {!kind.isSystem && (
                  <Switch
                    checked={kind.isActive}
                    disabled={isPending}
                    onCheckedChange={(checked) =>
                      save(
                        { code: kind.code, name: kind.name, baseKind: kind.baseKind, isActive: checked },
                        checked ? "Төрөл идэвхжлээ" : "Төрөл идэвхгүй боллоо"
                      )
                    }
                  />
                )}
                <button
                  type="button"
                  className="ea-btn ea-btn--icon"
                  title="Засах"
                  aria-label="Засах"
                  onClick={() => {
                    setError("");
                    setDraft({ code: kind.code, name: kind.name, baseKind: kind.baseKind, isActive: kind.isActive });
                  }}
                >
                  <Icon name="edit" />
                </button>
                {!kind.isSystem && (
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon ea-btn--danger"
                    title="Устгах (харилцагчгүй үед)"
                    aria-label="Устгах"
                    onClick={() => remove(kind)}
                  >
                    <Icon name="delete" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {draft ? (
            <div className="grid gap-3 rounded-md border border-[var(--ea-border)] p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Нэр">
                  <Input
                    value={draft.name}
                    autoFocus
                    placeholder="Ж: Төрийн байгууллага"
                    onChange={(e) => setDraft((current) => current && { ...current, name: e.target.value })}
                  />
                </FormField>
                <FormField
                  label="Суурь төрөл"
                  hint={draft.code && kinds.find((kind) => kind.code === draft.code)?.isSystem ? "үндсэн төрлийн суурь өөрчлөгдөхгүй" : undefined}
                >
                  <select
                    className="ea-form-select"
                    value={draft.baseKind}
                    disabled={!!kinds.find((kind) => kind.code === draft.code)?.isSystem}
                    onChange={(e) =>
                      setDraft((current) => current && { ...current, baseKind: e.target.value as CounterpartyBaseKind })
                    }
                  >
                    <option value="organization">Байгууллага шиг (РД 7 / ТТД)</option>
                    <option value="individual">Хувь хүн шиг (иргэний РД)</option>
                  </select>
                </FormField>
              </div>
              {error && (
                <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">{error}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={isPending}>
                  Болих
                </Button>
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    save(draft, draft.code ? "Төрөл шинэчлэгдлээ" : "Төрөл нэмэгдлээ", () => setDraft(null))
                  }
                >
                  Хадгалах
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setError("");
                  setDraft(emptyDraft);
                }}
              >
                <Icon name="add" />
                Төрөл нэмэх
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Хаах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}
