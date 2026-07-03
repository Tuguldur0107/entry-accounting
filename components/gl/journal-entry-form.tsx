"use client";

import { useCallback, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { createVoucher, updateVoucher } from "@/lib/actions/gl";
import type { ChartOfAccount, SegmentValue } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtMnt } from "@/lib/reports/balances";
import { buildSegCode } from "@/lib/grid/segments";
import {
  JournalLinesGrid,
  type JournalLineRow,
} from "@/components/journal/journal-lines-grid";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

function closeWindow() {
  if (typeof window === "undefined") return;
  if (window.opener) {
    window.opener.location.reload();
    window.close();
  } else {
    window.location.href = "/gl/journal";
  }
}

interface InitialLine {
  account: string;
  debit: string | number;
  credit: string | number;
  description: string;
}

interface InitialVoucher {
  date: string;
  description: string;
  lines: InitialLine[];
}

interface Props {
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  segmentValues: SegmentValue[];
  defaultSegments?: Record<number, string>;
  voucherId?: string;
  initialVoucher?: InitialVoucher;
}

const fmt = (n: number) => fmtMnt(n);

export function JournalEntryForm({
  accounts,
  activeSegIds,
  segmentValues,
  defaultSegments = {},
  voucherId,
  initialVoucher,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!voucherId;

  const makeEmptyLine = useCallback((): JournalLineRow => {
    const parts: Record<number, string> = {};
    for (const id of activeSegIds) parts[id] = defaultSegments[id] ?? "";
    return {
      id: nanoid(),
      account: buildSegCode(parts, activeSegIds, defaultSegments),
      debit: 0,
      credit: 0,
      description: "",
    };
  }, [activeSegIds, defaultSegments]);

  const [date, setDate] = useState(initialVoucher?.date ?? today);
  const [description, setDescription] = useState(initialVoucher?.description ?? "");
  const [lines, setLines] = useState<JournalLineRow[]>(() => {
    if (initialVoucher?.lines && initialVoucher.lines.length >= 2) {
      return initialVoucher.lines.map((l) => ({
        id: nanoid(),
        account: l.account,
        debit: typeof l.debit === "number" ? l.debit : parseFloat(String(l.debit)) || 0,
        credit: typeof l.credit === "number" ? l.credit : parseFloat(String(l.credit)) || 0,
        description: l.description,
      }));
    }
    return [makeEmptyLine(), makeEmptyLine()];
  });

  const [saving, setSaving] = useState<"draft" | "posted" | null>(null);
  const [error, setError] = useState("");

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const diff = totalDebit - totalCredit;
  const isEmpty = totalDebit === 0 && totalCredit === 0;
  const balanced = !isEmpty && Math.abs(diff) <= 0.01;

  const segOptions = useMemo<Record<number, SegOption[]>>(() => {
    const map: Record<number, SegOption[]> = {};
    for (const segId of activeSegIds) {
      map[segId] =
        segId === 3
          ? accounts.map((a) => ({ code: a.number, name: a.name }))
          : segmentValues
              .filter((sv) => sv.segmentId === segId)
              .map((sv) => ({ code: sv.code, name: sv.name }));
    }
    return map;
  }, [activeSegIds, accounts, segmentValues]);

  async function handleSave(status: "draft" | "posted") {
    if (!date || !description.trim()) {
      setError("Огноо ба гүйлгээний утгыг бөглөнө үү");
      return;
    }
    if (status === "posted" && !balanced) return;
    setSaving(status);
    setError("");
    try {
      const payload = {
        date,
        description: description.trim(),
        status,
        lines: lines.map((l) => ({
          account: l.account,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
        })),
      };
      if (isEdit && voucherId) {
        await updateVoucher(voucherId, payload);
      } else {
        await createVoucher(payload);
      }
      closeWindow();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Алдаа гарлаа");
      setSaving(null);
    }
  }

  return (
    <div
      className="h-screen flex flex-col"
      style={{ background: "var(--ea-bg)", fontFamily: "var(--ea-font-sans)" }}
    >
      <header
        className="px-6 flex items-center shrink-0 h-12 gap-3"
        style={{
          background: "var(--ea-surface)",
          borderBottom: "1px solid var(--ea-border)",
        }}
      >
        <Button variant="ghost" size="sm" onClick={closeWindow}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Буцах
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <span className="text-sm font-semibold" style={{ color: "var(--ea-text-1)" }}>
          {isEdit ? "Журнал засах" : "Журнал бичих"}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto py-6 px-6">
        <div className="max-w-screen-xl mx-auto space-y-4">
          <div
            className="p-5"
            style={{
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border)",
              borderRadius: 10,
            }}
          >
            <div className="grid gap-5" style={{ gridTemplateColumns: "180px 1fr" }}>
              <div className="space-y-1.5">
                <Label htmlFor="voucher-date">Огноо</Label>
                <Input
                  id="voucher-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="voucher-description">Гүйлгээний утга</Label>
                <Input
                  id="voucher-description"
                  type="text"
                  placeholder="Гүйлгээний тайлбар оруулна уу"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div
            style={{
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <JournalLinesGrid
              lines={lines}
              onLinesChange={setLines}
              activeSegIds={activeSegIds}
              segOptions={segOptions}
              defaultSegments={defaultSegments}
              onError={setError}
            />
          </div>
        </div>
      </div>

      <footer
        className="px-6 py-3 flex items-center justify-between shrink-0"
        style={{
          background: "var(--ea-surface)",
          borderTop: "1px solid var(--ea-border)",
        }}
      >
        <div className="flex items-center gap-3">
          <StatusBadge tone={isEmpty ? "muted" : balanced ? "success" : "danger"}>
            {isEmpty ? "Дүн оруулаагүй" : balanced ? "✓ Тэнцсэн" : `Зөрүү: ${fmt(diff)}`}
          </StatusBadge>
          {error && (
            <span className="text-sm" style={{ color: "var(--ea-danger)" }}>
              {error}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setLines((p) => [...p, makeEmptyLine()])}
          >
            + Мөр нэмэх
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <Button variant="outline" onClick={closeWindow}>
            Болих
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSave("draft")}
            disabled={saving !== null}
          >
            {saving === "draft" ? "Хадгалж байна..." : "Ноорог"}
          </Button>
          <Button
            onClick={() => handleSave("posted")}
            disabled={!balanced || saving !== null}
          >
            {saving === "posted" ? "Хадгалж байна..." : "Хадгалах"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
