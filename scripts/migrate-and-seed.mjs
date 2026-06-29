import { neon } from '@neondatabase/serverless';

const DATABASE_URL =
  'postgresql://neondb_owner:npg_BmGQUvX3ZI4R@ep-long-cloud-atc2j966.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require';
const sql = neon(DATABASE_URL);

async function run() {
  // Use tagged-template for all queries
  const tables =
    await sql`SELECT table_name FROM information_schema.tables WHERE table_catalog = ${'neondb'} AND table_schema = ${'public'} AND table_type = ${'BASE TABLE'} ORDER BY table_name`;
  console.log(
    'Tables result type:',
    typeof tables,
    Array.isArray(tables),
    tables ? tables.length : 'null',
  );
  if (Array.isArray(tables)) {
    const names = tables.map((r) => r.table_name);
    console.log('Existing tables:', names);
    console.log('Has plans:', names.includes('plans'));
  } else {
    console.log('Raw result:', JSON.stringify(tables).slice(0, 500));
  }

  if (!(Array.isArray(tables) && tables.some((r) => r.table_name === 'plans'))) {
    console.log('ERROR: plans table not found');
    process.exit(1);
  }

  // Seed
  const plans = [
    {
      name: 'Free',
      slug: 'free',
      price: '0',
      maxUsers: '1',
      maxConvs: '100',
      forense: 'true',
      live: 'false',
      won: 'false',
    },
    {
      name: 'Pro',
      slug: 'pro',
      price: '49900',
      maxUsers: '5',
      maxConvs: '5000',
      forense: 'true',
      live: 'true',
      won: 'true',
    },
    {
      name: 'Enterprise',
      slug: 'enterprise',
      price: '149900',
      maxUsers: '999',
      maxConvs: '999999',
      forense: 'true',
      live: 'true',
      won: 'true',
    },
  ];

  for (const p of plans) {
    try {
      await sql`
        INSERT INTO plans (name, slug, description, price_monthly_clp, features, max_tenant_users, max_conversations_per_month, has_forense, has_live_opp, has_won_track, is_active)
        VALUES (
          ${p.name}, ${p.slug},
          ${'Plan ' + p.name},
          ${p.price},
          ${'[]'},
          ${p.maxUsers}, ${p.maxConvs},
          ${p.forense}, ${p.live}, ${p.won},
          'true'
        )
      `;
      console.log('Created:', p.name);
    } catch (e) {
      if (e.message && (e.message.includes('duplicate') || e.message.includes('already exists'))) {
        console.log('Skipping:', p.name);
      } else {
        throw e;
      }
    }
  }

  const all = await sql`SELECT name, slug, price_monthly_clp FROM plans ORDER BY slug`;
  console.log('Plans:', JSON.stringify(all));
  console.log('Done!');
}

run().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
