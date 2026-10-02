"use client";

// eTax маягтын НҮДНИЙ ХОЛБОЛТ (docs/dev/etax.md §4) — ТЕГ-ийн динамик маягтын (getFormDetail)
// нүднүүдээс Entry-ийн НӨАТ-ын талбар бүрд харгалзах нүдийг админ нэг удаа сонгоно.
// Аль нүд аль дүн болохыг спек хэлдэггүй тул ЭНД таамаглахгүй — хүн сонгоно; дүн зохиогдохгүй.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchEtaxFormTemplate, getEtaxReportChoices, saveEtaxFormMapping } from "@/lib/actions/etax";
import { fmtDateTimeUb } from "@/lib/format/datetime";
import { describeCell } from "@/lib/itc/etax/api";
import { ETAX_VAT_FIELDS, ETAX_VAT_FIELD_LABELS, type EtaxVatField } from "@/lib/itc/etax/constants";
import type { EtaxMappingView, EtaxReportChoice } from "@/lib/itc/etax/types";
import { feedback } from "@/lib/ui/feedback";

const selectClass =
  "h-8 w-full rounded-md border border-[var(--ea-border-strong)] bg-[var(--ea-surface)] px-2 text-xs text-[var(--ea-text-1)]";

export function EtaxMappingEditor({ mapping, periodCode, enabled }: { mapping: EtaxMappingView | null; periodCode: string; enabled: boolean }) {
  const router = useRouter();
  const [choices, setChoices] = useState<EtaxReportChoice[] | null>(null);
  const [choiceKey, setChoiceKey] = useState<string>(mapping ? `${mapping.taxTypeId}:${mapping.formNo}` : "");
  const [cells, setCells] = useState<Partial<Record<EtaxVatField, string | null>>>(mapping?.cells ?? {});
  const [isPending, startTransition] = useTransition();

  // Эцэг нь `key`-ээр дахин mount хийнэ (холболт/загвар шинэчлэгдэхэд) — effect-ээр state тавихгүй.
  const templateCells = useMemo(() => mapping?.templateCells ?? [], [mapping]);
  const cellOptions = useMemo(
    () => templateCells.map((cell) => ({ value: cell.key, label: describeCell(cell), computed: cell.hasExpression })),
    [templateCells]
  );

  function loadChoices() {
    startTransition(async () => {
      const { error, choices: loaded } = await getEtaxReportChoices();
      if (error || !loaded) {
        feedback.error(error ?? "Жагсаалт татагдсангүй");
        return;
      }
      setChoices(loaded);
      if (!choiceKey) {
        const vat = loaded.find((c) => /НӨАТ|нэмэгдсэн/iu.test(`${c.taxTypeName} ${c.taxReportCode}`));
        if (vat) setChoiceKey(`${vat.taxTypeId}:${vat.formNo}`);
      }
      feedback.saved(`ТЕГ-ийн тушаах жагсаалт: ${loaded.length} төрөл`);
    });
  }

  function fetchTemplate() {
    const choice = choices?.find((c) => `${c.taxTypeId}:${c.formNo}` === choiceKey);
    const [taxTypeId, formNo] = choiceKey.split(":").map(Number);
    if (!taxTypeId || !formNo) {
      feedback.error("Татварын төрөл / маягтаа сонгоно уу");
      return;
    }
    startTransition(async () => {
      const { error, mapping: loaded } = await fetchEtaxFormTemplate({ taxTypeId, formNo, taxTypeName: choice?.taxTypeName ?? null, periodCode });
      if (error || !loaded) feedback.error(error ?? "Загвар татагдсангүй");
      else feedback.saved(`Маягтын загвар ${loaded.reportCode ?? loaded.formNo} — ${loaded.templateCells.length} нүд`);
      router.refresh();
    });
  }

  function save() {
    startTransition(async () => {
      const { error, mapping: saved } = await saveEtaxFormMapping({ cells: cells as Record<string, string | null> });
      if (error || !saved) feedback.error(error ?? "Холболт хадгалагдсангүй");
      else feedback.saved(saved.problems.length ? `Хадгалагдлаа — дутуу: ${saved.problems.join("; ")}` : "Маягтын холболт бүрэн");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: "var(--ea-border)", background: "var(--ea-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Маягтын нүдний холболт</h2>
          <p className="text-xs text-[var(--ea-text-3)]">
            ТЕГ-ийн маягт динамик тул Entry-ийн НӨАТ-ын талбар бүрийг маягтын аль нүдэнд бичихийг нэг удаа заана. Томьёотой нүдийг
            ТЕГ өөрөө бодно — сонгохгүй.
          </p>
        </div>
        {mapping ? (
          mapping.problems.length ? (
            <StatusBadge tone="warning" size="sm">
              Дутуу {mapping.problems.length}
            </StatusBadge>
          ) : (
            <StatusBadge tone="success" size="sm">
              Бүрэн
            </StatusBadge>
          )
        ) : (
          <StatusBadge tone="muted" size="sm">
            Тохируулаагүй
          </StatusBadge>
        )}
      </div>

      {!enabled ? (
        <p className="text-xs text-[var(--ea-text-3)]">Эхлээд холболтоо хадгалж «Байгууллага татах» хийнэ.</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
            <FormField label="Татварын төрөл · маягт (ТЕГ-ийн тушаах жагсаалтаас)" htmlFor="etax-choice">
              <select id="etax-choice" className={selectClass} value={choiceKey} onChange={(e) => setChoiceKey(e.target.value)} disabled={isPending}>
                {!choices && mapping ? (
                  <option value={`${mapping.taxTypeId}:${mapping.formNo}`}>
                    {mapping.taxTypeName ?? mapping.taxTypeId} · {mapping.reportCode ?? mapping.formNo}
                  </option>
                ) : null}
                {!choices && !mapping ? <option value="">— жагсаалт татна уу —</option> : null}
                {choices?.map((c) => (
                  <option key={`${c.taxTypeId}:${c.formNo}`} value={`${c.taxTypeId}:${c.formNo}`}>
                    {c.taxTypeName} · {c.taxReportCode || c.formNo} · {c.periodName}
                  </option>
                ))}
              </select>
            </FormField>
            <Button size="sm" variant="outline" onClick={loadChoices} disabled={isPending}>
              Жагсаалт татах
            </Button>
            <Button size="sm" variant="outline" onClick={fetchTemplate} disabled={isPending || !choiceKey}>
              Загвар татах
            </Button>
          </div>

          {mapping ? (
            <>
              <div className="text-xs text-[var(--ea-text-3)]">
                Загвар: {mapping.reportCode ?? "—"} (маягт №{mapping.formNo}, хувилбар {mapping.templateVersion ?? "—"}) · татсан{" "}
                {fmtDateTimeUb(mapping.templateFetchedAt) ?? "—"} · {templateCells.length} нүд
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {ETAX_VAT_FIELDS.map((field) => (
                  <FormField key={field} label={ETAX_VAT_FIELD_LABELS[field]} htmlFor={`etax-cell-${field}`}>
                    <select
                      id={`etax-cell-${field}`}
                      className={selectClass}
                      value={cells[field] ?? ""}
                      onChange={(e) => setCells((prev) => ({ ...prev, [field]: e.target.value || null }))}
                      disabled={isPending || templateCells.length === 0}
                    >
                      <option value="">— холбохгүй —</option>
                      {cellOptions.map((opt) => (
                        <option key={opt.value} value={opt.value} disabled={opt.computed}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                ))}
              </div>
              {mapping.problems.length ? (
                <ul className="list-disc pl-5 text-xs text-[var(--ea-warning-fg)]">
                  {mapping.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
              <Button size="sm" onClick={save} disabled={isPending || templateCells.length === 0}>
                Холболт хадгалах
              </Button>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
