import { db } from "@/lib/db";
import { chartOfAccounts, segmentConfigs, segmentValues, moduleConfigs } from "@/lib/db/schema";
import { getActiveOrg } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { AccountsTable } from "@/components/gl/accounts-table";
import { SEGMENT_DEFS, MODULE_DEFS } from "@/lib/constants/standard-accounts";
import { syncCompanySegmentValues } from "@/lib/gl/segment-sync";

export default async function GlSettingsPage() {
  const { orgId, userId } = await getActiveOrg();

  // S1 (Компани) / S6 (Группын дотоод) нь байгууллагын бүртгэлээс АВТОМАТААР
  // бүрддэг — хуудас нээх бүрд тэнцүүлнэ (идемпотент; өөрчлөлтгүй бол
  // DB-д бичихгүй). Шинэ компани нэмэгдмэгц хоёр сегментэд ижил код, ижил
  // нэрээр гарч ирнэ.
  await syncCompanySegmentValues(orgId, userId).catch((caught) => {
    // Сегментийн автомат бүрдүүлэлт унасан ч тохиргооны хуудас нээгдэнэ.
    console.error("syncCompanySegmentValues:", caught);
  });

  const [accounts, rawSegConfigs, rawSegValues, rawModConfigs] = await Promise.all([
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.organizationId, orgId),
      orderBy: (a, { asc }) => [asc(a.number)],
    }),
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.organizationId, orgId) }),
    db.query.segmentValues.findMany({
      where: eq(segmentValues.organizationId, orgId),
      orderBy: (v, { asc }) => [asc(v.segmentId), asc(v.code)],
    }),
    db.query.moduleConfigs.findMany({ where: eq(moduleConfigs.organizationId, orgId) }),
  ]);

  const segConfigMap = new Map(rawSegConfigs.map((c) => [c.segmentId, c]));
  const segConfigs = SEGMENT_DEFS.map((def) => ({
    segmentId: def.id,
    isEnabled: segConfigMap.get(def.id)?.isEnabled ?? true,
  }));

  const modConfigMap = new Map(rawModConfigs.map((c) => [c.moduleKey, c]));
  const modConfigs = MODULE_DEFS.map((def) => ({
    moduleKey: def.key,
    isEnabled: modConfigMap.get(def.key)?.isEnabled ?? true,
  }));

  return (
    <AccountsTable
      accounts={accounts}
      segmentConfigs={segConfigs}
      segmentValues={rawSegValues}
      moduleConfigs={modConfigs}
    />
  );
}
