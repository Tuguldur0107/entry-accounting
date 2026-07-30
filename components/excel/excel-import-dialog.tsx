"use client";

// НИЙТЛЭГ Excel импортын диалог — стандартын UI тал (CLAUDE.md "Excel
// импорт/экспортын стандарт"). Аль ч спекээр ажиллана:
//
//   Файл сонгох → урьдчилан харах (мөр бүрийн алдаа) → "N зөв мөрийг оруулах"
//
// Зөвхөн ЗӨВ мөрүүд орно; алдаатай мөр хэзээ ч чимээгүй орохгүй. "Загвар
// татах" нь МӨН СПЕКЭЭСЭЭ үүсдэг тул parser-аас зөрөх боломжгүй.

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { downloadTemplate, readWorkbookMatrix } from "@/lib/excel/core";
import {
  parseMatrix,
  type ImportSpec,
  type ParseResult,
} from "@/lib/excel/import-spec";
import { cn } from "@/lib/utils";

interface Props<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spec: ImportSpec<T>;
  /** Диалогийн гарчиг, жишээ нь "Журналын мөр импортлох". */
  title: string;
  /**
   * Зөв мөрүүдийг хүлээн авна. Алдааны текст буцаавал диалог дээр
   * харагдана, юу ч буцаахгүй бол хаагдана.
   */
  onImport: (values: T[]) => Promise<string | void> | string | void;
}

type State<T> =
  | { step: "pick" }
  | { step: "parsing" }
  | { step: "preview"; fileName: string; result: ParseResult<T> }
  | { step: "importing"; fileName: string; result: ParseResult<T> };

export function ExcelImportDialog<T>({
  open,
  onOpenChange,
  spec,
  title,
  onImport,
}: Props<T>) {
  const [state, setState] = useState<State<T>>({ step: "pick" });
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setState({ step: "pick" });
    setImportError(null);
  }

  async function handleFile(file: File) {
    setImportError(null);
    setState({ step: "parsing" });
    try {
      const matrix = await readWorkbookMatrix(file);
      setState({
        step: "preview",
        fileName: file.name,
        result: parseMatrix(matrix, spec),
      });
    } catch {
      setImportError("Файлыг уншиж чадсангүй — .xlsx файл мөн эсэхийг шалгана уу.");
      setState({ step: "pick" });
    }
  }

  async function handleImport() {
    if (state.step !== "preview") return;
    const values = state.result.rows
      .filter((row) => row.errors.length === 0)
      .map((row) => row.value as T);
    if (values.length === 0) return;

    setState({ ...state, step: "importing" });
    try {
      const error = await onImport(values);
      if (error) {
        setImportError(error);
        setState({ ...state, step: "preview" });
        return;
      }
      reset();
      onOpenChange(false);
    } catch {
      setImportError("Оруулахад алдаа гарлаа. Дахин оролдоно уу.");
      setState({ ...state, step: "preview" });
    }
  }

  const result =
    state.step === "preview" || state.step === "importing" ? state.result : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="spreadsheet" size="sm" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {/* Алхам 1 — файл сонгох */}
        {(state.step === "pick" || state.step === "parsing") && (
          <div className="flex flex-col items-center gap-4 py-8">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Ижил файлыг дахин сонгоход ч ажиллуулна.
                event.target.value = "";
                if (file) handleFile(file);
              }}
            />
            <button
              type="button"
              disabled={state.step === "parsing"}
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full max-w-md flex-col items-center gap-2 rounded-lg border-2 border-dashed border-[var(--ea-border-strong)] px-6 py-10 text-sm text-[var(--ea-text-3)] transition-colors hover:border-[var(--ea-primary)] hover:text-[var(--ea-text-1)]"
            >
              {state.step === "parsing" ? (
                <>
                  <Icon name="loading" className="animate-spin" />
                  Уншиж байна…
                </>
              ) : (
                <>
                  <Icon name="upload" />
                  .xlsx файл сонгох
                  <span className="text-xs text-[var(--ea-text-4)]">
                    Эхний мөр = баганын нэр. Багана НЭРЭЭР танигдана.
                  </span>
                </>
              )}
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadTemplate(spec)}
            >
              <Icon name="download" size="sm" />
              Загвар татах
            </Button>
            {importError && (
              <p className="text-sm text-[var(--ea-danger-fg)]">{importError}</p>
            )}
          </div>
        )}

        {/* Алхам 2 — урьдчилан харах */}
        {result && (
          <div className="flex min-h-0 flex-col gap-3">
            {/* Толгойн алдаа — юу ч оруулж болохгүй */}
            {result.headerErrors.length > 0 ? (
              <div className="rounded-md border border-[var(--ea-danger)] bg-[var(--ea-danger)]/5 p-3 text-sm">
                <p className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--ea-danger-fg)]">
                  <Icon name="error" size="sm" />
                  Файлын толгой буруу байна
                </p>
                <ul className="list-inside list-disc text-[var(--ea-danger-fg)]">
                  {result.headerErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[var(--ea-text-3)]">
                  &quot;Загвар татах&quot; файлын толгойг ашиглана уу.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium text-[var(--ea-text-1)]">
                  {state.step === "preview" || state.step === "importing"
                    ? state.fileName
                    : ""}
                </span>
                <span className="flex items-center gap-1 text-[var(--ea-success-fg)]">
                  <Icon name="success" size="sm" />
                  {result.validCount} зөв
                </span>
                {result.errorCount > 0 && (
                  <span className="flex items-center gap-1 text-[var(--ea-danger-fg)]">
                    <Icon name="warning" size="sm" />
                    {result.errorCount} алдаатай (орохгүй)
                  </span>
                )}
              </div>
            )}

            {/* Мөрийн урьдчилан харалт */}
            {result.rows.length > 0 && (
              <div className="max-h-80 overflow-auto rounded-md border border-[var(--ea-border)]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--ea-bg-2)] text-left">
                    <tr>
                      <th className="px-2 py-1.5 font-medium text-[var(--ea-text-3)]">
                        Мөр
                      </th>
                      {spec.columns.map((column) => (
                        <th
                          key={column.key}
                          className="px-2 py-1.5 font-medium text-[var(--ea-text-3)]"
                        >
                          {column.header}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 font-medium text-[var(--ea-text-3)]">
                        Төлөв
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr
                        key={row.rowNumber}
                        className={cn(
                          "border-t border-[var(--ea-border)]",
                          row.errors.length > 0 && "bg-[var(--ea-danger)]/5"
                        )}
                      >
                        <td className="px-2 py-1.5 font-mono text-[var(--ea-text-4)]">
                          {row.rowNumber}
                        </td>
                        {spec.columns.map((column) => (
                          <td
                            key={column.key}
                            className="max-w-40 truncate px-2 py-1.5 text-[var(--ea-text-1)]"
                            title={row.record[column.key]}
                          >
                            {row.record[column.key]}
                          </td>
                        ))}
                        <td className="px-2 py-1.5">
                          {row.errors.length === 0 ? (
                            <Icon
                              name="success"
                              size="sm"
                              className="text-[var(--ea-success-fg)]"
                            />
                          ) : (
                            <span
                              className="text-[var(--ea-danger-fg)]"
                              title={row.errors.join("\n")}
                            >
                              {row.errors.join("; ")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {importError && (
              <p className="text-sm text-[var(--ea-danger-fg)]">{importError}</p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Өөр файл сонгох
              </Button>
              <Button
                type="button"
                onClick={handleImport}
                disabled={state.step === "importing" || result.validCount === 0}
              >
                {state.step === "importing" ? (
                  <Icon name="loading" size="sm" className="animate-spin" />
                ) : (
                  <Icon name="upload" size="sm" />
                )}
                {result.validCount} зөв мөрийг оруулах
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
