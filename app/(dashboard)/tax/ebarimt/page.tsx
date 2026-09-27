// eBarimt баримтууд `/tax/ebarimt` — ТЕГ-д илгээсэн (эсвэл илгээх гэж буй) бүх
// баримт НЭГ дор: POS борлуулалт/буцаалт + АР нэхэмжлэх (docs/pos/05 Шат 2).
// Огноо: URL `from`/`to` → байхгүй бол topbar-ын период (CLAUDE.md §4).
// Эрх: татвар унших + эх бүр өөрийн модулийн уншилтын эрхээр (POS / Авлага).
// Худалдан авалтын баримт (ITC TPI) Монголын сүлжээний прокси бэлэн болмогц
// энд нэмэгдэнэ — docs/deployment/mongolia-network-runbook.md.

import { EbarimtDocumentsView } from "@/components/ebarimt/ebarimt-documents-view";
import { moduleAccess, requireModuleAction } from "@/lib/auth";
import { loadEbarimtDocuments, type EbarimtDocumentSource } from "@/lib/ebarimt/list-data";
import { getPeriodSelection } from "@/lib/periods/selection";
import { POS_MODULE_KEY } from "@/lib/pos/constants";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export default async function EbarimtDocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { orgId } = await requireModuleAction("tax", "read");
  const [params, period, access] = await Promise.all([
    searchParams,
    getPeriodSelection(),
    moduleAccess([POS_MODULE_KEY, "ar"]),
  ]);
  const from = isDate(params.from) ? params.from : period.from;
  const to = isDate(params.to) ? params.to : period.to;
  const sources: EbarimtDocumentSource[] = [];
  if (access.levels[POS_MODULE_KEY] !== "none") sources.push("pos");
  if (access.levels.ar !== "none") sources.push("arap");
  const { rows, truncated } = await loadEbarimtDocuments(orgId, { from, to }, sources);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">eBarimt баримтууд</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          ТЕГ-д илгээсэн борлуулалтын баримт, нэхэмжлэх — POS ба авлагын модулиас. Давхар даралт → эх баримтын панель
          (дахин илгээх тэндээс).
        </p>
      </div>
      <EbarimtDocumentsView rows={rows} from={from} to={to} sources={sources} truncated={truncated} />
    </section>
  );
}
