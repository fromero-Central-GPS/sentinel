import { NextResponse } from 'next/server';
import { getTenantPlanLimits, getCurrentUsage } from '@/lib/plan-enforcement';

/**
 * GET /api/billing/usage — Current period usage vs plan limits.
 */
export async function GET() {
  try {
    const [limits, usage] = await Promise.all([getTenantPlanLimits(), getCurrentUsage()]);

    if (!limits) {
      return NextResponse.json({ error: 'No active organization' }, { status: 401 });
    }

    const maxConversations = limits.maxConversationsPerMonth;
    const usedConversations = usage.conversations;
    const remainingConversations = Math.max(0, maxConversations - usedConversations);
    const usagePct =
      maxConversations > 0
        ? Math.min(100, Math.round((usedConversations / maxConversations) * 100))
        : 0;

    return NextResponse.json({
      period: {
        label: `${new Date().toLocaleString('es-CL', { month: 'long', year: 'numeric' })}`,
      },
      plan: {
        name: limits.planName,
        slug: limits.planSlug,
      },
      usage: {
        conversationsAnalyzed: usedConversations,
        forenseRuns: usage.forense,
        liveOppRuns: usage.liveOpp,
        wonTrackRuns: usage.wonTrack,
      },
      limits: {
        maxConversationsPerMonth: maxConversations,
        remaining: remainingConversations,
        usagePercent: usagePct,
      },
    });
  } catch (err: any) {
    console.error('[Usage API] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch usage' }, { status: 500 });
  }
}
