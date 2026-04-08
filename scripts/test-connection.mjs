import pg from 'pg';

const password = process.argv[2];
const regions = [
  'aws-0-us-east-1',
  'aws-0-us-west-1',
  'aws-0-eu-west-1',
  'aws-0-eu-central-1',
  'aws-0-ap-southeast-1',
  'aws-0-us-east-2',
  'aws-0-us-west-2',
  'aws-0-ap-south-1',
  'aws-0-ap-northeast-1',
];

async function tryRegion(region) {
  const connStr = `postgresql://postgres.nmxcefslpabntspsjtcr:${password}@${region}.pooler.supabase.com:5432/postgres`;
  const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const res = await client.query('SELECT 1 as test');
    console.log(`✓ ${region} — CONNECTED!`);
    await client.end();
    return region;
  } catch (err) {
    console.log(`✗ ${region} — ${err.message.substring(0, 60)}`);
    try { await client.end(); } catch {}
    return null;
  }
}

(async () => {
  for (const r of regions) {
    const result = await tryRegion(r);
    if (result) {
      console.log(`\nWorking region: ${result}`);
      process.exit(0);
    }
  }
  console.log('\nNo region worked. Check password/project ref.');
})();
