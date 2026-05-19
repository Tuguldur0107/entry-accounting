"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { addCustomLine } from "@/lib/actions/report-mappings";
import type { ReportType } from "@/lib/actions/report-mappings";

interface GroupOption {
  value: string;
  label: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  reportType: ReportType;
  /** Group choices the new line can be added under. */
  groupOptions: GroupOption[];
  /** Default group preselected (e.g. last-touched). */
  defaultGroup?: string;
}

export function AddLineDialog({
  open,
  onClose,
  reportType,
  groupOptions,
  defaultGroup,
}: Props) {
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState(defaultGroup ?? groupOptions[0]?.value ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Гарчиг хоосон");
      return;
    }
    if (!group) {
      setError("Бүлэг сонгоно уу");
      return;
    }
    startTransition(async () => {
      const res = await addCustomLine(reportType, group, trimmed);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setLabel("");
      onClose();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
        else {
          setLabel("");
          setGroup(defaultGroup ?? groupOptions[0]?.value ?? "");
          setError(null);
        }
      }}
    >
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Шинэ мөр нэмэх</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Гарчиг</Label>
            <Input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="Жишээ: Гадаад валютын авлага"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Бүлэг</Label>
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="w-full h-9 px-2 text-sm border border-[var(--ea-border)] rounded-md bg-[var(--ea-surface)] text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ea-primary)_22%,transparent)] focus:border-[var(--ea-primary)]"
            >
              {groupOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-[var(--ea-text-3)]">
            Нэмсний дараа Mapping товчоор ямар дансууд орохыг тохируулна уу.
          </p>
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
            {isPending ? "Нэмж байна…" : "Нэмэх"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
