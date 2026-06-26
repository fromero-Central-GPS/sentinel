import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';
import { enforceMotorAccess, enforceConversationLimit, incrementUsage } from '@/lib/plan-enforcement';
import {
  classifyFunnelStage,
  diagnoseLossReason,
  scoreRecoverability,
  detectPurchaseIntent,
  detectAbandonment,
  generateBatchSummary,
  type GHLConversationInput,
  type GHLOpportunityInput,
} from '@/lib/analysis-engine';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  if (!row?.ghlApiToken || !row?.ghlLocationId) {
    return NextResponse.json({ error: 'GHL credentials not configured' }, { status: 400 });
  }

  // Plan enforcement
  const enforcement = await enforceMotorAccess('forense');
  if (enforcement.blocked) return enforcement.response!;

  const token = decrypt(row.ghlApiToken);
  const locationId = row.ghlLocationId;
  const headers = { Authorization: `Bearer ${token}`, Version: GHL_VERSION };

  const oppsRes = await fetch(
    `${GHL_BASE}/opportunities/search?location_id=${locationId}&status=lost&limit=100`,
    { headers }
  );
  if (!oppsRes.ok) {
    const text = await oppsRes.text();
    return NextResponse.json({ error: `GHL error: ${oppsRes.status} ${text}` }, { status: 502 });
  }

  const oppsData = await oppsRes.json();
  const rawOpps: GHLRawOpportunity[] = oppsData.opportunities ?? oppsData.data ?? [];

  // Check conversation limit before processing
  const limitCheck = await enforceConversationLimit(rawOpps.length);
  if (limitCheck.blocked) return limitCheck.response!;

  const ghlOpportunities: GHLOpportunityInput[] = rawOpps.map((opp) => ({
    id: opp.id,
    name: opp.name ?? opp.contact?.name ?? 'Desconocido',
    contactId: opp.contact?.id ?? '',
    contactName: opp.contact?.name ?? 'Desconocido',
    monetaryValue: opp.monetaryValue ?? 0,
    pipelineId: opp.pipelineId ?? '',
    pipelineStageId: opp.pipelineStageId ?? '',
    pipelineStageName: opp.pipelineStage?.name ?? opp.pipelineStageName ?? '',
    status: 'lost',
    lastStageChangeAt: opp.lastStageChangeAt,
    createdAt: opp.createdAt ?? opp.dateAdded ?? '',
  }));

  // Build minimal conversations from opportunity data (no messages for MVP)
  const ghlConversations: GHLConversationInput[] = ghlOpportunities.map((opp) => ({
    id: opp.id,
    contactId: opp.contactId,
    contactName: opp.contactName,
    lastMessageDate: opp.lastStageChangeAt
      ? new Date(opp.lastStageChangeAt).getTime()
      : new Date(opp.createdAt).getTime(),
    lastMessageType: 'TYPE_WHATSAPP',
    lastMessageDirection: 'inbound',
    lastMessageBody: '',
    unreadCount: 0,
    tags: [],
    messages: [],
  }));

  const analyses = ghlConversations.map((conv, i) => {
    const opp = ghlOpportunities[i];
    const abandonment = detectAbandonment([], conv.lastMessageDate);
    const intentSignals = detectPurchaseIntent([]);
    const stageClassification = classifyFunnelStage([], opp.pipelineStageName);
    const lossReason = diagnoseLossReason([], 'lost', abandonment);
    const recoverability = scoreRecoverability(opp.monetaryValue, abandonment, intentSignals, []);
    return {
      conversationId: conv.id,
      contactId: conv.contactId,
      contactName: conv.contactName,
      opportunityId: opp.id,
      opportunityValue: opp.monetaryValue,
      channel: 'GHL',
      intentSignals,
      stageClassification,
      abandonment,
      lossReason,
      recoverability,
      analyzedAt: new Date().toISOString(),
    };
  });

  const batchResult = generateBatchSummary(analyses, locationId, 'Forense');

  // Track usage
  await incrementUsage('forense', analyses.length);

  return NextResponse.json(batchResult);
}

type GHLRawOpportunity = {
  id: string;
  name?: string;
  contact?: { id?: string; name?: string };
  monetaryValue?: number;
  pipelineId?: string;
  pipelineStageId?: string;
  pipelineStageName?: string;
  pipelineStage?: { name?: string };
  status?: string;
  lastStageChangeAt?: string;
  createdAt?: string;
  dateAdded?: string;
};
