// Кассын дэлгэц (POS) — docs/pos/00-proposal.md §4.1.
// Server Component: эрх шалгаад кассын өгөгдлийг (бараа, агуулах, харилцагч,
// төлбөрийн хэлбэр, дүрэм, нээлттэй ээлж, үлдэгдэл) НЭГ удаа ачаална;
// үнийн санал ба борлуулалт нь client-ээс server action-аар.

import { PosCheckoutView } from "@/components/pos/pos-checkout-view";
import { getCurrentUserName } from "@/lib/actions/pos";
import { requireModuleAction } from "@/lib/auth";
import { POS_MODULE_KEY } from "@/lib/pos/constants";
import { loadCheckoutData } from "@/lib/pos/load-data";

export default async function PosCheckoutPage() {
  const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
  const [data, cashierName] = await Promise.all([
    loadCheckoutData(orgId, userId),
    getCurrentUserName(),
  ]);
  return <PosCheckoutView data={data} cashierName={cashierName} />;
}
