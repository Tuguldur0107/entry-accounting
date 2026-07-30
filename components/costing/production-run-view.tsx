"use client";

// ҮЙЛДВЭРЛЭЛИЙН ӨРТГИЙН ТООЦООЛОЛ — сарын run-ийн pipeline workspace.
//
// Дэлгэц нь урсгалыг ДЭЭРЭЭС ДООШ харуулна (юу болоод байгаа нь ил):
//
//   [Зураглалгүй зардлын сэрэмжлүүлэг — байвал]
//   ┌ Шат 1: УУРХАЙ ───────────────────────────┐
//   │ Өртгийн бүлгүүд (GL-ээс автоматаар) Σ    │
//   │ + Орц (нөөцөөс / өмнөх шатнаас)      Σ    │
//   │ = Нийт өртөг                              │
//   │ → Гаралт: бүтээгдэхүүн × хуваарь          │
//   └──────────────┬───────────────────────────┘
//                  ▼ (гаралт дараагийн шатны орц болж болно)
//   ┌ Шат 2: БАЯЖУУЛАХ … ┐
//
// "Тооцоолох" — GL-ийг шинээр цуглуулж, бүх шатыг дарааллаар нь бодоод
// НООРОГ болгон хадгална. "Батлах" — гаралт бүрд орлогын хөдөлгөөн +
// ноорог өртгийн бичилт үүсгэнэ (цаашид жирийн орлого шиг).

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  computeAndSaveProductionRun,
  confirmProductionRun,
  type ProductionWorkspaceData,
  type RunStageInput,
} from "@/lib/actions/production";
import { PRODUCTION_BASE_LABELS, type ProductionAllocationBase } from "@/lib/costing/production";
import { fmtPeriodCode } from "@/lib/periods/period";
import { fmtMnt } from "@/lib/reports/balances";
import { openVoucherPanel } from "@/lib/store/panel-store";
import { cn } from "@/lib/utils";

interface Props {
  data: ProductionWorkspaceData;
}

type EditStage = {
  stageId: string;
  base: ProductionAllocationBase;
  inputs: { itemId: string; quantity: string; sourceStageId: string }[];
  outputs: {
    itemId: string;
    warehouseId: string;
    quantity: string;
    salesPrice: string;
    manualAmount: string;
  }[];
};

const num = (value: string) => Number(value.replaceAll(",", "")) || 0;

export function ProductionRunView({ data }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const readOnly = data.runStatus === "confirmed";

  // Засварын төлөв — серверийн хадгалагдсан run-аас эхэлнэ. Тооцоолсны
  // дараа page key солигдож шинэ утгаар remount хийгдэнэ.
  const [stages, setStages] = useState<EditStage[]>(() =>
    data.stages.map((stage) => ({
      stageId: stage.id,
      base: stage.base,
      inputs: stage.inputs.map((input) => ({
        itemId: input.itemId,
        quantity: String(input.quantity),
        sourceStageId: input.sourceStageId ?? "",
      })),
      outputs: stage.outputs.map((output) => ({
        itemId: output.itemId,
        warehouseId: output.warehouseId ?? "",
        quantity: String(output.quantity),
        salesPrice: output.salesPrice === null ? "" : String(output.salesPrice),
        manualAmount:
          output.manualAmount === null ? "" : String(output.manualAmount),
      })),
    }))
  );
  const [expandedPools, setExpandedPools] = useState<Record<string, boolean>>({});

  const itemUnit = useMemo(
    () => new Map(data.items.map((item) => [item.id, item.unit])),
    [data.items]
  );

  const editOf = (stageId: string) =>
    stages.find((entry) => entry.stageId === stageId);

  function patchStage(stageId: string, patch: (stage: EditStage) => EditStage) {
    setStages((current) =>
      current.map((entry) => (entry.stageId === stageId ? patch(entry) : entry))
    );
  }

  function compute() {
    const payload: RunStageInput[] = stages.map((stage) => ({
      stageId: stage.stageId,
      base: stage.base,
      inputs: stage.inputs
        .filter((input) => input.itemId && num(input.quantity) > 0)
        .map((input) => ({
          itemId: input.itemId,
          quantity: num(input.quantity),
          sourceStageId: input.sourceStageId || null,
        })),
      outputs: stage.outputs
        .filter((output) => output.itemId && num(output.quantity) > 0)
        .map((output) => ({
          itemId: output.itemId,
          warehouseId: output.warehouseId,
          quantity: num(output.quantity),
          salesPrice: output.salesPrice === "" ? null : num(output.salesPrice),
          manualAmount:
            output.manualAmount === "" ? null : num(output.manualAmount),
        })),
    }));
    startTransition(async () => {
      const result = await computeAndSaveProductionRun({
        periodCode: data.periodCode,
        stages: payload,
      });
      if (!result.ok) {
        toast.error(result.message ?? "Тооцоолол амжилтгүй");
        return;
      }
      toast.success("Тооцоолол хийгдэж ноорог хадгалагдлаа");
      router.refresh();
    });
  }

  function confirmRun() {
    void confirm({
      title: `${fmtPeriodCode(data.periodCode)} — үйлдвэрлэл батлах`,
      description:
        "Гаралт бүрд орлогын хөдөлгөөн + ноорог өртгийн бичилт, нөөцөөс авсан орц бүрд зарлагын хөдөлгөөн үүснэ. Өртгийн бичилтийг дараа нь GL-д батална.",
      confirmText: "Батлах",
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        const result = await confirmProductionRun(data.periodCode);
        if (!result.ok) {
          toast.error(result.message ?? "Батлах амжилтгүй");
          return;
        }
        toast.success("Үйлдвэрлэлийн тооцоолол батлагдлаа");
        router.refresh();
      });
    });
  }

  const grandTotal = data.stages.reduce(
    (sum, stage) =>
      sum + stage.outputs.reduce((s, output) => s + (output.allocatedAmount ?? 0), 0),
    0
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-[var(--ea-text-1)]">
            Үйлдвэрлэлийн өртгийн тооцоолол
            <span className="font-mono text-sm text-[var(--ea-text-3)]">
              {fmtPeriodCode(data.periodCode)}
            </span>
            {data.runStatus === "confirmed" ? (
              <StatusBadge tone="success">Батлагдсан</StatusBadge>
            ) : data.runStatus === "draft" ? (
              <StatusBadge tone="warning">Ноорог</StatusBadge>
            ) : (
              <StatusBadge tone="muted">Тооцоогүй</StatusBadge>
            )}
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            GL → өртгийн бүлэг → дамжлага → бүтээгдэхүүн. Сар нь topbar-ийн
            периодын сонголтоор солигдоно.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={compute}
                disabled={isPending || data.stages.length === 0}
              >
                <Icon name="costing" size="sm" />
                Тооцоолох
              </Button>
              <Button
                size="sm"
                onClick={confirmRun}
                disabled={isPending || data.runStatus !== "draft"}
                title={
                  data.runStatus !== "draft"
                    ? "Эхлээд тооцоолно уу"
                    : "Гаралтуудыг нөөцөд оруулна"
                }
              >
                <Icon name="success" size="sm" />
                Батлах
              </Button>
            </>
          )}
        </div>
      </div>

      {data.stages.length === 0 && (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] px-6 text-center text-sm text-[var(--ea-text-4)]">
          Дамжлага тохируулаагүй байна — Өртгийн тохиргоо → Үйлдвэрлэл хэсэгт
          дамжлага, өртгийн бүлгээ үүсгэнэ үү.
        </div>
      )}

      {data.unmatched.length > 0 && (
        <div className="rounded-md border border-[var(--ea-warning)]/50 bg-[var(--ea-warning)]/8 px-3 py-2 text-xs">
          <p className="font-medium">
            ⚠ {data.unmatched.length} GL мөр зураглалгүй байна — эдгээр нь
            өртгийн төв нь мэдэгдэж буй ч аль ч бүлэгт таараагүй ({fmtMnt(
              data.unmatched.reduce((sum, line) => sum + line.amount, 0)
            )}). Дүрэм нэмэх эсвэл шалгана уу:
          </p>
          <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
            {data.unmatched.slice(0, 20).map((line, index) => (
              <li key={index} className="flex items-center gap-2 font-mono text-[11px]">
                <button
                  type="button"
                  onClick={() => openVoucherPanel(line.voucherId, line.description)}
                  className="text-[var(--ea-primary)] hover:underline"
                >
                  {line.date}
                </button>
                <span>ӨТ {line.costCenter}</span>
                <span>{line.mainAccount}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--ea-text-3)]">
                  {line.description}
                </span>
                <span>{fmtMnt(line.amount)}</span>
              </li>
            ))}
            {data.unmatched.length > 20 && (
              <li className="text-[var(--ea-text-4)]">
                … бусад {data.unmatched.length - 20}
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-stretch gap-0 pb-4">
          {data.stages.map((stage, index) => {
            const edit = editOf(stage.id);
            const poolTotal = stage.pools.reduce((sum, pool) => sum + pool.amount, 0);
            const inputTotal = stage.inputs.reduce(
              (sum, input) => sum + (input.amount ?? 0),
              0
            );
            const allocated = stage.outputs.reduce(
              (sum, output) => sum + (output.allocatedAmount ?? 0),
              0
            );
            const hasComputed = stage.outputs.some(
              (output) => output.allocatedAmount !== null
            );

            return (
              <div key={stage.id}>
                {index > 0 && (
                  <div className="flex justify-center py-1 text-[var(--ea-text-4)]">
                    <Icon name="arrowDown" />
                  </div>
                )}
                <div
                  className="rounded-lg border border-[var(--ea-border-strong)]"
                  style={{ background: "var(--ea-surface)" }}
                >
                  {/* Шатны толгой */}
                  <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ea-border)] px-3 py-2.5">
                    <span className="flex size-6 items-center justify-center rounded-full bg-[var(--ea-primary)]/12 font-mono text-[11px] font-bold text-[var(--ea-primary)]">
                      {index + 1}
                    </span>
                    <span className="text-sm font-semibold text-[var(--ea-text-1)]">
                      {stage.name}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--ea-text-4)]">
                      {stage.code}
                    </span>
                    <div className="ml-auto flex items-center gap-3 font-mono text-xs">
                      <span title="Өртгийн бүлгүүд + орц">
                        {fmtMnt(poolTotal)} + {fmtMnt(inputTotal)}
                      </span>
                      <span className="font-semibold text-[var(--ea-text-1)]">
                        = {fmtMnt(poolTotal + inputTotal)}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 p-3 lg:grid-cols-2">
                    {/* Зүүн: өртгийн бүлгүүд (GL-ээс) */}
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ea-text-3)]">
                        Өртгийн бүлэг — GL-ээс автоматаар
                      </p>
                      {stage.pools.length === 0 ? (
                        <p className="rounded border border-dashed border-[var(--ea-border)] px-3 py-3 text-center text-xs text-[var(--ea-text-4)]">
                          Бүлэг тохируулаагүй
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {stage.pools.map((pool) => {
                            const key = `${stage.id}:${pool.id}`;
                            const isOpen = expandedPools[key] ?? false;
                            return (
                              <div
                                key={pool.id}
                                className="rounded border border-[var(--ea-border)]"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedPools((current) => ({
                                      ...current,
                                      [key]: !isOpen,
                                    }))
                                  }
                                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--ea-bg-2)]"
                                >
                                  <Icon name="chevronDown" size="xs" className={cn( "shrink-0 text-[var(--ea-text-4)] transition-transform", !isOpen && "-rotate-90" )} />
                                  <span className="font-mono text-[11px] text-[var(--ea-text-3)]">
                                    {pool.code}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">
                                    {pool.name}
                                  </span>
                                  <span
                                    className={cn(
                                      "rounded px-1 text-[9px] font-bold",
                                      pool.costBehavior === "variable"
                                        ? "bg-[var(--ea-primary)]/10 text-[var(--ea-primary)]"
                                        : "bg-[var(--ea-bg-2)] text-[var(--ea-text-3)]"
                                    )}
                                  >
                                    {pool.costBehavior === "variable" ? "VAR" : "FIX"}
                                  </span>
                                  <span className="text-[10px] text-[var(--ea-text-4)]">
                                    {pool.lineCount} мөр
                                  </span>
                                  <span className="font-mono">{fmtMnt(pool.amount)}</span>
                                </button>
                                {isOpen && pool.lines.length > 0 && (
                                  <ul className="max-h-40 space-y-0.5 overflow-y-auto border-t border-[var(--ea-border)] px-2 py-1.5">
                                    {pool.lines.map((line, lineIndex) => (
                                      <li
                                        key={lineIndex}
                                        className="flex items-center gap-2 font-mono text-[11px]"
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openVoucherPanel(
                                              line.voucherId,
                                              line.description
                                            )
                                          }
                                          className="inline-flex shrink-0 items-center gap-0.5 text-[var(--ea-primary)] hover:underline"
                                        >
                                          {line.date}
                                          <Icon name="openDetail" size="xs" />
                                        </button>
                                        <span className="shrink-0">{line.mainAccount}</span>
                                        <span className="min-w-0 flex-1 truncate text-[var(--ea-text-3)]">
                                          {line.description}
                                        </span>
                                        <span className="shrink-0">
                                          {fmtMnt(line.amount)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Орц */}
                      <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ea-text-3)]">
                        Орц — нөөцөөс эсвэл өмнөх шатнаас
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {(edit?.inputs ?? []).map((input, inputIndex) => {
                          const saved = stage.inputs[inputIndex];
                          return (
                            <div key={inputIndex} className="flex items-center gap-1.5">
                              <div className="min-w-0 flex-1">
                                <SearchableSelect
                                  value={input.itemId}
                                  onChange={(value) =>
                                    patchStage(stage.id, (s) => ({
                                      ...s,
                                      inputs: s.inputs.map((entry, i) =>
                                        i === inputIndex
                                          ? { ...entry, itemId: value }
                                          : entry
                                      ),
                                    }))
                                  }
                                  options={data.items.map((item) => ({
                                    value: item.id,
                                    label: `${item.code} · ${item.name}`,
                                  }))}
                                  placeholder="Бараа..."
                                  disabled={readOnly}
                                />
                              </div>
                              <input
                                value={input.quantity}
                                onChange={(event) =>
                                  patchStage(stage.id, (s) => ({
                                    ...s,
                                    inputs: s.inputs.map((entry, i) =>
                                      i === inputIndex
                                        ? { ...entry, quantity: event.target.value }
                                        : entry
                                    ),
                                  }))
                                }
                                disabled={readOnly}
                                placeholder="Тоо"
                                className="h-8 w-24 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-right font-mono text-xs"
                              />
                              <select
                                value={input.sourceStageId}
                                onChange={(event) =>
                                  patchStage(stage.id, (s) => ({
                                    ...s,
                                    inputs: s.inputs.map((entry, i) =>
                                      i === inputIndex
                                        ? { ...entry, sourceStageId: event.target.value }
                                        : entry
                                    ),
                                  }))
                                }
                                disabled={readOnly}
                                className="h-8 w-36 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-1.5 text-xs"
                                title="Орцын эх үүсвэр"
                              >
                                <option value="">Нөөцөөс (дундаж)</option>
                                {data.stages
                                  .filter((other) => other.id !== stage.id)
                                  .map((other) => (
                                    <option key={other.id} value={other.id}>
                                      ← {other.name}
                                    </option>
                                  ))}
                              </select>
                              {saved?.amount != null && (
                                <span className="w-28 shrink-0 text-right font-mono text-[11px] text-[var(--ea-text-3)]">
                                  {fmtMnt(saved.amount)}
                                </span>
                              )}
                              {!readOnly && (
                                <button
                                  type="button"
                                  title="Мөр устгах"
                                  onClick={() =>
                                    patchStage(stage.id, (s) => ({
                                      ...s,
                                      inputs: s.inputs.filter((_, i) => i !== inputIndex),
                                    }))
                                  }
                                  className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--ea-text-4)] hover:bg-[var(--ea-danger)]/10 hover:text-[var(--ea-danger)]"
                                >
                                  <Icon name="delete" size="xs" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {!readOnly && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-fit text-xs"
                            onClick={() =>
                              patchStage(stage.id, (s) => ({
                                ...s,
                                inputs: [
                                  ...s.inputs,
                                  { itemId: "", quantity: "", sourceStageId: "" },
                                ],
                              }))
                            }
                          >
                            <Icon name="add" size="xs" />
                            Орц нэмэх
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Баруун: гаралт + хуваарь */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ea-text-3)]">
                          Гаралт — бүтээгдэхүүн ба хуваарь
                        </p>
                        <select
                          value={edit?.base ?? "sales_value"}
                          onChange={(event) =>
                            patchStage(stage.id, (s) => ({
                              ...s,
                              base: event.target.value as ProductionAllocationBase,
                            }))
                          }
                          disabled={readOnly}
                          className="h-7 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-1.5 text-[11px]"
                        >
                          {(
                            Object.entries(PRODUCTION_BASE_LABELS) as [
                              ProductionAllocationBase,
                              string,
                            ][]
                          ).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        {(edit?.outputs ?? []).map((output, outputIndex) => {
                          const saved = stage.outputs[outputIndex];
                          const base = edit?.base ?? "sales_value";
                          return (
                            <div
                              key={outputIndex}
                              className="rounded border border-[var(--ea-border)] p-2"
                            >
                              <div className="flex items-center gap-1.5">
                                <div className="min-w-0 flex-1">
                                  <SearchableSelect
                                    value={output.itemId}
                                    onChange={(value) =>
                                      patchStage(stage.id, (s) => ({
                                        ...s,
                                        outputs: s.outputs.map((entry, i) =>
                                          i === outputIndex
                                            ? { ...entry, itemId: value }
                                            : entry
                                        ),
                                      }))
                                    }
                                    options={data.items.map((item) => ({
                                      value: item.id,
                                      label: `${item.code} · ${item.name}`,
                                    }))}
                                    placeholder="Бүтээгдэхүүн..."
                                    disabled={readOnly}
                                  />
                                </div>
                                <select
                                  value={output.warehouseId}
                                  onChange={(event) =>
                                    patchStage(stage.id, (s) => ({
                                      ...s,
                                      outputs: s.outputs.map((entry, i) =>
                                        i === outputIndex
                                          ? { ...entry, warehouseId: event.target.value }
                                          : entry
                                      ),
                                    }))
                                  }
                                  disabled={readOnly}
                                  className="h-8 w-32 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-1.5 text-xs"
                                >
                                  <option value="">Агуулах...</option>
                                  {data.warehouses.map((warehouse) => (
                                    <option key={warehouse.id} value={warehouse.id}>
                                      {warehouse.code}
                                    </option>
                                  ))}
                                </select>
                                {!readOnly && (
                                  <button
                                    type="button"
                                    title="Мөр устгах"
                                    onClick={() =>
                                      patchStage(stage.id, (s) => ({
                                        ...s,
                                        outputs: s.outputs.filter(
                                          (_, i) => i !== outputIndex
                                        ),
                                      }))
                                    }
                                    className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--ea-text-4)] hover:bg-[var(--ea-danger)]/10 hover:text-[var(--ea-danger)]"
                                  >
                                    <Icon name="delete" size="xs" />
                                  </button>
                                )}
                              </div>
                              <div className="mt-1.5 flex items-center gap-1.5">
                                <input
                                  value={output.quantity}
                                  onChange={(event) =>
                                    patchStage(stage.id, (s) => ({
                                      ...s,
                                      outputs: s.outputs.map((entry, i) =>
                                        i === outputIndex
                                          ? { ...entry, quantity: event.target.value }
                                          : entry
                                      ),
                                    }))
                                  }
                                  disabled={readOnly}
                                  placeholder={`Тоо${itemUnit.get(output.itemId) ? ` (${itemUnit.get(output.itemId)})` : ""}`}
                                  className="h-8 w-28 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-right font-mono text-xs"
                                />
                                {base === "sales_value" && (
                                  <input
                                    value={output.salesPrice}
                                    onChange={(event) =>
                                      patchStage(stage.id, (s) => ({
                                        ...s,
                                        outputs: s.outputs.map((entry, i) =>
                                          i === outputIndex
                                            ? { ...entry, salesPrice: event.target.value }
                                            : entry
                                        ),
                                      }))
                                    }
                                    disabled={readOnly}
                                    placeholder="Борлуулах үнэ/нэгж"
                                    className="h-8 w-36 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-right font-mono text-xs"
                                  />
                                )}
                                {base === "manual" && (
                                  <input
                                    value={output.manualAmount}
                                    onChange={(event) =>
                                      patchStage(stage.id, (s) => ({
                                        ...s,
                                        outputs: s.outputs.map((entry, i) =>
                                          i === outputIndex
                                            ? {
                                                ...entry,
                                                manualAmount: event.target.value,
                                              }
                                            : entry
                                        ),
                                      }))
                                    }
                                    disabled={readOnly}
                                    placeholder="Дүн (гараар)"
                                    className="h-8 w-36 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-right font-mono text-xs"
                                  />
                                )}
                                <div className="ml-auto text-right">
                                  {saved?.allocatedAmount != null ? (
                                    <>
                                      <div className="font-mono text-xs font-semibold text-[var(--ea-text-1)]">
                                        {fmtMnt(saved.allocatedAmount)}
                                      </div>
                                      <div className="font-mono text-[10px] text-[var(--ea-text-4)]">
                                        {saved.unitCost != null
                                          ? `${saved.unitCost.toLocaleString("en-US", { maximumFractionDigits: 2 })} ₮/нэгж`
                                          : ""}
                                      </div>
                                    </>
                                  ) : (
                                    <span className="text-[10px] text-[var(--ea-text-4)]">
                                      тооцоогүй
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {!readOnly && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-fit text-xs"
                            onClick={() =>
                              patchStage(stage.id, (s) => ({
                                ...s,
                                outputs: [
                                  ...s.outputs,
                                  {
                                    itemId: "",
                                    warehouseId: "",
                                    quantity: "",
                                    salesPrice: "",
                                    manualAmount: "",
                                  },
                                ],
                              }))
                            }
                          >
                            <Icon name="add" size="xs" />
                            Гаралт нэмэх
                          </Button>
                        )}
                      </div>

                      {hasComputed && (
                        <p className="mt-2 text-right font-mono text-xs text-[var(--ea-text-3)]">
                          Хуваарилагдсан:{" "}
                          <span className="font-semibold text-[var(--ea-text-1)]">
                            {fmtMnt(allocated)}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {grandTotal > 0 && (
            <p className="mt-3 text-right font-mono text-sm">
              Нийт үйлдвэрлэлийн өртөг:{" "}
              <span className="font-bold text-[var(--ea-text-1)]">
                {fmtMnt(grandTotal)}
              </span>
            </p>
          )}
        </div>
      </div>

      {confirmDialog}
    </div>
  );
}
