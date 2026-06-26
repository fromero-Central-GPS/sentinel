import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { organizations, subscriptions, plans } from '@/db/schema';

/**
 * GET /api/billing/subscription — Returns the current subscription with plan details.
 * Also returns usage summary so the frontend can show quota bars.
 */
export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.clerkOrgId, orgId));

    if (!org) {
      return NextResponse.json({ plan: null, subscription: null });
    }

    const [sub] = await db
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        trialEndsAt: subscriptions.trialEndsAt,
        cancelledAt: subscriptions.cancelledAt,
        createdAt: subscriptions.createdAt,
        planId: plans.id,
        planName: plans.name,
        planSlug: plans.slug,
        planDescription: plans.description,
        priceMonthlyClp: plans.priceMonthlyClp,
        features: plans.features,
        maxTenantUsers: plans.maxTenantUsers,
        maxConversationsPerMonth: plans.maxConversationsPerMonth,
        hasForense: plans.hasForense,
        hasLiveOpp: plans.hasLiveOpp,
        hasWonTrack: plans.hasWonTrack,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.organizationId, org.id));

    if (!sub) {
      return NextResponse.json({ plan: null, subscription: null });
    }

    return NextResponse.json({
      subscription: {
        id: sub.id,
        status: sub.status,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelledAt: sub.cancelledAt,
        trialEndsAt: sub.trialEndsAt,
      },
      plan: {
        id: sub.planId,
        name: sub.planName,
        slug: sub.planSlug,
        description: sub.planDescription,
        priceMonthlyClp: sub.priceMonthlyClp,
        features: sub.features,
        maxTenantUsers: sub.maxTenantUsers,
        maxConversationsPerMonth: sub.maxConversationsPerMonth,
        hasForense: sub.hasForense === 'true',
        hasLiveOpp: sub.hasLiveOpp === 'true',
        hasWonTrack: sub.hasWonTrack === 'true',
      },
    });
  } catch (err: any) {
    console.error('[Billing API] GET subscription error:', err);
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 });
  }
}

/**
 * POST /api/billing/subscription — Change plan (upgrade/downgrade).
 * Body: { planSlug: "pro" | "enterprise" | "free" }
 * Until Stripe is integrated, this is a manual change with immediate effect.
 */
export async function POST(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { planSlug } = await request.json() as { planSlug?: string };
    if (!planSlug || !['free', 'pro', 'enterprise'].includes(planSlug)) {
      return NextResponse.json({ error: 'Invalid plan slug. Use: free, pro, enterprise' }, { status: 400 });
    }

    const [targetPlan] = await db
      .select()
      .from(plans)
      .where(eq(plans.slug, planSlug));

    if (!targetPlan) {
      return NextResponse.json({ error: `Plan "${planSlug}" not found` }, { status: 404 });
    }

    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.clerkOrgId, orgId));

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const [existingSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, org.id));

    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    if (existingSub) {
      await db
        .update(subscriptions)
        .set({
          planId: targetPlan.id,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, existingSub.id));
    } else {
      await db.insert(subscriptions).values({
        organizationId: org.id,
        planId: targetPlan.id,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      });
    }

    return NextResponse.json({
      ok: true,
      plan: { id: targetPlan.id, name: targetPlan.name, slug: targetPlan.slug },
      message: `Plan actualizado a ${targetPlan.name}`,
    });
  } catch (err: any) {
    console.error('[Billing API] POST subscription error:', err);
    return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 });
  }
}
