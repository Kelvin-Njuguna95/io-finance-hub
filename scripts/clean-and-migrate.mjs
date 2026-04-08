import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const password = process.argv[2];
const connectionString = `postgresql://postgres.nmxcefslpabntspsjtcr:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;

const migrations = [
  '00001_enums.sql',
  '00002_tables.sql',
  '00003_rls_policies.sql',
  '00004_functions.sql',
  '00005_red_flag_function.sql',
];

const cleanupSQL = `
-- Drop all existing tables and types to start fresh
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO anon;
GRANT ALL ON SCHEMA public TO authenticated;
GRANT ALL ON SCHEMA public TO service_role;
`;

async function run() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    console.log('Connecting to Supabase database...');
    await client.connect();
    console.log('Connected!\n');

    // Clean up existing schema
    console.log('Cleaning existing schema...');
    try {
      await client.query(cleanupSQL);
      console.log('  ✓ Schema cleaned\n');
    } catch (err) {
      console.error('  ✗ Cleanup failed:', err.message);
      console.log('  Continuing anyway...\n');
    }

    // Run each migration file
    for (const file of migrations) {
      const filePath = path.join(__dirname, '..', 'supabase', 'migrations', file);
      const sql = fs.readFileSync(filePath, 'utf-8');
      console.log(`Running ${file}...`);
      try {
        await client.query(sql);
        console.log(`  ✓ ${file} completed`);
      } catch (err) {
        console.error(`  ✗ ${file} failed: ${err.message}`);
      }
    }

    // Verify tables were created
    console.log('\nVerifying tables...');
    const result = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log(`  Found ${result.rows.length} tables:`);
    result.rows.forEach(r => console.log(`    - ${r.tablename}`));

    console.log('\nAll migrations complete!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
