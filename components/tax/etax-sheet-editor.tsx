"use client";

// eTax хавсралт МЭДЭЭНИЙ холболт (docs/dev/etax.md §7) — ТЕГ-д хадгалсан (reportNo-той)
// тайлангийн мэдээний загваруудыг татаж, мэдээ бүрд ЭХ (борлуулалт / худалдан авалтын
// задаргаа / илгээхгүй), нэгтгэл, Entry талбар → ТЕГ-ийн багана холболтыг админ нэг удаа
// тохируулна. Багана, дүн ТААХГҮЙ — хүн сонгоно; дүн Entry-ийн баримтаас л.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { fetchEtaxSheetTemplatesAction, saveEtaxSheetMappingsAction } from "@/lib/actions/etax";
import { fmtDateTimeUb } from "@/lib/format/datetime";
import { describeSheetColumn, type EtaxSheetMapping } from "@/lib/itc/etax/api";
import {
  ETAX_SHEET_FIELDS,
  ETAX_SHEET_FIELD_LABELS,
  ETAX_SHEET_GRANULARITIES,
  ETAX_SHEET_GRANULARITY_LABELS,
  ETAX_SHEET_SOURCES,
  ETAX_SHEET_SOURCE_LABELS,
  type EtaxSheetField,
} from "@/lib/itc/etax/constants";
import type { EtaxMappingView } from "@/lib/itc/etax/types";
import { feedback } from "@/lib/ui/feedback";

const selectClass =
  "h-8 w-full rounded-md border border-[var(--ea-border-strong)] bg-[var(--ea-surface)] px-2 text-xs text-[var(--ea-text-1)]";

export function EtaxSheetEditor({ mapping, savedSubmissionId }: { mapping: EtaxMappingView | null; savedSubmissionId: string | null }) {
  const router = useRouter();
  const [sheets, setSheets] = useState<EtaxSheetMapping[]>(mapping?.sheets ?? []);
  const [isPending, startTransition] = useTransition();
  const templates = mapping?.sheetTemplates ?? [];

  function patchSheet(code: string, patch: Partial<EtaxSheetMapping>) {
    setSheets((prev) => prev.map((s) => (s.sheetCode === code ? { ...s, ...patch } : s)));
  }
  function patchColumn(code: string, field: EtaxSheetField, value: string) {
    setSheets((prev) => prev.map((s) => (s.sheetCode === code ? { ...s, columns: { ...s.columns, [field]: value || null } } : s)));
  }

  function fetchTemplates() {
    if (!savedSubmissionId) return;
    startTransition(async () => {
      const { error, mapping: loaded } = await fetchEtaxSheetTemplatesAction({ submissionId: savedSubmissionId });
      if (error || !loaded) feedback.error(error ?? "Мэдээний загвар татагдсангүй");
      else feedback.saved(`Мэдээний загвар: ${loaded.sheetTemplates.length} мэдээ`);
      router.refresh();
    });
  }

  function save() {
    startTransition(async () => {
      const { error, mapping: saved } = await saveEtaxSheetMappingsAction({ sheets });
      if (error || !saved) feedback.error(error ?? "Мэдээний холболт хадгалагдсангүй");
      else feedback.saved(saved.sheetProblems.length ? `Хадгалагдлаа — дутуу: ${saved.sheetProblems.join("; ")}` : "Мэдээний холболт бүрэн");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: "var(--ea-border)", background: "var(--ea-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Хавсралт мэдээний холболт</h2>
          <p className="text-xs text-[var(--ea-text-3)]">
            Маягтын хавсралт мэдээ (борлуулалт / худалдан авалтын задаргаа) бүрд Entry-ийн аль задаргааг, аль баганад бичихийг заана.
            Мэдээний жагсаалт ТЕГ-д хадгалсан тайлан шаарддаг — эхлээд «ТЕГ-д хадгалах».
          </p>
        </div>
        {templates.length ? (
          mapping?.sheetProblems.length ? (
            <StatusBadge tone="warning" size="sm">
              Дутуу {mapping.sheetProblems.length}
            </StatusBadge>
          ) : (
            <StatusBadge tone="success" size="sm">
              {sheets.filter((s) => s.source).length}/{templates.length} эхтэй
            </StatusBadge>
          )
        ) : (
          <StatusBadge tone="muted" size="sm">
            Загвар татаагүй
          </StatusBadge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ea-text-3)]">
        <Button size="sm" variant="outline" onClick={fetchTemplates} disabled={isPending || !savedSubmissionId} title={savedSubmissionId ? undefined : "Энэ сарын тайланг ТЕГ-д хадгалсны дараа"}>
          Мэдээний загвар татах
        </Button>
        {mapping?.sheetTemplatesFetchedAt ? <span>татсан {fmtDateTimeUb(mapping.sheetTemplatesFetchedAt)}</span> : null}
      </div>

      {templates.map((template) => {
        const sheet = sheets.find((s) => s.sheetCode === template.sheetCode);
        if (!sheet) return null;
        return (
          <div key={template.sheetCode} className="space-y-2 rounded-md border p-3" style={{ borderColor: "var(--ea-border)" }}>
            <div className="text-xs font-medium text-[var(--ea-text-1)]">
              {template.sheetCode} — {template.sheetLabel || template.sheetName} ({template.columns.length} багана)
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <FormField label="Эх өгөгдөл" htmlFor={`sheet-src-${template.sheetCode}`}>
                <select
                  id={`sheet-src-${template.sheetCode}`}
                  className={selectClass}
                  value={sheet.source ?? ""}
                  onChange={(e) => patchSheet(template.sheetCode, { source: (e.target.value || null) as EtaxSheetMapping["source"] })}
                  disabled={isPending}
                >
                  <option value="">— илгээхгүй —</option>
                  {ETAX_SHEET_SOURCES.map((src) => (
                    <option key={src} value={src}>
                      {ETAX_SHEET_SOURCE_LABELS[src]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Нэгтгэл" htmlFor={`sheet-gran-${template.sheetCode}`}>
                <select
                  id={`sheet-gran-${template.sheetCode}`}
                  className={selectClass}
                  value={sheet.granularity}
                  onChange={(e) => patchSheet(template.sheetCode, { granularity: e.target.value as EtaxSheetMapping["granularity"] })}
                  disabled={isPending || !sheet.source}
                >
                  {ETAX_SHEET_GRANULARITIES.map((g) => (
                    <option key={g} value={g}>
                      {ETAX_SHEET_GRANULARITY_LABELS[g]}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            {sheet.source ? (
              <div className="grid gap-2 md:grid-cols-3">
                {ETAX_SHEET_FIELDS.map((field) => (
                  <FormField key={field} label={ETAX_SHEET_FIELD_LABELS[field]} htmlFor={`sheet-col-${template.sheetCode}-${field}`}>
                    <select
                      id={`sheet-col-${template.sheetCode}-${field}`}
                      className={selectClass}
                      value={sheet.columns[field] ?? ""}
                      onChange={(e) => patchColumn(template.sheetCode, field, e.target.value)}
                      disabled={isPending}
                    >
                      <option value="">— холбохгүй —</option>
                      {template.columns.map((col) => (
                        <option key={col.columnKey} value={col.columnKey} disabled={col.hasExpression}>
                          {describeSheetColumn(col)}
                        </option>
                      ))}
                    </select>
                  </FormField>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {mapping?.sheetProblems.length ? (
        <ul className="list-disc pl-5 text-xs text-[var(--ea-warning-fg)]">
          {mapping.sheetProblems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {templates.length ? (
        <Button size="sm" onClick={save} disabled={isPending}>
          Мэдээний холболт хадгалах
        </Button>
      ) : null}
    </div>
  );
}
