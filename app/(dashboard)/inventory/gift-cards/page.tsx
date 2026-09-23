// Бэлгийн карт · кредит `/inventory/gift-cards` — docs/pos §4.3.
// Урьд нь борлуулалтын `?tab=cards` байсан; тусдаа нав цэс.

import { GiftCardsView } from "@/components/pos/gift-cards-view";
import { getGiftCardsAndCredits } from "@/lib/actions/pos";
import { requireModuleAction } from "@/lib/auth";
import { POS_MODULE_KEY } from "@/lib/pos/constants";
import { loadCheckoutData } from "@/lib/pos/load-data";

export default async function PosGiftCardsPage() {
  const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
  const [checkout, cards] = await Promise.all([
    loadCheckoutData(orgId, userId),
    getGiftCardsAndCredits(),
  ]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Бэлгийн карт · кредит</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Бэлгийн карт олгох ба дэлгүүрийн кредитийн үлдэгдэл.
        </p>
      </div>
      <GiftCardsView
        giftCards={cards.error ? [] : (cards.giftCards ?? [])}
        storeCredits={cards.error ? [] : (cards.storeCredits ?? [])}
        methods={checkout.methods}
        customers={checkout.customers}
      />
    </section>
  );
}
