"use client";

// Түр хадгалсан (парк) сагснууд — дэлгүүрийн POS-ийн «hold ticket»: нэг
// худалдан авагч мөнгөө авахаар явахад сагсыг хадгалаад дараагийнхыг
// үйлчилнэ. Хөтчийн localStorage-д (агуулах бүрд), DB-д ноорог үүсгэхгүй.

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAction } from "@/components/ui/icon-action";
import type { ParkedTicket } from "@/lib/pos/checkout-state";
import { fmtMnt } from "@/lib/reports/balances";

const fmtTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" }).slice(11, 16);
};

export function ParkedDialog({
  open,
  onOpenChange,
  tickets,
  onRestore,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tickets: ParkedTicket[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Түр хадгалсан сагс</DialogTitle>
          <DialogDescription>
            Сэргээхэд одоогийн сагс (байвал) автоматаар түр хадгалагдана.
          </DialogDescription>
        </DialogHeader>
        {tickets.length === 0 ? (
          <EmptyState icon="save" title="Түр хадгалсан сагс алга" />
        ) : (
          <ul className="max-h-80 divide-y divide-[var(--ea-border)] overflow-y-auto rounded-md border border-[var(--ea-border)]">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-mono text-xs text-[var(--ea-text-3)]">{fmtTime(ticket.parkedAt)}</span>
                    <span className="truncate font-medium text-[var(--ea-text-1)]">
                      {ticket.label || `${ticket.lineCount} мөр`}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-[var(--ea-text-3)]">
                    {ticket.cart
                      .slice(0, 3)
                      .map((row) => `${row.name} ×${row.quantity}`)
                      .join(", ")}
                    {ticket.cart.length > 3 && ` … (+${ticket.cart.length - 3})`}
                  </div>
                </div>
                {ticket.total != null && (
                  <span className="shrink-0 font-mono text-sm font-semibold">{fmtMnt(ticket.total)}</span>
                )}
                <Button size="sm" type="button" onClick={() => onRestore(ticket.id)}>
                  Сэргээх
                </Button>
                <IconAction name="delete" label="Устгах" size="sm" variant="danger" onClick={() => onDelete(ticket.id)} />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
