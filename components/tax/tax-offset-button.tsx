"use client";

// Татварын СУУТГАН ТООЦОО — өглөгийн дансыг авлага/илүү төлөлт, урьдчилгааны
// данстай хооронд нь хаах (Дт өглөг / Кт авлага). Товч дарахад хоёр талын
// үлдэгдлийг уншаад ЖУРНАЛЫН ЖИНХЭНЭ ФОРМЫГ (Шинэ журнал панель) бүрэн
// бөглөгдсөн байдлаар нээнэ: огноо, дансууд, дүн (хоёр талын багынхаар),
// гүйлгээний утга бэлэн — хэрэглэгч шалгаад хадгална/батална. Тусдаа
// диалог, тусдаа бичилтийн зам байхгүй (бэлэн component-ийн дүрэм).

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { getTaxAccountBalances } from "@/lib/actions/tax-offset";
import { fmtMnt } from "@/lib/grid/formatters";
import { openNewVoucherPanel } from "@/lib/store/panel-store";

export type TaxOffsetDefaults = {
  /** Хаагдах ӨГЛӨГИЙН данс (Дт тал). */
  debitMain: string;
  /** Ашиглах АВЛАГА/урьдчилгааны данс (Кт тал) — хоосон бол формд сонгоно. */
  creditMain: string;
  description: string;
};

function localToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function TaxOffsetButton({ offset }: { offset: TaxOffsetDefaults }) {
  const [isPending, startTransition] = useTransition();

  function openOffsetJournal() {
    startTransition(async () => {
      const result = await getTaxAccountBalances([
        offset.debitMain,
        offset.creditMain,
      ]);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const balances = result.balances ?? [];
      const debitRow = balances.find((row) => row.main === offset.debitMain);
      const creditRow = balances.find((row) => row.main === offset.creditMain);
      // Өглөг данс Кт үлдэгдэлтэй (balance < 0), авлага данс Дт үлдэгдэлтэй.
      const payable = debitRow ? Math.max(0, -debitRow.balance) : 0;
      const receivable = creditRow ? Math.max(0, creditRow.balance) : 0;
      // Хаах дүн — хоёр талын багынх. Кт данс сонгогдоогүй бол өглөгийн
      // дүнгээр бөглөж, дансыг нь хэрэглэгч формд сонгоно.
      const amount = offset.creditMain
        ? Math.min(payable, receivable)
        : payable;

      openNewVoucherPanel({
        title: "Суутган тооцоо",
        date: localToday(),
        description: offset.description,
        lines: [
          {
            account: offset.debitMain,
            debit: amount,
            credit: 0,
            description: offset.description,
          },
          {
            account: offset.creditMain,
            debit: 0,
            credit: amount,
            description: offset.description,
          },
        ],
      });

      const parts = [
        debitRow
          ? `Өглөг ${debitRow.main}: ${fmtMnt(payable)}₮`
          : null,
        creditRow
          ? `Авлага ${creditRow.main}: ${fmtMnt(receivable)}₮`
          : null,
      ].filter(Boolean);
      if (amount <= 0)
        toast.warning(
          `Хаах боломжит үлдэгдэл алга — дүнг формд гараар оруулна уу.${
            parts.length ? ` (${parts.join(" · ")})` : ""
          }`
        );
      else
        toast.info(
          `${fmtMnt(amount)}₮-өөр бөглөв — шалгаад хадгална уу. ${parts.join(" · ")}`
        );
    });
  }

  return (
    <Button variant="outline" onClick={openOffsetJournal} disabled={isPending}>
      <Icon
        name={isPending ? "loading" : "movement"}
        className={isPending ? "animate-spin" : undefined}
      />
      Тооцоо хаах
    </Button>
  );
}
