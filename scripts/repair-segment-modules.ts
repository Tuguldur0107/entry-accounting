// segmentConfigs.modules="" хоосон мөрүүдийг SEGMENT_DEFS.defaultModules-аар нөхнө.
// Шалтгаан: updateSegmentConfig нь modules заалгүй insert хийхдээ "" хадгалдаг
// байсан тул cash зэрэг модулиар шүүдэг хуудсууд сегментээ алддаг байв.
import { db } from "../lib/db";
import { segmentConfigs } from "../lib/db/schema";
import { SEGMENT_DEFS } from "../lib/constants/standard-accounts";
import { and, eq } from "drizzle-orm";

async function main() {
  const rows = await db.query.segmentConfigs.findMany();
  const broken = rows.filter((r) => !r.modules || r.modules.trim() === "");
  if (broken.length === 0) {
    console.log("Хоосон modules-тэй мөр алга — засах зүйлгүй.");
    process.exit(0);
  }
  for (const row of broken) {
    const def = SEGMENT_DEFS.find((d) => d.id === row.segmentId);
    const modules = (def?.defaultModules ?? []).join(",");
    await db
      .update(segmentConfigs)
      .set({ modules })
      .where(
        and(
          eq(segmentConfigs.userId, row.userId),
          eq(segmentConfigs.segmentId, row.segmentId)
        )
      );
    console.log(`✓ user=${row.userId.slice(0, 8)} S${row.segmentId} → [${modules}]`);
  }
  console.log(`\n${broken.length} мөр засагдлаа.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
