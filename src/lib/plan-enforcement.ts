/**
 * Plan Enforcement — Checks subscription limits per tenant.
 *
 * Usage in API routes:
 *   import { enforceMotorAccess, enforceConversationLimit } from '@/lib/plan-enforcement';
 *
 *   const enforcement = await enforceMotorAccess('forense');
 *   if (enforcement.blocked) return enforcement.response;
 */
import { db } from '@/db';
import { appSettings, organizations, subscriptions, plans, usageLog } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export type MotorName = 'forense' | 'liveOpp' | 'wonTrack';

export interface PlanLimits {
  planName: string;
  planSlug: string;
  maxConversationsPerMonth: number;
  hasForense: boolean;
  hasLiveOpp: boolean;
  hasWonTrack: boolean;
}

export interface EnforcementResult {
  blocked: boolean;
  status: number;
  message: string;
  /** Pre-built response to return from route */
  response?: NextResponse;
  /** Plan limits if not blocked */
  limits?: PlanLimits;
}

// ─── Resolve tenant ─────────────────────────────────────────────────────

async function resolveTenantId(): Promise<{ orgDbId: string; clerkOrgId: string } | null> {
  const { orgId } = await auth();
  if (!orgId) return null;

  // Look up internal org ID from Clerk org ID
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.clerkOrgId, orgId));

  if (!org) return null;
  return { orgDbId: org.id, clerkOrgId: orgId };
}

// ─── Fetch plan with limits ─────────────────────────────────────────────

const FREE_PLAN_DEFAULTS: PlanLimits = {
  planName: 'Free',
  planSlug: 'free',
  maxConversationsPerMonth: 100,
  hasForense: true,
  hasLiveOpp: true,
  hasWonTrack: true,
};

export async function getTenantPlanLimits(): Promise<PlanLimits | null> {
  const tenant = await resolveTenantId();

  if (!tenant) {
    // Org exists in Clerk but not yet synced to DB (webhook missed or not configured).
    // Fail-open: grant free-plan access so authenticated users aren't locked out.
    const { orgId } = await auth();
    if (!orgId) return null;
    return FREE_PLAN_DEFAULTS;
  }

  // Check subscription
  const [sub] = await db
    .select({
      status: subscriptions.status,
      planName: plans.name,
      planSlug: plans.slug,
      maxConversations: plans.maxConversationsPerMonth,
      hasForense: plans.hasForense,
      hasLiveOpp: plans.hasLiveOpp,
      hasWonTrack: plans.hasWonTrack,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.organizationId, tenant.orgDbId));

  // No subscription → default to free plan limits
  const defaults: PlanLimits = {
    planName: sub?.planName ?? 'Free',
    planSlug: sub?.planSlug ?? 'free',
    maxConversationsPerMonth: sub ? parseInt(sub.maxConversations ?? '100', 10) : 100,
    hasForense: sub ? sub.hasForense === 'true' : true,
    hasLiveOpp: sub ? sub.hasLiveOpp === 'true' : true,
    hasWonTrack: sub ? sub.hasWonTrack === 'true' : true,
  };

  return defaults;
}

// ─── Motor access check ─────────────────────────────────────────────────

const MOTOR_ENABLED_KEY: Record<MotorName, keyof PlanLimits> = {
  forense: 'hasForense',
  liveOpp: 'hasLiveOpp',
  wonTrack: 'hasWonTrack',
};

const MOTOR_LABELS: Record<MotorName, string> = {
  forense: 'Forense',
  liveOpp: 'Live Opp',
  wonTrack: 'Won Track',
};

export async function enforceMotorAccess(motor: MotorName): Promise<EnforcementResult> {
  const limits = await getTenantPlanLimits();

  if (!limits) {
    return {
      blocked: true,
      status: 401,
      message: 'No organization selected. Create an org first.',
      response: NextResponse.json(
        { error: 'No organization selected', code: 'no_org' },
        { status: 401 }
      ),
    };
  }

  const hasAccess = limits[MOTOR_ENABLED_KEY[motor]];
  if (!hasAccess) {
    return {
      blocked: true,
      status: 402,
      message: `${MOTOR_LABELS[motor]} requires Pro plan or higher.`,
      response: NextResponse.json(
        {
          error: `${MOTOR_LABELS[motor]} requires Pro plan or higher.`,
          code: 'plan_upgrade_required',
          currentPlan: limits.planName,
          motor,
        },
        { status: 402 }
      ),
    };
  }

  return { blocked: false, status: 200, message: 'ok', limits };
}

// ─── Usage tracking ─────────────────────────────────────────────────────

function currentPeriodKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function getCurrentUsage(): Promise<{ conversations: number; forense: number; liveOpp: number; wonTrack: number }> {
  const tenant = await resolveTenantId();
  if (!tenant) return { conversations: 0, forense: 0, liveOpp: 0, wonTrack: 0 };

  const periodKey = currentPeriodKey();
  const [record] = await db
    .select()
    .from(usageLog)
    .where(
      and(
        eq(usageLog.organizationId, tenant.orgDbId),
        eq(usageLog.periodKey, periodKey)
      )
    );

  if (!record) {
    return { conversations: 0, forense: 0, liveOpp: 0, wonTrack: 0 };
  }

  return {
    conversations: parseInt(record.conversationsAnalyzed, 10),
    forense: parseInt(record.forenseRuns, 10),
    liveOpp: parseInt(record.liveOppRuns, 10),
    wonTrack: parseInt(record.wonTrackRuns, 10),
  };
}

export async function incrementUsage(motor: MotorName, conversationCount: number): Promise<void> {
  const tenant = await resolveTenantId();
  if (!tenant) return;

  const periodKey = currentPeriodKey();

  // Upsert: find or create usage record for this period
  const [existing] = await db
    .select({ id: usageLog.id, conversationsAnalyzed: usageLog.conversationsAnalyzed, forenseRuns: usageLog.forenseRuns, liveOppRuns: usageLog.liveOppRuns, wonTrackRuns: usageLog.wonTrackRuns })
    .from(usageLog)
    .where(
      and(
        eq(usageLog.organizationId, tenant.orgDbId),
        eq(usageLog.periodKey, periodKey)
      )
    );

  if (existing) {
    const currentConversations = parseInt(existing.conversationsAnalyzed, 10);
    const fieldKey = motor === 'forense' ? 'forenseRuns' : motor === 'liveOpp' ? 'liveOppRuns' : 'wonTrackRuns';
    const currentRuns = parseInt(existing[fieldKey], 10);

    await db
      .update(usageLog)
      .set({
        conversationsAnalyzed: String(currentConversations + conversationCount),
        [fieldKey]: String(currentRuns + 1),
        updatedAt: new Date(),
      })
      .where(eq(usageLog.id, existing.id));
  } else {
    const forenseRuns = motor === 'forense' ? '1' : '0';
    const liveOppRuns = motor === 'liveOpp' ? '1' : '0';
    const wonTrackRuns = motor === 'wonTrack' ? '1' : '0';

    await db
      .insert(usageLog)
      .values({
        organizationId: tenant.orgDbId,
        periodKey,
        conversationsAnalyzed: String(conversationCount),
        forenseRuns,
        liveOppRuns,
        wonTrackRuns,
      });
  }
}

export async function enforceConversationLimit(requested: number): Promise<EnforcementResult> {
  const limits = await getTenantPlanLimits();
  if (!limits) {
    return {
      blocked: true,
      status: 401,
      message: 'No organization selected.',
      response: NextResponse.json({ error: 'No organization selected' }, { status: 401 }),
    };
  }

  const usage = await getCurrentUsage();
  const remaining = limits.maxConversationsPerMonth - usage.conversations;
  const projected = usage.conversations + requested;

  if (projected > limits.maxConversationsPerMonth) {
    return {
      blocked: true,
      status: 429,
      message: `Monthly conversation limit reached (${usage.conversations}/${limits.maxConversationsPerMonth}). Upgrade to continue.`,
      response: NextResponse.json(
        {
          error: `Monthly conversation limit reached`,
          code: 'usage_limit',
          current: usage.conversations,
          limit: limits.maxConversationsPerMonth,
          plan: limits.planName,
        },
        { status: 429 }
      ),
    };
  }

  return {
    blocked: false,
    status: 200,
    message: `${remaining} conversations remaining this month`,
    limits,
  };
}
