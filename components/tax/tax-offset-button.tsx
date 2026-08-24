"use client";

// Татварын СУУТГАН ТООЦОО — татварын авлага, өглөгийн дансдын хооронд хаана.
// Аль данс аль талд орохыг ҮЛДЭГДЛИЙН ТЭМДГЭЭС автоматаар сонгоно:
//   • Кт үлдэгдэлтэй данс (өглөг) → ДЕБЕТ тал (хаагдана)
//   • Дт үлдэгдэлтэй данс (авлага, илүү төлөлт) → КРЕДИТ тал (ашиглагдана)
// Тухайн хуудасны татварын данс аль талд байхаас хамаарч нөгөө талд нь
// системийн бусад татварын дансдаас хамгийн их үлдэгдэлтэйг нь сонгоно.
// Дараа нь ЖУРНАЛЫН ЖИНХЭНЭ ФОРМ бүрэн бөглөгдсөн нээгдэж, хэрэглэгч
// шалгаад хадгална/батална (§9 — тусдаа бичилтийн зам байхгүй).

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  getTaxOffsetCandidates,
  type TaxOffsetCandidate,
} from "@/lib/actions/tax-offset";
import { fmtMnt } from "@/lib/grid/formatters";
import { openNewVoucherPanel } from "@/lib/store/panel-store";

export type TaxOffsetDefaults = {
  /** Тухайн хуудасны татварын үндсэн данс — талыг нь үлдэгдлээс нь тогтооно. */
  debitMain: string;
  description: string;
};

const EPS = 0.005;

function localToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Хамгийн их Кт үлдэгдэлтэй (хамгийн сөрөг balance) данс. */
function topPayable(pool: TaxOffsetCandidate[], excludeMain?: string) {
  return pool
    .filter((row) => row.balance < -EPS && row.main !== excludeMain)
    .sort((a, b) => a.balance - b.balance)[0];
}

/** Хамгийн их Дт үлдэгдэлтэй данс. */
function topReceivable(pool: TaxOffsetCandidate[], excludeMain?: string) {
  return pool
    .filter((row) => row.balance > EPS && row.main !== excludeMain)
    .sort((a, b) => b.balance - a.balance)[0];
}

export function TaxOffsetButton({ offset }: { offset: TaxOffsetDefaults }) {
  const [isPending, startTransition] = useTransition();

  function openOffsetJournal() {
    startTransition(async () => {
      const result = await getTaxOffsetCandidates([offset.debitMain]);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const pool = result.candidates ?? [];
      const page = pool.find((row) => row.main === offset.debitMain);

      // Чиглэлийн автомат сонголт: хуудасны данс өглөгтэй бол тэр нь Дт тал,
      // авлагатай бол Кт тал; нөгөө талд бусад татварын хамгийн их
      // үлдэгдэлтэй данс. Хуудасны данс үлдэгдэлгүй бол хоёр талыг хоёуланг
      // нь үлдэгдлээр нь сонгоно.
      let drAcc: TaxOffsetCandidate | undefined;
      let crAcc: TaxOffsetCandidate | undefined;
      if (page && page.balance < -EPS) {
        drAcc = page;
        crAcc = topReceivable(pool, page.main);
      } else if (page && page.balance > EPS) {
        crAcc = page;
        drAcc = topPayable(pool, page.main);
      } else {
        drAcc = topPayable(pool);
        crAcc = topReceivable(pool, drAcc?.main);
      }

      const payable = drAcc ? -drAcc.balance : 0;
      const receivable = crAcc ? crAcc.balance : 0;
      const amount =
        drAcc && crAcc
          ? Math.min(payable, receivable)
          : Math.max(payable, receivable);

      openNewVoucherPanel({
        title: "Суутган тооцоо",
        date: localToday(),
        description: offset.description,
        lines: [
          {
            account: drAcc?.main ?? offset.debitMain,
            debit: amount,
            credit: 0,
            description: offset.description,
          },
          {
            account: crAcc?.main ?? "",
            debit: 0,
            credit: amount,
            description: offset.description,
          },
        ],
      });

      const label = (row?: TaxOffsetCandidate) =>
        row ? `${row.main}${row.name ? ` ${row.name}` : ""}` : null;
      if (!drAcc || !crAcc)
        toast.warning(
          !crAcc
            ? "Дт үлдэгдэлтэй (авлага, илүү төлөлт) татварын данс олдсонгүй — Кт талын дансыг формд гараар сонгоно уу."
            : "Кт үлдэгдэлтэй (өглөг) татварын данс олдсонгүй — Дт талын дансыг формд гараар сонгоно уу."
        );
      else
        toast.info(
          `Дт ${label(drAcc)} (${fmtMnt(payable)}₮) / Кт ${label(crAcc)} (${fmtMnt(
            receivable
          )}₮) — ${fmtMnt(amount)}₮-өөр бөглөв. Шалгаад хадгална уу.`
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
