import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';
import { enforceMotorAccess, enforceConversationLimit, incrementUsage } from '@/lib/plan-enforcement';
import { analyzeLiveOpportunity, getDefaultThresholds } from '@/lib/live-opp-engine';
import type { OpenOpportunity } from '@/lib/live-opp-engine';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'mock';

  if (mode === 'mock') {
      const thresholds = getDefaultThresholds();
      const analyzedOpps = [];
      
      const mockOpps: OpenOpportunity[] = [
        { id: '1', name: 'Constructora Beta', monetaryValue: 1200000, pipelineName: 'Ventas 2026', pipelineStageName: 'Negociación', status: 'open', createdAt: new Date(Date.now() - 30 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 15 * 86400000).toISOString(), contactId: 'c1', contact: { id: 'c1', name: 'Constructora Beta' }, assignedTo: 'user1' },
        { id: '2', name: 'Transportes Gamma', monetaryValue: 800000, pipelineName: 'Ventas 2026', pipelineStageName: 'Propuesta Enviada', status: 'open', createdAt: new Date(Date.now() - 10 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 8 * 86400000).toISOString(), contactId: 'c2', contact: { id: 'c2', name: 'Transportes Gamma' }, assignedTo: 'user2' },
        { id: '3', name: 'Logística Delta', monetaryValue: 2500000, pipelineName: 'Ventas 2026', pipelineStageName: 'Demo agendada', status: 'open', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(), contactId: 'c3', contact: { id: 'c3', name: 'Logística Delta' } }
      ];

      for (const opp of mockOpps) {
          const messages = [
              { id: 'm1', direction: 'inbound' as const, body: 'Hola me interesa', dateAdded: opp.updatedAt, messageType: 'TYPE_WHATSAPP' }
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
        { error: 'GHL not configured', hint: 'Ve a /settings y configura el API Token y Location ID de GHL.', _meta: { mode: 'live', configured: false } },
        { status: 400 },
      );
  }

  // Plan enforcement
  const enforcement = await enforceMotorAccess('liveOpp');
  if (enforcement.blocked) return enforcement.response!;

  const token = decrypt(row.ghlApiToken);
  const locationId = row.ghlLocationId;
  const headers = { Authorization: `Bearer ${token}`, Version: GHL_VERSION };

  // Fetch open opportunities
  const oppsRes = await fetch(
    `${GHL_BASE}/opportunities/search?location_id=${locationId}&status=open&limit=50`,
    { headers }
  );
  if (!oppsRes.ok) {
    const text = await oppsRes.text();
    return NextResponse.json({ error: `GHL error: ${oppsRes.status} ${text}` }, { status: 502 });
  }

  const oppsData = await oppsRes.json();
  const rawOpps = (oppsData.opportunities ?? oppsData.data ?? []) as GHLRawOpportunity[];

  // Check conversation limit before processing
  const limitCheck = await enforceConversationLimit(rawOpps.length);
  if (limitCheck.blocked) return limitCheck.response!;

  const thresholds = getDefaultThresholds();
  const analyzedOpps = [];

  for (const opp of rawOpps) {
    // Normalize opp data into an OpenOpportunity for the engine
    const contactName = opp.contact?.name ?? opp.name ?? 'Desconocido';
    const now = new Date().toISOString();

    const normalizedOpp: OpenOpportunity = {
      id: opp.id,
      name: opp.name ?? contactName,
      monetaryValue: opp.monetaryValue ?? 0,
      pipelineName: opp.pipeline?.name ?? opp.pipelineName ?? '',
      pipelineStageName: opp.pipelineStage?.name ?? opp.pipelineStageName ?? '',
      status: 'open',
      createdAt: opp.createdAt ?? opp.dateAdded ?? now,
      updatedAt: opp.updatedAt ?? opp.lastStageChangeAt ?? now,
      contactId: opp.contact?.id ?? opp.contactId ?? '',
      contact: {
        id: opp.contact?.id ?? opp.contactId ?? '',
        name: contactName,
        companyName: opp.contact?.companyName ?? null,
        email: opp.contact?.email,
        phone: opp.contact?.phone,
        tags: opp.contact?.tags,
      },
    };

    // For MVP we pass empty messages to avoid per-opportunity API calls.
    // The engine still produces useful risk signals from the opportunity data alone.
    const analysis = analyzeLiveOpportunity(normalizedOpp, [], thresholds);
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
    _meta: { mode: 'live' }
  });
}

type GHLRawOpportunity = {
  id: string;
  name?: string;
  contact?: {
    id?: string;
    name?: string;
    companyName?: string;
    email?: string;
    phone?: string;
    tags?: string[];
  };
  contactId?: string;
  monetaryValue?: number;
  pipeline?: { name?: string };
  pipelineName?: string;
  pipelineStage?: { name?: string };
  pipelineStageName?: string;
  lastStageChangeAt?: string;
  dateAdded?: string;
  createdAt?: string;
  updatedAt?: string;
};
