import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';
import { generateWonTrackOutput, analyzeWonDeal, GHLOpportunity, GHLMessage } from '@/lib/won-track-engine';

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'live';

  if (mode === 'mock') {
    return NextResponse.json({
      period: 'Últimos 30 días',
      won: 24,
      total: 80,
      conversionRate: 0.3,
      avgTicket: 150000,
      avgCycleDays: 12,
      alerts: [{ type: 'info', message: 'Datos mockeados para demostración' }],
      successThresholds: {
        avgTimeToClose: 14,
        medianTimeToClose: 12,
        fastCloseThreshold: 6,
        avgResponseMinutes: 45,
        medianResponseMinutes: 30,
        dangerResponseThreshold: 90,
        idealResponseThreshold: 20,
        avgMessagesPerDeal: 18,
        avgInboundRatio: 0.45,
        lowEngagementThreshold: 0.25,
      },
      businessFeatures: {
        topChannel: 'whatsapp',
        channelWinRates: { whatsapp: 40, organico: 35, referido: 25 },
      },
      communicationPatterns: {
        avgResponseMinutes: 45,
        medianResponseMinutes: 30,
        avgInboundRatio: 0.45,
      }
    });
  }

  try {
    const settings = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId)).limit(1);
    if (!settings.length || !settings[0].ghlApiToken || !settings[0].ghlLocationId) {
      return NextResponse.json({ error: 'GHL credentials not configured for this tenant' }, { status: 400 });
    }

    const apiKey = decrypt(settings[0].ghlApiToken);
    const ghlLocationId = settings[0].ghlLocationId;

    // Fetch won opps
    const oppsRes = await fetch(`https://services.leadconnectorhq.com/opportunities/search?location_id=${ghlLocationId}&status=won&limit=30`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28',
        'Accept': 'application/json'
      }
    });

    if (!oppsRes.ok) {
      throw new Error(`GHL API error: ${oppsRes.status}`);
    }

    const oppsData = await oppsRes.json();
    const wonOpps: GHLOpportunity[] = oppsData.opportunities || [];

    // Analyze each won opp
    const analyzedDeals = [];
    const allFeatures = [];
    const allPatterns = [];
    let totalValue = 0;

    // Process sequentially to respect API limits
    for (const opp of wonOpps) {
      if (!opp.contactId) continue;
      
      const msgRes = await fetch(`https://services.leadconnectorhq.com/conversations/search?locationId=${ghlLocationId}&contactId=${opp.contactId}&limit=50`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-04-15',
          'Accept': 'application/json'
        }
      });
      
      let messages: GHLMessage[] = [];
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        if (msgData.conversations && msgData.conversations.length > 0) {
           const convId = msgData.conversations[0].id;
           const msgs = await fetch(`https://services.leadconnectorhq.com/conversations/${convId}/messages?limit=50`, {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Version': '2021-04-15',
                'Accept': 'application/json'
              }
           });
           if (msgs.ok) {
             const mData = await msgs.json();
             messages = mData.messages?.messages || [];
           }
        }
      }

      const analysis = analyzeWonDeal(opp, messages);
      analyzedDeals.push(analysis);
      allFeatures.push(analysis.features);
      allPatterns.push(analysis.patterns);
      totalValue += analysis.features.contractValue;
    }

    const output = generateWonTrackOutput(analyzedDeals, allFeatures, allPatterns);
    
    // Calculate aggregate communication patterns
    const avgResponse = allPatterns.length > 0 ? allPatterns.reduce((sum, p) => sum + p.avgResponseMinutes, 0) / allPatterns.length : 0;
    const avgInbound = allPatterns.length > 0 ? allPatterns.reduce((sum, p) => sum + p.inboundRatio, 0) / allPatterns.length : 0;

    return NextResponse.json({
      period: 'Últimos 30 días',
      won: wonOpps.length,
      total: wonOpps.length * 4, // Estimate
      conversionRate: 0.25, // Estimate
      avgTicket: wonOpps.length > 0 ? totalValue / wonOpps.length : 0,
      avgCycleDays: output.thresholds.avgTimeToClose,
      alerts: [],
      successThresholds: output.thresholds,
      businessFeatures: {
        topChannel: output.thresholds.topChannel,
        channelWinRates: output.thresholds.channelWinRates,
      },
      communicationPatterns: {
         avgResponseMinutes: Math.round(avgResponse),
         medianResponseMinutes: output.thresholds.medianResponseMinutes,
         avgInboundRatio: avgInbound
      }
    });

  } catch (error: any) {
    console.error('Won Track engine error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
