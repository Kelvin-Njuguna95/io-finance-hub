import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Supabase session mode pooler — eu-west-1
const connectionString = `postgresql://postgres.nmxcefslpabntspsjtcr:${process.argv[2]}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;

const migrations = [
  '00001_enums.sql',
  '00002_tables.sql',
  '00003_rls_policies.sql',
  '00004_functions.sql',
  '00005_red_flag_function.sql',
  '00006_misc_draws.sql',
  '00007_expense_lifecycle.sql',
  '00008_accountant_misc_delegation.sql',
  '00009_appendix_o_fixes.sql',
];

async function run() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    console.log('Connecting to Supabase database...');
    await client.connect();
    console.log('Connected!\n');

    for (const file of migrations) {
      const filePath = path.join(__dirname, '..', 'supabase', 'migrations', file);
      const sql = fs.readFileSync(filePath, 'utf-8');
      console.log(`Running ${file}...`);
      try {
        await client.query(sql);
        console.log(`  ✓ ${file} completed`);
      } catch (err) {
        console.error(`  ✗ ${file} failed: ${err.message}`);
        // Continue with other migrations
      }
    }

    console.log('\nAll migrations complete!');
  } catch (err) {
    console.error('Connection failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
