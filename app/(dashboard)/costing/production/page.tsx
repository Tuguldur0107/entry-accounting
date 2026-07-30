import { ProductionRunView } from "@/components/costing/production-run-view";
import { getProductionWorkspace } from "@/lib/actions/production";
import { getPeriodSelection } from "@/lib/periods/selection";

// Сар нь topbar-ийн периодын сонголтын зангуу сар. Тооцоолсны дараа
// router.refresh() шинэ өгөгдөл авчирна — key нь өгөгдлөөс хамаардаг тул
// workspace цэвэрхэн remount хийгдэж хамгийн сүүлийн утгыг үзүүлнэ.
export default async function ProductionCostingPage() {
  const period = await getPeriodSelection();
  const result = await getProductionWorkspace(period.periodCode);

  if (!result.ok)
    return (
      <div className="flex min-h-56 flex-1 items-center justify-center text-sm text-[var(--ea-danger)]">
        Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.
      </div>
    );

  const stateKey = `${period.periodCode}:${result.data.runStatus}:${result.data.stages
    .map(
      (stage) =>
        `${stage.id}=${stage.outputs
          .map((output) => output.allocatedAmount ?? "x")
          .join(",")}`
    )
    .join("|")}`;

  return <ProductionRunView key={stateKey} data={result.data} />;
}
