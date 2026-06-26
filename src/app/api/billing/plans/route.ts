import { NextResponse } from 'next/server';
import { db } from '@/db';
import { plans } from '@/db/schema';

/**
 * GET /api/billing/plans — List available subscription plans.
 * Public endpoint (no auth required) so the landing page can show pricing.
 */
export async function GET() {
  try {
    const allPlans = await db.select().from(plans).execute();
    return NextResponse.json({ plans: allPlans });
  } catch (error: any) {
    console.error('[Billing API] Failed to fetch plans:', error);
    return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 });
  }
}
