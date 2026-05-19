"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { saveReportMapping } from "@/lib/actions/report-mappings";
import type { ChartOfAccount } from "@/lib/db/schema";
import type { ReportType } from "@/lib/actions/report-mappings";

interface Props {
  open: boolean;
  onClose: () => void;
  reportType: ReportType;
  lineKey: string;
  lineLabel: string;
  /** Currently selected account numbers (8-digit codes). */
  initialAccounts: string[];
  /** Full chart of accounts to choose from. */
  allAccounts: ChartOfAccount[];
}

// Modal for configuring which GL accounts roll up into a single report
// line. The dialog is opened from the "Mapping" icon next to each line
// in the Balance Sheet (and, later, other reports). State is local;
// saving triggers a Server Action that persists the choice in
// `report_line_mappings`.
export function MappingDialog({
  open,
  onClose,
  reportType,
  lineKey,
  lineLabel,
  initialAccounts,
  allAccounts,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialAccounts));
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Re-sync the local selection set whenever the dialog opens with a new
  // line (initialAccounts is read on mount; reset on prop change).
  // We use an effect-equivalent here via a ref-less pattern:
  //   when open transitions false→true we rebuild from initialAccounts.
  // Implemented in the onOpenChange handler below.

  const sortedAccounts = useMemo(
    () => [...allAccounts].sort((a, b) => a.number.localeCompare(b.number)),
    [allAccounts]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return sortedAccounts;
    const q = query.toLowerCase();
    return sortedAccounts.filter(
      (a) => a.number.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  }, [sortedAccounts, query]);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function handleSelectAll() {
    setSelected(new Set(filtered.map((a) => a.number)));
  }

  function handleClear() {
    setSelected(new Set());
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await saveReportMapping(reportType, lineKey, [...selected]);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
        else setSelected(new Set(initialAccounts));
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Дансны mapping — {lineLabel}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-[var(--ea-text-3)]">
            Энэ мөрийн дүнд оруулах GL дансуудыг сонгоно уу. Дансгүй үлдээвэл
            тухайн мөр стандарт prefix-ийн дагуу автомат тооцоологдоно.
          </p>
          <Input
            placeholder="Хайх…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-[var(--ea-primary)] hover:underline"
            >
              Бүгдийг сонгох
            </button>
            <span className="text-[var(--ea-text-4)]">·</span>
            <button
              type="button"
              onClick={handleClear}
              className="text-[var(--ea-text-3)] hover:underline"
            >
              Цэвэрлэх
            </button>
            <span className="ml-auto text-[var(--ea-text-4)]">
              {selected.size} / {sortedAccounts.length}
            </span>
          </div>
          <div
            className="border border-[var(--ea-border)] rounded-md max-h-[320px] overflow-y-auto"
            style={{ background: "var(--ea-surface)" }}
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-xs text-center text-[var(--ea-text-4)]">
                Илэрц олдсонгүй
              </div>
            ) : (
              filtered.map((a) => {
                const checked = selected.has(a.number);
                return (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--ea-bg-2)] cursor-pointer border-b border-[var(--ea-border)] last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(a.number)}
                      className="w-3.5 h-3.5 accent-[var(--ea-primary)]"
                    />
                    <span className="font-mono text-[var(--ea-primary-500)] w-[80px] shrink-0">
                      {a.number}
                    </span>
                    <span className="truncate text-[var(--ea-text-1)]">{a.name}</span>
                  </label>
                );
              })
            )}
          </div>
          {error && (
            <p className="text-xs text-[var(--ea-danger)] bg-[var(--ea-danger-bg)] px-3 py-2 rounded">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Болих
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending}
            className="bg-[var(--ea-primary)] hover:bg-[var(--ea-primary-700)]"
          >
            {isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
