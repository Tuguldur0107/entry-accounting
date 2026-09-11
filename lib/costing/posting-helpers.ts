// Өртгийн бичилтийн НИЙТЛЭГ туслахууд — цэвэр (plain) модуль, "use server"
// БИШ. Эдгээр функцууд урьд нь lib/actions/costing.ts-д private байсан;
// хангамжийн модуль (PO хаалт, хүлээн авалтын капитализаци) мөн адил
// дансны шалгалт, сегментийн код, барааны дансны mapping хэрэгтэй тул НЭГ
// эх сурвалж болгож зөөв (docs/procurement 01-implementation-contract §2.1).
//
// Зан төлөв ҮГЧЛЭН хэвээр — costing.ts эндээс import-оор хэрэглэнэ.

import { and, eq } from "drizzle-orm";

import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  costingItemSettings,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { postingCodeBuilderFromData } from "@/lib/gl/posting-code";

export async function assertEnabledMainAccount(
  orgId: string,
  accountNumber: string
): Promise<void> {
  const account = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      eq(chartOfAccounts.number, accountNumber),
      eq(chartOfAccounts.isEnabled, true)
    ),
    columns: { id: true },
  });
  if (!account)
    throw new Error(`${accountNumber} идэвхтэй GL данс олдсонгүй — тохиргоог шалгана уу`);
}

// Идэвхтэй сегмент ID-ууд — тохиргооноос (S3 буюу ерөнхий данс үргэлж
// идэвхтэй). Posting code builder болон панелийн дэлгэрэнгүй хоёулаа энэ
// НЭГ хэрэгжилтийг ашиглана.
export function activeSegIdsOf(
  configs: { segmentId: number; isEnabled: boolean }[]
): number[] {
  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  return SEGMENT_DEFS.filter(
    (definition) =>
      definition.id === 3 || configMap.get(definition.id)?.isEnabled === true
  ).map((definition) => definition.id);
}

// Цөм дүрэм нэг эх сурвалжтай (lib/gl/posting-code.ts); S9 = "CO".
export async function costingPostingCodeBuilder(
  orgId: string
): Promise<(main: string) => string> {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.isEnabled, true)
      ),
    }),
  ]);
  return postingCodeBuilderFromData({ configs, values, moduleTag: "CO" });
}

export async function itemAccountsFor(
  orgId: string,
  userId: string,
  itemId: string
): Promise<{ inventoryAccountNumber: string; cogsAccountNumber: string }> {
  const setting = await db.query.costingItemSettings.findFirst({
    where: and(
      eq(costingItemSettings.organizationId, orgId),
      eq(costingItemSettings.itemId, itemId)
    ),
  });
  if (setting)
    return {
      inventoryAccountNumber: setting.inventoryAccountNumber,
      cogsAccountNumber: setting.cogsAccountNumber,
    };

  // Тохиргооны мөр байхгүй үед бичих мөчид ТОГТМОЛООР шийдэхгүй (docs/cost
  // JPR-006 / CLAUDE.md: нээлттэй шийдвэрийг fallback дансанд нуухыг
  // хориглодог). Оронд нь мөрийг schema-ийн default утгатай нь ҮҮСГЭНЭ —
  // Тохиргоо → Өртөг → Барааны данс хуудсанд яг эдгээр утга аль хэдийн
  // харагдаж, засагдах боломжтой тул энэ нь нуугдсан тогтмол биш, ИЛ
  // хадгалагдсан тохиргоо болно (master-data.ts-ийн ratified-seed хэв
  // маягтай ижил — README change-control 0.2/0.3: одоогийн дүрмийг нэг
  // удаа seed хийж, түүнээс хойш зөвхөн тохиргооноос уншина).
  const [created] = await db
    .insert(costingItemSettings)
    .values({ userId, organizationId: orgId, itemId })
    .onConflictDoNothing()
    .returning();
  const row =
    created ??
    (await db.query.costingItemSettings.findFirst({
      where: and(
        eq(costingItemSettings.organizationId, orgId),
        eq(costingItemSettings.itemId, itemId)
      ),
    }));
  if (!row)
    throw new Error(
      "Барааны дансны тохиргоо олдсонгүй — Тохиргоо → Өртөг → Барааны данс хэсэгт бүртгэнэ үү"
    );
  return {
    inventoryAccountNumber: row.inventoryAccountNumber,
    cogsAccountNumber: row.cogsAccountNumber,
  };
}
