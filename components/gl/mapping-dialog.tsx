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
import { ACCOUNT_GROUPS, getSegmentKey } from "@/lib/constants/standard-accounts";
import { fmtMnt } from "@/lib/reports/balances";

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
  /**
   * Net balance (debit - credit) per main-account code as of the report
   * date. Used to surface each account's relevance directly in the
   * dialog — accountants can pick lines based on balances, not just
   * names. Missing entries are treated as zero.
   */
  accountBalances?: Map<string, number>;
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
  accountBalances,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialAccounts));
  const [query, setQuery] = useState("");
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const balanceOf = (code: string) => accountBalances?.get(code) ?? 0;

  // Sort + group by first-digit category. Within each group the codes
  // ascend numerically so the dialog mirrors the chart of accounts.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allAccounts.filter((a) => {
      if (onlyWithBalance && balanceOf(a.number) === 0 && !selected.has(a.number)) {
        return false;
      }
      if (!q) return true;
      return (
        a.number.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q)
      );
    });
    const byKey: Record<string, ChartOfAccount[]> = {};
    for (const a of filtered) {
      const key = getSegmentKey(a.number);
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(a);
    }
    Object.values(byKey).forEach((arr) => arr.sort((a, b) => a.number.localeCompare(b.number)));
    return Object.entries(byKey).sort(([a], [b]) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAccounts, query, onlyWithBalance, selected, accountBalances]);

  const totalFilteredCount = grouped.reduce((s, [, list]) => s + list.length, 0);

  // Net of selection on visible items — for "Бүгдийг сонгох" + selected sum hint.
  const selectedSum = useMemo(() => {
    let sum = 0;
    selected.forEach((code) => {
      sum += balanceOf(code);
    });
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, accountBalances]);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function handleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      grouped.forEach(([, list]) => list.forEach((a) => next.add(a.number)));
      return next;
    });
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
        else {
          setSelected(new Set(initialAccounts));
          setQuery("");
          setOnlyWithBalance(false);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <span className="text-[var(--ea-text-3)] text-xs font-normal mr-2">
              Дансны mapping
            </span>
            {lineLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-[var(--ea-text-3)]">
            Энэ мөрийн дүнд оруулах GL дансуудыг сонгоно уу. Үлдэгдэл нь
            тайлангийн он сар үед таны бичсэн журналаар тооцоологдов.
          </p>

          {/* Toolbar — search + filters */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="Код эсвэл нэрээр хайх…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              className="h-9 flex-1"
            />
            <label className="flex items-center gap-1.5 text-xs text-[var(--ea-text-2)] whitespace-nowrap select-none cursor-pointer">
              <input
                type="checkbox"
                checked={onlyWithBalance}
                onChange={(e) => setOnlyWithBalance(e.target.checked)}
                className="w-3.5 h-3.5 accent-[var(--ea-primary)]"
              />
              Зөвхөн үлдэгдэлтэй
            </label>
          </div>

          {/* Stats + bulk actions */}
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={handleSelectAllVisible}
              className="text-[var(--ea-primary)] hover:underline"
            >
              Бүгдийг сонгох ({totalFilteredCount})
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="text-[var(--ea-text-3)] hover:underline"
            >
              Цэвэрлэх
            </button>
            <span className="ml-auto flex items-center gap-3">
              <span className="text-[var(--ea-text-3)]">
                Сонгосон: <span className="font-medium text-[var(--ea-text-1)]">{selected.size}</span>
              </span>
              {accountBalances && (
                <span className="text-[var(--ea-text-3)]">
                  Нийт үлдэгдэл:{" "}
                  <span
                    className={`font-mono font-medium tabular-nums ${
                      selectedSum < 0
                        ? "text-[var(--ea-danger-fg)]"
                        : "text-[var(--ea-text-1)]"
                    }`}
                  >
                    {fmtMnt(selectedSum)}
                  </span>
                </span>
              )}
            </span>
          </div>

          {/* Account list grouped by main-account category */}
          <div
            className="border border-[var(--ea-border)] rounded-md max-h-[420px] overflow-y-auto"
            style={{ background: "var(--ea-surface)" }}
          >
            {grouped.length === 0 ? (
              <div className="px-3 py-8 text-xs text-center text-[var(--ea-text-4)]">
                Илэрц олдсонгүй
              </div>
            ) : (
              grouped.map(([groupKey, list]) => (
                <div key={groupKey}>
                  <div
                    className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider sticky top-0 z-10 border-b border-[var(--ea-border)]"
                    style={{
                      background: "var(--ea-bg-2)",
                      color: "var(--ea-text-3)",
                    }}
                  >
                    {groupKey}x — {ACCOUNT_GROUPS[groupKey] ?? ""}
                  </div>
                  {list.map((a) => {
                    const checked = selected.has(a.number);
                    const bal = balanceOf(a.number);
                    const hasBal = bal !== 0;
                    return (
                      <label
                        key={a.id}
                        className="flex items-center gap-3 px-3 py-2 text-xs hover:bg-[var(--ea-bg-2)] cursor-pointer border-b border-[var(--ea-border)] last:border-b-0 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(a.number)}
                          className="w-3.5 h-3.5 accent-[var(--ea-primary)] shrink-0"
                        />
                        <span className="font-mono text-[var(--ea-primary-500)] w-[80px] shrink-0">
                          {a.number}
                        </span>
                        <span className="flex-1 truncate text-[var(--ea-text-1)]">
                          {a.name}
                        </span>
                        <span
                          className={`font-mono tabular-nums text-right shrink-0 w-[140px] ${
                            !hasBal
                              ? "text-[var(--ea-text-4)]"
                              : bal < 0
                              ? "text-[var(--ea-danger-fg)]"
                              : "text-[var(--ea-text-1)]"
                          }`}
                          title={hasBal ? "Цэвэр үлдэгдэл (Дебет − Кредит)" : "Үлдэгдэлгүй"}
                        >
                          {hasBal ? fmtMnt(bal) : "—"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))
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
