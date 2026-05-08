import postgres from 'postgres';

async function main() {
  const sql = postgres('postgresql://postgres:juTmWCOQEyVLBuvaczmFQCvCbYZzsVDs@turntable.proxy.rlwy.net:26384/railway');

  const configs = await sql`SELECT segment_id, is_enabled FROM segment_configs ORDER BY segment_id`;
  console.log('=== SEGMENT CONFIGS ===');
  for (const r of configs) {
    console.log(`S${r.segment_id}: ${r.is_enabled ? '✅ ИДВЭХТЭЙ' : '❌ ИДВЭХГҮЙ'}`);
  }

  const values = await sql`SELECT segment_id, count(*) as cnt FROM segment_values GROUP BY segment_id ORDER BY segment_id`;
  console.log('\n=== SEGMENT VALUES COUNT ===');
  for (const r of values) {
    console.log(`S${r.segment_id}: ${r.cnt} утга`);
  }

  await sql.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
