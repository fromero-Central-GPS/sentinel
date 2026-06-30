import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';
import {
  enforceMotorAccess,
  enforceConversationLimit,
  incrementUsage,
} from '@/lib/plan-enforcement';
import { analyzeLiveOpportunity, getDefaultThresholds } from '@/lib/live-opp-engine';
import type { OpenOpportunity } from '@/lib/live-opp-engine';
import { fetchOpportunities, fetchMessagesForContact } from '@/lib/ghl-client';
import { toDeal, toMessages } from '@/lib/types';
import { getTenantThresholds } from '@/lib/won-track-store';

/** Para acotar llamadas a GHL, solo traemos mensajes de las N oportunidades de mayor valor. */
const MESSAGE_FETCH_LIMIT = 25;

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'mock';

  if (mode === 'mock') {
    const thresholds = getDefaultThresholds();
    const analyzedOpps = [];

    const mockOpps: OpenOpportunity[] = [
      {
        id: '1',
        name: 'Constructora Beta',
        monetaryValue: 1200000,
        pipelineName: 'Ventas 2026',
        pipelineStageName: 'Negociación',
        status: 'open',
        createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 15 * 86400000).toISOString(),
        contactId: 'c1',
        contact: { id: 'c1', name: 'Constructora Beta' },
        assignedTo: 'user1',
      },
      {
        id: '2',
        name: 'Transportes Gamma',
        monetaryValue: 800000,
        pipelineName: 'Ventas 2026',
        pipelineStageName: 'Propuesta Enviada',
        status: 'open',
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
        contactId: 'c2',
        contact: { id: 'c2', name: 'Transportes Gamma' },
        assignedTo: 'user2',
      },
      {
        id: '3',
        name: 'Logística Delta',
        monetaryValue: 2500000,
        pipelineName: 'Ventas 2026',
        pipelineStageName: 'Demo agendada',
        status: 'open',
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        contactId: 'c3',
        contact: { id: 'c3', name: 'Logística Delta' },
      },
    ];

    for (const opp of mockOpps) {
      const messages = [
        {
          id: 'm1',
          direction: 'inbound' as const,
          body: 'Hola me interesa',
          dateAdded: opp.updatedAt,
          messageType: 'TYPE_WHATSAPP',
        },
      ];
      const analysis = analyzeLiveOpportunity(opp, messages, thresholds);
      if (analysis.riskLevel !== 'none') {
        analyzedOpps.push(analysis);
      }
    }

    const mappedOpps = analyzedOpps
      .map((a) => ({
        id: a.opportunityId,
        name: a.contactName || a.opportunityId,
        stage: a.stage,
        daysSinceActivity: a.daysSinceLastContact,
        riskScore: a.overallRiskScore,
        value: a.value,
        riskLevel: a.riskLevel,
        recommendedActions: a.recommendedActions.slice(0, 3),
      }))
      .sort((a, b) => b.riskScore - a.riskScore);

    return NextResponse.json({
      totalAtRisk: mappedOpps.length,
      totalValue: mappedOpps.reduce((acc, curr) => acc + curr.value, 0),
      opportunities: mappedOpps,
    });
  }

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) {
    return NextResponse.json(
      {
        error: 'GHL not configured',
        hint: 'Ve a /settings y configura el API Token y Location ID de GHL.',
        _meta: { mode: 'live', configured: false },
      },
      { status: 400 },
    );
  }

  // Plan enforcement
  const enforcement = await enforceMotorAccess('liveOpp');
  if (enforcement.blocked) return enforcement.response!;

  const creds = { token: decrypt(row.ghlApiToken), locationId: row.ghlLocationId };

  // Fetch open opportunities
  let rawOpps;
  try {
    rawOpps = await fetchOpportunities(creds, 'open', 50);
  } catch (err) {
    return NextResponse.json({ error: `GHL error: ${String(err)}` }, { status: 502 });
  }

  // Check conversation limit before processing
  const limitCheck = await enforceConversationLimit(rawOpps.length);
  if (limitCheck.blocked) return limitCheck.response!;

  // Usa el blueprint real del tenant (Won Track); si nunca corrió, cae a defaults.
  const thresholds = (await getTenantThresholds(orgId)) ?? getDefaultThresholds();

  // Solo traemos mensajes para las oportunidades de mayor valor (acota llamadas a GHL).
  const fetchMessagesFor = new Set(
    [...rawOpps]
      .sort((a, b) => (b.monetaryValue ?? 0) - (a.monetaryValue ?? 0))
      .slice(0, MESSAGE_FETCH_LIMIT)
      .map((o) => o.id),
  );

  const analyzedOpps = [];

  for (const opp of rawOpps) {
    const deal = toDeal(opp, 'open');

    // Traemos mensajes reales para las oportunidades prioritarias; el resto se
    // evalúa con señales derivadas de la oportunidad (fechas/etapa).
    const messages =
      fetchMessagesFor.has(opp.id) && deal.contactId
        ? toMessages(await fetchMessagesForContact(creds, deal.contactId))
        : [];

    const analysis = analyzeLiveOpportunity(deal, messages, thresholds);
    if (analysis.riskLevel !== 'none') {
      analyzedOpps.push(analysis);
    }
  }

  const mappedOpps = analyzedOpps
    .map((a) => ({
      id: a.opportunityId,
      name: a.contactName || a.opportunityId,
      stage: a.stage,
      daysSinceActivity: a.daysSinceLastContact,
      riskScore: a.overallRiskScore,
      value: a.value,
      riskLevel: a.riskLevel,
      recommendedActions: a.recommendedActions.slice(0, 3),
    }))
    .sort((a, b) => b.riskScore - a.riskScore);

  // Track usage
  await incrementUsage('liveOpp', rawOpps.length);

  return NextResponse.json({
    totalAtRisk: mappedOpps.length,
    totalValue: mappedOpps.reduce((acc, curr) => acc + curr.value, 0),
    opportunities: mappedOpps,
    _meta: { mode: 'live' },
  });
}
