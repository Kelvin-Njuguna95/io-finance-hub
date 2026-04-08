import pg from 'pg';

const password = process.argv[2];
const connectionString = `postgresql://postgres.nmxcefslpabntspsjtcr:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;

// We'll create auth users via Supabase's auth.users table directly
// and then create matching profile records in public.users

const usersToCreate = [
  {
    email: 'kelvin@impactoutsourcing.co.ke',
    password: 'Impact2024!',
    full_name: 'Kelvin',
    role: 'cfo',
    director_tag: 'kelvin',
  },
  {
    email: 'evans@impactoutsourcing.co.ke',
    password: 'Impact2024!',
    full_name: 'Evans',
    role: 'cfo',
    director_tag: 'evans',
  },
  {
    email: 'dan@impactoutsourcing.co.ke',
    password: 'Impact2024!',
    full_name: 'Dan',
    role: 'team_leader',
    director_tag: 'dan',
  },
  {
    email: 'gidraph@impactoutsourcing.co.ke',
    password: 'Impact2024!',
    full_name: 'Gidraph',
    role: 'team_leader',
    director_tag: 'gidraph',
  },
  {
    email: 'victor@impactoutsourcing.co.ke',
    password: 'Impact2024!',
    full_name: 'Victor',
    role: 'team_leader',
    director_tag: 'victor',
  },
  {
    email: 'accountant@impactoutsourcing.co.ke',
    password: 'Impact2024!',
    full_name: 'Jane Wanjiku',
    role: 'accountant',
    director_tag: null,
  },
];

async function run() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    console.log('Connecting...');
    await client.connect();
    console.log('Connected!\n');

    // Create auth users and profile records
    for (const u of usersToCreate) {
      console.log(`Creating user: ${u.email}...`);

      // Insert into auth.users using Supabase's internal format
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
          crypt($2, gen_salt('bf')),
          now(),
          now(),
          now(),
          '{"provider":"email","providers":["email"]}',
          jsonb_build_object('full_name', $3),
          '', '', '',
          false
        )
        ON CONFLICT (email) DO UPDATE SET encrypted_password = crypt($2, gen_salt('bf'))
        RETURNING id
      `, [u.email, u.password, u.full_name]);

      const userId = authResult.rows[0].id;

      // Also insert into auth.identities (required for email login)
      await client.query(`
        INSERT INTO auth.identities (
          id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, 'email',
          jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
          now(), now(), now()
        )
        ON CONFLICT (provider_id, provider) DO NOTHING
      `, [userId, u.email]);

      // Create profile record
      await client.query(`
        INSERT INTO public.users (id, email, full_name, role, director_tag)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          full_name = $3, role = $4, director_tag = $5
      `, [userId, u.email, u.full_name, u.role, u.director_tag]);

      console.log(`  ✓ ${u.full_name} (${u.role}) — ${userId}`);
    }

    // Seed categories and settings
    console.log('\nSeeding overhead categories...');
    await client.query(`
      INSERT INTO overhead_categories (name, description, default_allocation_method) VALUES
        ('Office Rent', 'Monthly office space rental', 'headcount_based'),
        ('Internet & Utilities', 'Internet, electricity, water', 'headcount_based'),
        ('Software Licenses', 'SaaS subscriptions and tools', 'revenue_based'),
        ('Management Overhead', 'Management team costs', 'hybrid'),
        ('Insurance', 'Business insurance premiums', 'revenue_based')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('  ✓ Overhead categories seeded');

    console.log('Seeding expense categories...');
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
    console.log('  ✓ Expense categories seeded');

    // Create sample projects
    console.log('\nCreating sample projects...');
    const directors = await client.query(`
      SELECT id, director_tag FROM public.users WHERE director_tag IS NOT NULL
    `);

    const directorMap = new Map(directors.rows.map(d => [d.director_tag, d.id]));

    const projects = [
      { name: 'Project Alpha', client: 'Client A', director: 'kelvin' },
      { name: 'Project Beta', client: 'Client B', director: 'evans' },
      { name: 'Project Gamma', client: 'Client C', director: 'dan' },
      { name: 'Project Delta', client: 'Client D', director: 'gidraph' },
      { name: 'Project Epsilon', client: 'Client E', director: 'victor' },
    ];

    for (const p of projects) {
      const dirId = directorMap.get(p.director);
      await client.query(`
        INSERT INTO projects (name, client_name, director_user_id, director_tag)
        VALUES ($1, $2, $3, $4)
      `, [p.name, p.client, dirId, p.director]);
      console.log(`  ✓ ${p.name} (${p.director})`);
    }

    // Create departments
    console.log('\nCreating departments...');
    const accountant = await client.query(`
      SELECT id FROM public.users WHERE role = 'accountant' LIMIT 1
    `);
    const accId = accountant.rows[0]?.id;

    if (accId) {
      await client.query(`
        INSERT INTO departments (name, owner_user_id) VALUES
          ('Human Resources', $1),
          ('Operations', $1),
          ('Finance', $1)
      `, [accId]);
      console.log('  ✓ HR, Operations, Finance created');
    }

    // Assign team leaders to projects
    console.log('\nAssigning team leaders to projects...');
    const teamLeaders = await client.query(`
      SELECT u.id, u.director_tag, p.id as project_id
      FROM public.users u
      JOIN projects p ON p.director_tag = u.director_tag
      WHERE u.role = 'team_leader'
    `);

    for (const tl of teamLeaders.rows) {
      await client.query(`
        INSERT INTO user_project_assignments (user_id, project_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, project_id) DO NOTHING
      `, [tl.id, tl.project_id]);
    }
    console.log(`  ✓ ${teamLeaders.rows.length} assignments created`);

    console.log('\n=== SETUP COMPLETE ===');
    console.log('\nLogin credentials (all passwords: Impact2024!):');
    for (const u of usersToCreate) {
      console.log(`  ${u.full_name.padEnd(15)} ${u.email.padEnd(45)} ${u.role}`);
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
