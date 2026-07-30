"use client";

// Үйлдвэрлэлийн тохиргоо — дамжлага (шат) ба өртгийн бүлэг + зураглалын
// дүрэм. Өртгийн тохиргооны "Үйлдвэрлэл" таб.
//
// Бүтэц нь Excel-ийн Production Cost Report-ийн WIP шатлалыг дагана:
//   Дамжлага (MINING, CHPP…) → Өртгийн бүлэг (105BLAST DRILL…, VAR/FIX)
//   → зураглалын дүрэм (S2 өртгийн төв × дансны угтвар → GL-ээс автоматаар).

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
import {
  saveCostPool,
  saveProductionStage,
  toggleCostPool,
  toggleProductionStage,
} from "@/lib/actions/production";
import { cn } from "@/lib/utils";

export type ProductionConfigStage = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  pools: {
    id: string;
    code: string;
    name: string;
    costBehavior: string;
    sortOrder: number;
    isActive: boolean;
    rules: {
      costCenterCode: string | null;
      accountPrefix: string | null;
      priority: number;
    }[];
  }[];
};

interface Props {
  stages: ProductionConfigStage[];
  /** S2 өртгийн төвийн сонголтууд (сегментийн утгууд). */
  costCenters: { code: string; name: string }[];
}

const EMPTY_STAGE = { id: undefined as string | undefined, code: "", name: "", sortOrder: 0 };

type PoolForm = {
  id: string | undefined;
  stageId: string;
  code: string;
  name: string;
  costBehavior: "variable" | "fixed";
  sortOrder: number;
  rules: { costCenterCode: string; accountPrefix: string; priority: number }[];
};

export function ProductionConfigSection({ stages, costCenters }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [stageOpen, setStageOpen] = useState(false);
  const [stageForm, setStageForm] = useState(EMPTY_STAGE);
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolForm, setPoolForm] = useState<PoolForm | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function saveStage() {
    setError("");
    startTransition(async () => {
      const result = await saveProductionStage(stageForm);
      if (!result.ok) {
        setError(result.message ?? "Хадгалж чадсангүй");
        return;
      }
      toast.success("Дамжлага хадгалагдлаа");
      setStageOpen(false);
      router.refresh();
    });
  }

  function savePool() {
    if (!poolForm) return;
    setError("");
    startTransition(async () => {
      const result = await saveCostPool(poolForm);
      if (!result.ok) {
        setError(result.message ?? "Хадгалж чадсангүй");
        return;
      }
      toast.success("Өртгийн бүлэг хадгалагдлаа");
      setPoolOpen(false);
      router.refresh();
    });
  }

  function toggleStage(stage: ProductionConfigStage) {
    startTransition(async () => {
      const result = await toggleProductionStage(stage.id, !stage.isActive);
      if (!result.ok) toast.error(result.message ?? "Амжилтгүй");
      else router.refresh();
    });
  }

  function togglePool(id: string, isActive: boolean) {
    startTransition(async () => {
      const result = await toggleCostPool(id, !isActive);
      if (!result.ok) toast.error(result.message ?? "Амжилтгүй");
      else router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-[var(--ea-text-3)]">
          Дамжлага = үйлдвэрлэлийн шат (Уурхай, Баяжуулах…). Шат бүр өртгийн
          бүлгүүдтэй; бүлэг бүр GL-ээс зардлаа зураглалын дүрмээр (S2 өртгийн
          төв × дансны угтвар) автоматаар цуглуулна. Дараалал нь тооцооллын
          дараалал — өмнөх шатны гаралт дараагийнхад орж болно.
        </p>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => {
            setStageForm({ ...EMPTY_STAGE, sortOrder: stages.length * 10 });
            setError("");
            setStageOpen(true);
          }}
        >
          <Icon name="add" size="sm" />
          Дамжлага нэмэх
        </Button>
      </div>

      {stages.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] px-6 text-center text-sm text-[var(--ea-text-4)]">
          Дамжлага бүртгээгүй байна. Эхний дамжлагаа үүсгэмэгц үйлдвэрлэлийн
          тооцоолол идэвхжинэ.
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          {stages.map((stage, index) => {
            const isExpanded = expanded[stage.id] ?? true;
            return (
              <div
                key={stage.id}
                className={cn(
                  "rounded-lg border",
                  stage.isActive
                    ? "border-[var(--ea-border-strong)]"
                    : "border-[var(--ea-border)] opacity-60"
                )}
                style={{ background: "var(--ea-surface)" }}
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [stage.id]: !isExpanded,
                      }))
                    }
                    className="flex size-6 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)]"
                    aria-label={isExpanded ? "Хураах" : "Дэлгэх"}
                  >
                    <Icon name="chevronDown" size="sm" className={cn("transition-transform", !isExpanded && "-rotate-90")} />
                  </button>
                  <span className="flex size-6 items-center justify-center rounded-full bg-[var(--ea-primary)]/12 font-mono text-[11px] font-bold text-[var(--ea-primary)]">
                    {index + 1}
                  </span>
                  <span className="font-mono text-xs text-[var(--ea-text-3)]">
                    {stage.code}
                  </span>
                  <span className="text-sm font-semibold text-[var(--ea-text-1)]">
                    {stage.name}
                  </span>
                  {!stage.isActive && (
                    <StatusBadge tone="muted">Идэвхгүй</StatusBadge>
                  )}
                  <span className="ml-auto text-[11px] text-[var(--ea-text-4)]">
                    {stage.pools.length} бүлэг
                  </span>
                  <button
                    type="button"
                    title="Засах"
                    onClick={() => {
                      setStageForm({
                        id: stage.id,
                        code: stage.code,
                        name: stage.name,
                        sortOrder: stage.sortOrder,
                      });
                      setError("");
                      setStageOpen(true);
                    }}
                    className="flex size-6 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
                  >
                    <Icon name="edit" size="sm" />
                  </button>
                  <button
                    type="button"
                    title={stage.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
                    onClick={() => toggleStage(stage)}
                    className="flex size-6 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
                  >
                    <Icon name="power" size="sm" />
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-[var(--ea-border)] px-3 py-2.5">
                    {stage.pools.length === 0 ? (
                      <p className="py-2 text-center text-xs text-[var(--ea-text-4)]">
                        Өртгийн бүлэг алга
                      </p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="text-[var(--ea-text-3)]">
                          <tr>
                            <th className="py-1 text-left font-medium">Код</th>
                            <th className="py-1 text-left font-medium">Нэр</th>
                            <th className="py-1 text-left font-medium">Ангилал</th>
                            <th className="py-1 text-left font-medium">
                              Зураглалын дүрэм
                            </th>
                            <th className="w-16" />
                          </tr>
                        </thead>
                        <tbody>
                          {stage.pools.map((pool) => (
                            <tr
                              key={pool.id}
                              className={cn(
                                "border-t border-[var(--ea-border)]",
                                !pool.isActive && "opacity-50"
                              )}
                            >
                              <td className="py-1.5 pr-2 font-mono">{pool.code}</td>
                              <td className="py-1.5 pr-2">{pool.name}</td>
                              <td className="py-1.5 pr-2">
                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                    pool.costBehavior === "variable"
                                      ? "bg-[var(--ea-primary)]/10 text-[var(--ea-primary)]"
                                      : "bg-[var(--ea-bg-2)] text-[var(--ea-text-3)]"
                                  )}
                                >
                                  {pool.costBehavior === "variable"
                                    ? "Хувьсах"
                                    : "Тогтмол"}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2 font-mono text-[11px] text-[var(--ea-text-3)]">
                                {pool.rules
                                  .map((rule) =>
                                    [
                                      rule.costCenterCode
                                        ? `ӨТ=${rule.costCenterCode}`
                                        : null,
                                      rule.accountPrefix
                                        ? `данс ${rule.accountPrefix}*`
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" & ")
                                  )
                                  .join(" · ")}
                              </td>
                              <td className="py-1.5">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    title="Засах"
                                    onClick={() => {
                                      setPoolForm({
                                        id: pool.id,
                                        stageId: stage.id,
                                        code: pool.code,
                                        name: pool.name,
                                        costBehavior:
                                          pool.costBehavior === "fixed"
                                            ? "fixed"
                                            : "variable",
                                        sortOrder: pool.sortOrder,
                                        rules: pool.rules.map((rule) => ({
                                          costCenterCode: rule.costCenterCode ?? "",
                                          accountPrefix: rule.accountPrefix ?? "",
                                          priority: rule.priority,
                                        })),
                                      });
                                      setError("");
                                      setPoolOpen(true);
                                    }}
                                    className="flex size-5 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)]"
                                  >
                                    <Icon name="edit" size="xs" />
                                  </button>
                                  <button
                                    type="button"
                                    title={
                                      pool.isActive
                                        ? "Идэвхгүй болгох"
                                        : "Идэвхжүүлэх"
                                    }
                                    onClick={() => togglePool(pool.id, pool.isActive)}
                                    className="flex size-5 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)]"
                                  >
                                    <Icon name="power" size="xs" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={isPending}
                        onClick={() => {
                          setPoolForm({
                            id: undefined,
                            stageId: stage.id,
                            code: "",
                            name: "",
                            costBehavior: "variable",
                            sortOrder: stage.pools.length * 10,
                            rules: [
                              { costCenterCode: "", accountPrefix: "", priority: 100 },
                            ],
                          });
                          setError("");
                          setPoolOpen(true);
                        }}
                      >
                        <Icon name="add" size="xs" />
                        Бүлэг нэмэх
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Дамжлагын форм */}
      <Dialog open={stageOpen} onOpenChange={setStageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {stageForm.id ? "Дамжлага засах" : "Шинэ дамжлага"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Код</Label>
                <Input
                  value={stageForm.code}
                  onChange={(event) =>
                    setStageForm((c) => ({ ...c, code: event.target.value }))
                  }
                  placeholder="MINING"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Дараалал</Label>
                <Input
                  type="number"
                  value={String(stageForm.sortOrder)}
                  onChange={(event) =>
                    setStageForm((c) => ({
                      ...c,
                      sortOrder: Number(event.target.value) || 0,
                    }))
                  }
                  className="font-mono"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Нэр</Label>
              <Input
                value={stageForm.name}
                onChange={(event) =>
                  setStageForm((c) => ({ ...c, name: event.target.value }))
                }
                placeholder="Уурхайн үйл ажиллагаа"
              />
            </div>
            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStageOpen(false)} disabled={isPending}>
              Болих
            </Button>
            <Button onClick={saveStage} disabled={isPending}>
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Бүлгийн форм — зураглалын дүрмүүдтэй */}
      <Dialog open={poolOpen} onOpenChange={setPoolOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {poolForm?.id ? "Өртгийн бүлэг засах" : "Шинэ өртгийн бүлэг"}
            </DialogTitle>
          </DialogHeader>
          {poolForm && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Код</Label>
                  <Input
                    value={poolForm.code}
                    onChange={(event) =>
                      setPoolForm((c) => c && { ...c, code: event.target.value })
                    }
                    placeholder="105BLAST"
                    className="font-mono"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Ангилал</Label>
                  <select
                    className="h-9 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-sm text-[var(--ea-text-1)]"
                    value={poolForm.costBehavior}
                    onChange={(event) =>
                      setPoolForm(
                        (c) =>
                          c && {
                            ...c,
                            costBehavior: event.target.value as
                              | "variable"
                              | "fixed",
                          }
                      )
                    }
                  >
                    <option value="variable">Хувьсах (VARIABLE)</option>
                    <option value="fixed">Тогтмол (FIXED)</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Нэр</Label>
                <Input
                  value={poolForm.name}
                  onChange={(event) =>
                    setPoolForm((c) => c && { ...c, name: event.target.value })
                  }
                  placeholder="Өрөмдлөг тэсэлгээ"
                />
              </div>

              <div className="grid gap-1.5">
                <Label>Зураглалын дүрэм</Label>
                <p className="text-[11px] text-[var(--ea-text-4)]">
                  GL мөр аль бүлэгт орохыг шийднэ. Өртгийн төв (S2) яг таарна,
                  дансны угтвараар эхэлнэ — аль нэг нь эсвэл хоёулаа.
                  Priority бага дүрэм түрүүлж таарна.
                </p>
                <div className="flex flex-col gap-1.5">
                  {poolForm.rules.map((rule, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                      <select
                        className="h-8 min-w-0 flex-1 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-1.5 text-xs text-[var(--ea-text-1)]"
                        value={rule.costCenterCode}
                        onChange={(event) =>
                          setPoolForm(
                            (c) =>
                              c && {
                                ...c,
                                rules: c.rules.map((entry, i) =>
                                  i === index
                                    ? { ...entry, costCenterCode: event.target.value }
                                    : entry
                                ),
                              }
                          )
                        }
                      >
                        <option value="">Өртгийн төв — бүгд</option>
                        {costCenters.map((center) => (
                          <option key={center.code} value={center.code}>
                            {center.code} · {center.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={rule.accountPrefix}
                        onChange={(event) =>
                          setPoolForm(
                            (c) =>
                              c && {
                                ...c,
                                rules: c.rules.map((entry, i) =>
                                  i === index
                                    ? { ...entry, accountPrefix: event.target.value }
                                    : entry
                                ),
                              }
                          )
                        }
                        placeholder="Дансны угтвар (14104…)"
                        className="h-8 flex-1 font-mono text-xs"
                      />
                      <Input
                        type="number"
                        value={String(rule.priority)}
                        onChange={(event) =>
                          setPoolForm(
                            (c) =>
                              c && {
                                ...c,
                                rules: c.rules.map((entry, i) =>
                                  i === index
                                    ? {
                                        ...entry,
                                        priority: Number(event.target.value) || 100,
                                      }
                                    : entry
                                ),
                              }
                          )
                        }
                        title="Priority"
                        className="h-8 w-16 font-mono text-xs"
                      />
                      <button
                        type="button"
                        title="Дүрэм устгах"
                        onClick={() =>
                          setPoolForm(
                            (c) =>
                              c && {
                                ...c,
                                rules: c.rules.filter((_, i) => i !== index),
                              }
                          )
                        }
                        className="flex size-7 shrink-0 items-center justify-center rounded text-[var(--ea-text-3)] hover:bg-[var(--ea-danger)]/10 hover:text-[var(--ea-danger)]"
                      >
                        <Icon name="delete" size="sm" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-fit text-xs"
                  onClick={() =>
                    setPoolForm(
                      (c) =>
                        c && {
                          ...c,
                          rules: [
                            ...c.rules,
                            { costCenterCode: "", accountPrefix: "", priority: 100 },
                          ],
                        }
                    )
                  }
                >
                  <Icon name="add" size="xs" />
                  Дүрэм нэмэх
                </Button>
              </div>

              {error && (
                <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                  {error}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPoolOpen(false)} disabled={isPending}>
              Болих
            </Button>
            <Button onClick={savePool} disabled={isPending}>
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
