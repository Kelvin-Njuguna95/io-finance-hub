import pg from 'pg';

const password = process.argv[2];
const connectionString = `postgresql://postgres.nmxcefslpabntspsjtcr:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;

const usersToCreate = [
  { email: 'kelvin@impactoutsourcing.co.ke', full_name: 'Kelvin', role: 'cfo', director_tag: 'kelvin' },
  { email: 'evans@impactoutsourcing.co.ke', full_name: 'Evans', role: 'cfo', director_tag: 'evans' },
  { email: 'dan@impactoutsourcing.co.ke', full_name: 'Dan', role: 'team_leader', director_tag: 'dan' },
  { email: 'gidraph@impactoutsourcing.co.ke', full_name: 'Gidraph', role: 'team_leader', director_tag: 'gidraph' },
  { email: 'victor@impactoutsourcing.co.ke', full_name: 'Victor', role: 'team_leader', director_tag: 'victor' },
  { email: 'accountant@impactoutsourcing.co.ke', full_name: 'Jane Wanjiku', role: 'accountant', director_tag: null },
];

const userPassword = 'Impact2024!';

async function run() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    console.log('Connecting...');
    await client.connect();
    console.log('Connected!\n');

    // Ensure pgcrypto is available
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions');

    for (const u of usersToCreate) {
      console.log(`Creating user: ${u.email}...`);

      // Insert into auth.users
      const authResult = await client.query(`
        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, created_at, updated_at,
          raw_app_meta_data, raw_user_meta_data,
          confirmation_token, recovery_token, email_change_token_new,
          is_super_admin
        ) VALUES (
          '00000000-0000-0000-0000-000000000000',
          gen_random_uuid(),
          'authenticated',
          'authenticated',
          $1,
          extensions.crypt($2, extensions.gen_salt('bf')),
          now(), now(), now(),
          '{"provider":"email","providers":["email"]}',
          '{}',
          '', '', '',
          false
        )
        ON CONFLICT (email) DO UPDATE SET
          encrypted_password = extensions.crypt($2, extensions.gen_salt('bf'))
        RETURNING id
      `, [u.email, userPassword]);

      const userId = authResult.rows[0].id;
      console.log(`  Auth user: ${userId}`);

      // Insert identity
      await client.query(`
        INSERT INTO auth.identities (
          id, user_id, provider_id, provider, identity_data,
          last_sign_in_at, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, 'email',
          jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
          now(), now(), now()
        )
        ON CONFLICT (provider_id, provider) DO NOTHING
      `, [userId, u.email]);

      // Create profile
      await client.query(`
        INSERT INTO public.users (id, email, full_name, role, director_tag)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET full_name = $3, role = $4, director_tag = $5
      `, [userId, u.email, u.full_name, u.role, u.director_tag]);

      console.log(`  ✓ ${u.full_name} (${u.role})`);
    }

    // Seed categories
    console.log('\nSeeding categories...');
    await client.query(`
      INSERT INTO overhead_categories (name, description, default_allocation_method) VALUES
        ('Office Rent', 'Monthly office space rental', 'headcount_based'),
        ('Internet & Utilities', 'Internet, electricity, water', 'headcount_based'),
        ('Software Licenses', 'SaaS subscriptions and tools', 'revenue_based'),
        ('Management Overhead', 'Management team costs', 'hybrid'),
        ('Insurance', 'Business insurance premiums', 'revenue_based')
      ON CONFLICT (name) DO NOTHING
    `);

    await client.query(`
      INSERT INTO expense_categories (name, description) VALUES
        ('Salaries & Wages', 'Employee compensation'),
        ('Equipment', 'Hardware and office equipment'),
        ('Training', 'Staff training and development'),
        ('Travel', 'Business travel expenses'),
        ('Supplies', 'Office supplies and consumables'),
        ('Professional Services', 'Consulting and legal fees'),
        ('Marketing', 'Marketing and advertising')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('  ✓ Categories seeded');

    // Create projects
    console.log('\nCreating projects...');
    const directors = await client.query(
      `SELECT id, director_tag FROM public.users WHERE director_tag IS NOT NULL`
    );
    const dMap = new Map(directors.rows.map(d => [d.director_tag, d.id]));

    const projects = [
      ['Project Alpha', 'Client A', 'kelvin'],
      ['Project Beta', 'Client B', 'evans'],
      ['Project Gamma', 'Client C', 'dan'],
      ['Project Delta', 'Client D', 'gidraph'],
      ['Project Epsilon', 'Client E', 'victor'],
    ];

    for (const [name, client, dir] of projects) {
      await client.query(
        `INSERT INTO projects (name, client_name, director_user_id, director_tag) VALUES ($1, $2, $3, $4)`,
        [name, client, dMap.get(dir), dir]
      );
      console.log(`  ✓ ${name}`);
    }

    // Departments
    console.log('\nCreating departments...');
    const acc = await client.query(`SELECT id FROM public.users WHERE role = 'accountant' LIMIT 1`);
    if (acc.rows[0]) {
      await client.query(`
        INSERT INTO departments (name, owner_user_id) VALUES
          ('Human Resources', $1), ('Operations', $1), ('Finance', $1)
      `, [acc.rows[0].id]);
      console.log('  ✓ HR, Operations, Finance');
    }

    // Assign TLs to projects
    console.log('\nAssigning team leaders...');
    const assignments = await client.query(`
      SELECT u.id as user_id, p.id as project_id
      FROM public.users u
      JOIN projects p ON p.director_tag = u.director_tag
      WHERE u.role = 'team_leader'
    `);
    for (const a of assignments.rows) {
      await client.query(
        `INSERT INTO user_project_assignments (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [a.user_id, a.project_id]
      );
    }
    console.log(`  ✓ ${assignments.rows.length} assignments`);

    console.log('\n========================================');
    console.log('  SETUP COMPLETE');
    console.log('========================================');
    console.log('\nLogin credentials (password: Impact2024!):');
    console.log('');
    for (const u of usersToCreate) {
      console.log(`  ${u.full_name.padEnd(15)} ${u.email.padEnd(45)} ${u.role}`);
    }
    console.log('');

  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  } finally {
    await client.end();
  }
}

run();
