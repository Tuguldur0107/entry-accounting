"use client";

// Татварын СУУТГАН ТООЦОО — өглөгийн дансыг авлага/илүү төлөлт, урьдчилгааны
// данстай хооронд нь хаах ноорог журнал (Дт өглөг / Кт авлага). АР↔АП
// offset-той ижил санаа, татварын нэгдсэн дансны практик. Бичилт ЗААВАЛ
// ноорог (§9) — createTaxAccrualVoucher-ийн НЭГ замаар үүснэ.
//
// Валидаци зөөлөн: дүн талуудын үлдэгдлээс хэтэрвэл анхааруулна, гэхдээ
// хориглохгүй — ТЕГ-тэй тохирсон дүнг нягтлан өөрөө мэднэ.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTaxAccrualVoucher } from "@/lib/actions/tax";
import {
  getTaxAccountBalances,
  type TaxAccountBalanceView,
} from "@/lib/actions/tax-offset";
import { fmtMnt, parseMntInput } from "@/lib/grid/formatters";

export type TaxOffsetDefaults = {
  /** Хаагдах ӨГЛӨГИЙН данс (Дт тал). */
  debitMain: string;
  /** Ашиглах АВЛАГА/урьдчилгааны данс (Кт тал) — хоосон бол хэрэглэгч сонгоно. */
  creditMain: string;
  description: string;
};

function localToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function TaxOffsetButton({ offset }: { offset: TaxOffsetDefaults }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [balances, setBalances] = useState<TaxAccountBalanceView[]>([]);
  const [form, setForm] = useState(() => ({
    date: localToday(),
    amount: "",
    description: offset.description,
    debitMain: offset.debitMain,
    creditMain: offset.creditMain,
  }));

  const balanceOf = (main: string) =>
    balances.find((row) => row.main === main.trim());

  // Дт тал өглөг тул Кт үлдэгдэл нь сөрөг balance; Кт тал авлага тул эерэг.
  const debitAvailable = (() => {
    const row = balanceOf(form.debitMain);
    return row ? Math.max(0, -row.balance) : null;
  })();
  const creditAvailable = (() => {
    const row = balanceOf(form.creditMain);
    return row ? Math.max(0, row.balance) : null;
  })();

  function loadBalances(debitMain: string, creditMain: string) {
    startTransition(async () => {
      const result = await getTaxAccountBalances([debitMain, creditMain]);
      if (!result.error) setBalances(result.balances ?? []);
    });
  }

  function openDialog() {
    setError("");
    setBalances([]);
    setForm({
      date: localToday(),
      amount: "",
      description: offset.description,
      debitMain: offset.debitMain,
      creditMain: offset.creditMain,
    });
    setOpen(true);
    loadBalances(offset.debitMain, offset.creditMain);
  }

  function submit() {
    setError("");
    startTransition(async () => {
      const result = await createTaxAccrualVoucher({
        date: form.date,
        amount: parseMntInput(form.amount),
        description: form.description,
        debitMain: form.debitMain,
        creditMain: form.creditMain,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      toast.success(
        "Суутган тооцооны НООРОГ журнал үүслээ — журналаас шалгаад батална уу"
      );
      router.refresh();
    });
  }

  const amountValue = parseMntInput(form.amount || "0");
  const exceeds =
    (debitAvailable != null && amountValue > debitAvailable + 0.01) ||
    (creditAvailable != null && amountValue > creditAvailable + 0.01);

  const balanceHint = (main: string, available: number | null) => {
    const row = balanceOf(main);
    if (!row) return null;
    return (
      <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
        {row.name ? `${row.name} · ` : ""}боломжит: {fmtMnt(available ?? 0)}₮
      </p>
    );
  };

  return (
    <>
      <Button variant="outline" onClick={openDialog}>
        <Icon name="movement" />
        Тооцоо хаах
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Татварын суутган тооцоо (ноорог)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
              Өглөгийн дансыг авлага, илүү төлөлт, урьдчилгааны данстай хооронд
              нь хаана: Дт [өглөг] / Кт [авлага]. ТЕГ-ийн нэгдсэн дансны
              зөвшөөрөгдсөн дүнгээр бичнэ.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tax-offset-debit">Дебет — хаагдах өглөг</Label>
                <Input
                  id="tax-offset-debit"
                  placeholder="3XXXXXXX"
                  value={form.debitMain}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, debitMain: event.target.value }))
                  }
                  onBlur={() => loadBalances(form.debitMain, form.creditMain)}
                />
                {balanceHint(form.debitMain, debitAvailable)}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax-offset-credit">
                  Кредит — авлага/урьдчилгаа
                </Label>
                <Input
                  id="tax-offset-credit"
                  placeholder="1XXXXXXX"
                  value={form.creditMain}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, creditMain: event.target.value }))
                  }
                  onBlur={() => loadBalances(form.debitMain, form.creditMain)}
                />
                {balanceHint(form.creditMain, creditAvailable)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tax-offset-date">Огноо</Label>
                <Input
                  id="tax-offset-date"
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, date: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax-offset-amount">Дүн (₮)</Label>
                <Input
                  id="tax-offset-amount"
                  inputMode="decimal"
                  placeholder={
                    debitAvailable != null && creditAvailable != null
                      ? fmtMnt(Math.min(debitAvailable, creditAvailable))
                      : "0.00"
                  }
                  value={form.amount}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, amount: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tax-offset-desc">Гүйлгээний утга</Label>
              <Input
                id="tax-offset-desc"
                value={form.description}
                onChange={(event) =>
                  setForm((f) => ({ ...f, description: event.target.value }))
                }
              />
            </div>

            {exceeds ? (
              <p className="text-xs" style={{ color: "var(--ea-warning-fg)" }}>
                Дүн аль нэг талын боломжит үлдэгдлээс их байна — ТЕГ-тэй
                тохирсон бол үргэлжлүүлж болно.
              </p>
            ) : null}
            <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
              НООРОГ журнал үүснэ — журналын жагсаалтаас шалгаад батална.
            </p>
            {error ? (
              <p className="text-xs" style={{ color: "var(--ea-danger-fg)" }}>
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Болих
            </Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending ? "Үүсгэж байна…" : "Ноорог үүсгэх"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
