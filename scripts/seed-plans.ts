/**
 * Seed default subscription plans into the database.
 *
 * Usage:
 *   npx tsx scripts/seed-plans.ts
 *
 * Requires DATABASE_URL in environment.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { plans } from '../src/db/schema';

const SEED_PLANS = [
  {
    name: 'Free',
    slug: 'free',
    description: 'Para equipos pequeños que quieren probar Sentinel. Análisis de hasta 100 conversaciones/mes.',
    priceMonthlyClp: '0',
    features: JSON.stringify([
      '100 conversaciones analizadas/mes',
      'Motor Forense incluido',
      'Dashboard básico',
      '1 usuario',
    ]),
    maxTenantUsers: '1',
    maxConversationsPerMonth: '100',
    hasForense: 'true',
    hasLiveOpp: 'false',
    hasWonTrack: 'false',
    isActive: 'true',
  },
  {
    name: 'Pro',
    slug: 'pro',
    description: 'Para equipos comerciales que necesitan prevenir pérdidas y optimizar conversión. Hasta 5,000 conversaciones/mes.',
    priceMonthlyClp: '49900',
    features: JSON.stringify([
      '5,000 conversaciones analizadas/mes',
      'Los 3 motores: Forense, Live Opp, Won Track',
      'Dashboard completo con alertas',
      'Hasta 5 usuarios',
      'Soporte por email',
    ]),
    maxTenantUsers: '5',
    maxConversationsPerMonth: '5000',
    hasForense: 'true',
    hasLiveOpp: 'true',
    hasWonTrack: 'true',
    isActive: 'true',
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'Para operaciones comerciales grandes. Conversaciones ilimitadas, soporte prioritario y personalización.',
    priceMonthlyClp: '149900',
    features: JSON.stringify([
      'Conversaciones ilimitadas',
      'Los 3 motores con datos en tiempo real',
      'Usuarios ilimitados',
      'Soporte prioritario 24/7',
      'Onboarding personalizado',
      'API access',
      'Personalización de umbrales',
    ]),
    maxTenantUsers: '999',
    maxConversationsPerMonth: '999999',
    hasForense: 'true',
    hasLiveOpp: 'true',
    hasWonTrack: 'true',
    isActive: 'true',
  },
];

async function seed() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL not set. Set it and try again.');
    process.exit(1);
  }

  const sql = neon(dbUrl);
  const db = drizzle(sql);

  console.log('🌱 Seeding plans...');

  for (const plan of SEED_PLANS) {
    const existing = await db
      .select()
      .from(plans)
      .where(
        // drizzle doesn't support where with raw sql easily, use eq on slug
        // using a workaround with select all and filter
      )
      .execute();

    // Check if plan with this slug already exists
    const slugExists = existing.some((p) => p.slug === plan.slug);

    if (slugExists) {
      console.log(`  ⏭️  Plan "${plan.name}" already exists, skipping.`);
    } else {
      await db.insert(plans).values(plan).execute();
      console.log(`  ✅ Created plan: ${plan.name} (${plan.slug})`);
    }
  }

  console.log('✅ Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
