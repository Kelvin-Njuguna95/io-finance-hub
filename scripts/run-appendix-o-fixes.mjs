import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const password = process.argv[2];

if (!password) {
  console.error('Usage: node scripts/run-appendix-o-fixes.mjs <DB_PASSWORD>');
  process.exit(1);
}

const connectionString = `postgresql://postgres.nmxcefslpabntspsjtcr:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;

async function run() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    console.log('Connecting to Supabase database...');
    await client.connect();
    console.log('Connected!\n');

    const filePath = path.join(__dirname, '..', 'supabase', 'migrations', '00009_appendix_o_fixes.sql');
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log('Running 00009_appendix_o_fixes.sql...');
    await client.query(sql);
    console.log('  ✓ Migration completed successfully\n');

    // Verify new tables exist
    console.log('Verifying new tables...');
    const tables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename IN ('outstanding_receivables_snapshot', 'forex_rates')
      ORDER BY tablename
    `);
    console.log(`  Found ${tables.rows.length}/2 new tables:`);
    tables.rows.forEach(r => console.log(`    - ${r.tablename}`));

    // Verify new columns on invoices
    console.log('\nVerifying invoice columns...');
    const invoiceCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'invoices' AND column_name IN ('payment_status', 'total_paid', 'balance_outstanding')
      ORDER BY column_name
    `);
    console.log(`  Found ${invoiceCols.rows.length}/3 new columns:`);
    invoiceCols.rows.forEach(r => console.log(`    - ${r.column_name}`));

    // Verify new columns on expenses
    console.log('\nVerifying expense columns...');
    const expenseCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'expenses' AND column_name IN ('period_month', 'imported_by')
      ORDER BY column_name
    `);
    console.log(`  Found ${expenseCols.rows.length}/2 new columns:`);
    expenseCols.rows.forEach(r => console.log(`    - ${r.column_name}`));

    // Verify views
    console.log('\nVerifying views...');
    const views = await client.query(`
      SELECT viewname FROM pg_views
      WHERE schemaname = 'public' AND viewname IN ('variance_summary_by_project', 'variance_summary_company')
      ORDER BY viewname
    `);
    console.log(`  Found ${views.rows.length}/2 new views:`);
    views.rows.forEach(r => console.log(`    - ${r.viewname}`));

    console.log('\nAll Appendix O fixes applied!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
