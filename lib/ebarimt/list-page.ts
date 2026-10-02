// eBarimt жагсаалтын хуудасны ачаалагч — (2026-10-02 хүртэл `/tax/ebarimt` ба)
// `/receivables/ebarimt` хоёулаа үүгээр (давхар бичихгүй). Модулийн guard-ийг
// хуудас өөрөө хийнэ (requireModuleAction); энд эх бүрийг (POS / АР) дуудагчийн
// уншилтын эрхээр шүүнэ. Огноо: URL `from`/`to` → байхгүй бол topbar-ын период (§4).

import { moduleAccess } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { POS_MODULE_KEY } from "@/lib/pos/constants";

import { loadEbarimtDocuments, type EbarimtDocumentSource } from "./list-data";

type Params = Record<string, string | string[] | undefined>;

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function loadEbarimtPageData(orgId: string, params: Params) {
  const [period, access] = await Promise.all([getPeriodSelection(), moduleAccess([POS_MODULE_KEY, "ar"])]);
  const from = isDate(params.from) ? params.from : period.from;
  const to = isDate(params.to) ? params.to : period.to;
  const sources: EbarimtDocumentSource[] = [];
  if (access.levels[POS_MODULE_KEY] !== "none") sources.push("pos");
  if (access.levels.ar !== "none") sources.push("arap");
  const { rows, truncated } = await loadEbarimtDocuments(orgId, { from, to }, sources);
  return { rows, truncated, from, to, sources };
}
