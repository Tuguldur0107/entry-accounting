"use client";

// Урьдчилгааны дансны роль (docs/dev/arap.md §5l) — admin+. Хуулгын мөрийн
// «Урьдчилж орсон орлого» / «Урьдчилж төлсөн» бүртгэл, нэхэмжлэхтэй суутгал
// энэ дансуудыг ашиглана. Кодод хатуу дугаар байхгүй — default нь тохиргооны
// мөр үүсэхэд л (31300001 / 18000001).

import { useState, useTransition } from "react";

import { AccountInput } from "@/components/account/account-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { saveAdvanceSettings } from "@/lib/actions/arap-advances";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { feedback } from "@/lib/ui/feedback";

export type AdvanceSettingsView = {
  customerAdvanceAccountNumber: string;
  supplierAdvanceAccountNumber: string;
};

export function AdvanceSettingsDialog({
  open,
  onOpenChange,
  settings,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AdvanceSettingsView;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  onSaved: (settings: AdvanceSettingsView) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [customer, setCustomer] = useState(settings.customerAdvanceAccountNumber);
  const [supplier, setSupplier] = useState(settings.supplierAdvanceAccountNumber);
  const [error, setError] = useState("");

  function save() {
    setError("");
    startTransition(async () => {
      const result = await saveAdvanceSettings({
        customerAdvanceAccountNumber: customer,
        supplierAdvanceAccountNumber: supplier,
      });
      if (result.error || !result.settings) {
        setError(result.error ?? "Урьдчилгааны тохиргоо хадгалагдсангүй");
        feedback.error();
        return;
      }
      onSaved(result.settings);
      feedback.saved("Урьдчилгааны данс хадгалагдлаа");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Урьдчилгааны данс</DialogTitle>
          <DialogDescription>
            Банкны хуулгын мөрийг «Урьдчилж орсон орлого» / «Урьдчилж төлсөн» гэж
            бүртгэхэд харьцах тал болох данс. Дараа нь нэхэмжлэхтэй суутгахад мөн
            эдгээр дансаас хаагдана.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField
            label="Урьдчилж орсон орлого (худалдан авагчийн урьдчилгаа)"
            hint="Өр төлбөрийн данс — ж: 31300001"
          >
            <AccountInput
              value={customer}
              onChange={setCustomer}
              activeSegIds={activeSegIds}
              segmentOptions={segmentOptions}
              defaultSegments={defaultSegments}
            />
          </FormField>
          <FormField
            label="Урьдчилж төлсөн зардал / нийлүүлэгчийн урьдчилгаа"
            hint="Хөрөнгийн данс — ж: 18000001"
          >
            <AccountInput
              value={supplier}
              onChange={setSupplier}
              activeSegIds={activeSegIds}
              segmentOptions={segmentOptions}
              defaultSegments={defaultSegments}
            />
          </FormField>
        </div>
        {error && (
          <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger-fg)]">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Болих
          </Button>
          <Button onClick={save} disabled={isPending}>
            <Icon name="save" size="sm" />
            Хадгалах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
