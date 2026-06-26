import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';
import { enforceMotorAccess, enforceConversationLimit, incrementUsage } from '@/lib/plan-enforcement';
import { analyzeWonDeal, extractBusinessFeatures, extractCommunicationPatterns, generateWonTrackOutput, type WonDealAnalysis, type GHLOpportunity as WonEngineOpp, type GHLMessage as WonEngineMessage } from '@/lib/won-track-engine';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const CONVERSION_THRESHOLD = 0.20;
const PERIOD_DAYS = 30;

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'mock';

  if (mode === 'mock') {
      const mockOpps: WonEngineOpp[] = [
        {
          id: 'w1', name: 'Cliente Alpha', monetaryValue: 350000,
          pipelineName: 'Ventas 2026', pipelineStageName: 'Ganado',
          status: 'won',
          createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
          updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
          contactId: 'cw1',
          contact: { id: 'cw1', name: 'Cliente Alpha', companyName: 'Alpha S.A.', tags: ['+50 vehículos', 'minería'] }
        },
        {
          id: 'w2', name: 'Cliente Beta', monetaryValue: 1200000,
          pipelineName: 'Ventas 2026', pipelineStageName: 'Ganado',
          status: 'won',
          createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
          updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
          contactId: 'cw2',
          contact: { id: 'cw2', name: 'Cliente Beta', companyName: 'Beta Ltda.', tags: ['10 a 49 vehículos', 'transporte'] }
        }
      ];

      const mockMessages: WonEngineMessage[] = [
        { id: 'wm1', direction: 'inbound', body: 'Perfecto, avancemos.', dateAdded: new Date(Date.now() - 3 * 86400000).toISOString(), messageType: 'TYPE_WHATSAPP' },
        { id: 'wm2', direction: 'outbound', body: 'Les enviamos el contrato.', dateAdded: new Date(Date.now() - 2 * 86400000).toISOString(), messageType: 'TYPE_WHATSAPP' }
      ];

      const deals: WonDealAnalysis[] = mockOpps.map(opp => analyzeWonDeal(opp, mockMessages));
      const features = deals.map(d => d.features);
      const patterns = deals.map(d => d.patterns);
      const output = generateWonTrackOutput(deals, features, patterns);

      return NextResponse.json({
        period: '30d',
        won: 2,
        total: 10,
        conversionRate: 0.2,
        avgTicket: 775000,
        avgCycleDays: 29,
        successThresholds: output.thresholds,
        businessFeatures: features,
        communicationPatterns: patterns,
        alerts: []
      });
  }

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) {
    return NextResponse.json(
        { error: 'GHL not configured', hint: 'Ve a /settings y configura el API Token y Location ID de GHL.', _meta: { mode: 'live', configured: false } },
        { status: 400 }
    );
  }

  // Plan enforcement
  const enforcement = await enforceMotorAccess('wonTrack');
  if (enforcement.blocked) return enforcement.response!;

  const token = decrypt(row.ghlApiToken);
  const locationId = row.ghlLocationId;
  const headers = { Authorization: `Bearer ${token}`, Version: GHL_VERSION };

  const since = new Date(Date.now() - PERIOD_DAYS * 86_400_000).toISOString();

  const [wonRes, totalRes] = await Promise.all([
    fetch(`${GHL_BASE}/opportunities/search?location_id=${locationId}&status=won&startAfter=${since}&limit=30`, { headers }),
    fetch(`${GHL_BASE}/opportunities/search?location_id=${locationId}&startAfter=${since}&limit=100`, { headers }),
  ]);

  if (!wonRes.ok || !totalRes.ok) {
    const text = await (wonRes.ok ? totalRes : wonRes).text();
    return NextResponse.json({ error: `GHL error: ${text}` }, { status: 502 });
  }

  const [wonData, totalData] = await Promise.all([wonRes.json(), totalRes.json()]);
  const rawWonOpps: GHLOpp[] = wonData.opportunities ?? wonData.data ?? [];
  const totalOpps: GHLOpp[] = totalData.opportunities ?? totalData.data ?? [];

  // Check conversation limit before processing
  const limitCheck = await enforceConversationLimit(totalOpps.length);
  if (limitCheck.blocked) return limitCheck.response!;

  const won = rawWonOpps.length;
  const total = totalOpps.length;
  const conversionRate = total > 0 ? won / total : 0;

  const avgTicket =
    won > 0 ? Math.round(rawWonOpps.reduce((s, o) => s + (o.monetaryValue ?? 0), 0) / won) : 0;

  const avgCycleDays =
    won > 0
      ? Math.round(
          rawWonOpps.reduce((s, o) => {
            if (!o.createdAt || !o.updatedAt) return s;
            const days =
              (new Date(o.updatedAt).getTime() - new Date(o.createdAt).getTime()) / 86_400_000;
            return s + days;
          }, 0) / won
        )
      : 0;

  const alerts: { type: string; message: string }[] = [];
  if (conversionRate > 0 && conversionRate < CONVERSION_THRESHOLD) {
    alerts.push({
      type: 'warning',
      message: `Tasa de conversión (${(conversionRate * 100).toFixed(1)}%) por debajo del umbral de ${CONVERSION_THRESHOLD * 100}%.`,
    });
  }

  const normalizedWonOpps: WonEngineOpp[] = rawWonOpps.map(opp => {
      const contactName = opp.contact?.name ?? opp.name ?? 'Desconocido';
      const now = new Date().toISOString();
      return {
          id: opp.id,
          name: opp.name ?? contactName,
          monetaryValue: opp.monetaryValue ?? 0,
          pipelineName: opp.pipeline?.name ?? opp.pipelineName ?? '',
          pipelineStageName: opp.pipelineStage?.name ?? opp.pipelineStageName ?? '',
          status: 'won',
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
          }
      };
  });

  // For MVP pass empty messages to avoid heavy API load
  const messagesArray: WonEngineMessage[][] = normalizedWonOpps.map(() => []);
  const deals: WonDealAnalysis[] = normalizedWonOpps.map((opp, i) => analyzeWonDeal(opp, messagesArray[i]));
  const features = deals.map(d => d.features);
  const patterns = deals.map(d => d.patterns);
  const output = generateWonTrackOutput(deals, features, patterns);

  // Track usage
  await incrementUsage('wonTrack', totalOpps.length);

  return NextResponse.json({
    period: '30d',
    won,
    total,
    conversionRate: parseFloat(conversionRate.toFixed(4)),
    avgTicket,
    avgCycleDays,
    successThresholds: output.thresholds,
    businessFeatures: features,
    communicationPatterns: patterns,
    alerts,
    _meta: { mode: 'live' }
  });
}

type GHLOpp = {
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
