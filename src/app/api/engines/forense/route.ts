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
  type GHLMessage,
} from '@/lib/analysis-engine';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// ─── Mock data for demo mode ─────────────────────────────────────────────

const MOCK_MESSAGES: GHLMessage[] = [
  { id: 'm1', direction: 'outbound', body: 'Hola, gracias por contactarnos. ¿En qué podemos ayudarte?', messageType: 'TYPE_SMS', dateAdded: '2026-06-10T10:00:00Z' },
  { id: 'm2', direction: 'inbound', body: 'Me interesa el servicio para una flota de 5 vehículos', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-10T10:05:00Z' },
  { id: 'm3', direction: 'outbound', body: 'Perfecto. El plan Pro incluye reportes en tiempo real.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-10T10:10:00Z' },
  { id: 'm4', direction: 'outbound', body: 'El valor es de $45.000 mensuales por equipo.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-10T10:12:00Z' },
  { id: 'm5', direction: 'inbound', body: 'Ok, gracias. Lo voy a evaluar con mi jefe.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-10T10:15:00Z' },
  { id: 'm6', direction: 'inbound', body: 'Solo estaba cotizando, más adelante les escribo.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-12T10:40:00Z' },
  { id: 'm7', direction: 'inbound', body: 'Está muy caro, la competencia me ofrece algo similar por menos.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-05-20T09:10:00Z' },
  { id: 'm8', direction: 'outbound', body: 'Entendible. Nuestra diferencia es el soporte local 24/7.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-05-20T09:15:00Z' },
  { id: 'm9', direction: 'inbound', body: 'Lo vamos a pensar. Gracias.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-05-20T09:20:00Z' },
  { id: 'm10', direction: 'inbound', body: 'Ya contraté con otra empresa. Gracias de todas formas.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-03-20T10:00:00Z' },
];

function buildMockConversations(): GHLConversationInput[] {
  return [
    {
      id: 'CONV-DEMO-1', contactId: 'c1', contactName: 'Demo Cliente (Empresa A)',
      email: 'demo1@empresa-a.cl', phone: '+56912345678',
      lastMessageDate: Date.now() - 56 * 86400000,
      lastMessageType: 'TYPE_WHATSAPP', lastMessageBody: 'Solo estaba cotizando',
      lastMessageDirection: 'inbound', unreadCount: 0,
      tags: ['lost', 'high-value'],
      messages: [MOCK_MESSAGES[0], MOCK_MESSAGES[1], MOCK_MESSAGES[2], MOCK_MESSAGES[3], MOCK_MESSAGES[4], MOCK_MESSAGES[5]],
    },
    {
      id: 'CONV-DEMO-2', contactId: 'c2', contactName: 'Demo Cliente (Empresa B)',
      email: 'demo2@empresa-b.cl', phone: '+56987654321',
      lastMessageDate: Date.now() - 30 * 86400000,
      lastMessageType: 'TYPE_WHATSAPP', lastMessageBody: 'Ya contraté con otra empresa',
      lastMessageDirection: 'inbound', unreadCount: 0,
      tags: ['lost', 'competitor'],
      messages: [MOCK_MESSAGES[6], MOCK_MESSAGES[7], MOCK_MESSAGES[8], MOCK_MESSAGES[9]],
    },
  ];
}

function runForensicsPipeline(
  conversations: GHLConversationInput[],
  opps: GHLOpportunityInput[],
) {
  const analyses = conversations.map((conv, i) => {
    const opp = opps[i];
    const abandonment = detectAbandonment(conv.messages || [], conv.lastMessageDate);
    const intentSignals = detectPurchaseIntent(conv.messages || []);
    const stageClassification = classifyFunnelStage(conv.messages || [], opp.pipelineStageName);
    const lossReason = diagnoseLossReason(conv.messages || [], 'lost', abandonment);
    const recoverability = scoreRecoverability(opp.monetaryValue, abandonment, intentSignals, conv.messages || []);
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
  return generateBatchSummary(analyses, opps[0]?.pipelineId ?? 'demo-pipeline', 'Sentinel');
}

// ─── GHL API helpers ─────────────────────────────────────────────────────

async function fetchGhlLostOpportunities(token: string, locationId: string, limit = 20) {
  const url = `${GHL_BASE}/opportunities/search?location_id=${locationId}&status=lost&limit=${limit}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION } });
  if (!res.ok) throw new Error(`GHL opportunities error: ${res.status}`);
  const data = await res.json() as { opportunities?: unknown[] };
  return (data.opportunities ?? []) as GHLRawOpportunity[];
}

async function fetchGhlConversationMessages(token: string, conversationId: string): Promise<GHLMessage[]> {
  const url = `${GHL_BASE}/conversations/${conversationId}/messages?limit=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION } });
  if (!res.ok) return [];
  const data = await res.json() as { messages?: Array<{ id: string; direction: string; body: string; messageType: string; dateAdded: string }> };
  return (data.messages ?? []).map((m) => ({
    id: m.id,
    direction: m.direction as 'inbound' | 'outbound',
    body: m.body ?? '',
    messageType: m.messageType,
    dateAdded: m.dateAdded,
  }));
}

// ─── Route handler ────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'mock';

  // ─── Mock mode: demo data, no GHL needed, no plan enforcement ──────────

  if (mode === 'mock') {
    const conversations = buildMockConversations();
    const opps: GHLOpportunityInput[] = [
      { id: 'OPP-1', name: 'Demo Cliente (Empresa A)', contactId: 'c1', contactName: 'Demo Cliente (Empresa A)', monetaryValue: 41116655, pipelineId: 'tenant-pipeline', pipelineStageId: 'lost', pipelineStageName: 'Perdido', status: 'lost', lastStageChangeAt: '2026-04-30T00:00:00Z', createdAt: '2026-01-15T00:00:00Z' },
      { id: 'OPP-2', name: 'Demo Cliente (Empresa B)', contactId: 'c2', contactName: 'Demo Cliente (Empresa B)', monetaryValue: 4300000, pipelineId: 'tenant-pipeline', pipelineStageId: 'lost', pipelineStageName: 'Perdido', status: 'lost', lastStageChangeAt: '2026-05-26T00:00:00Z', createdAt: '2026-02-20T00:00:00Z' },
    ];

    const batchResult = runForensicsPipeline(conversations, opps);

    return NextResponse.json({
      batchResult,
      _meta: {
        mode: 'mock',
        analyzedAt: new Date().toISOString(),
        conversationCount: conversations.length,
        note: 'Datos de demostración. Configura GHL en Settings y usa ?mode=live para datos reales.',
      },
    });
  }

  // ─── Live mode: real GHL data with plan enforcement ────────────────────

  if (mode === 'live') {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
    if (!row?.ghlApiToken || !row?.ghlLocationId) {
      return NextResponse.json(
        { error: 'GHL not configured', hint: 'Ve a /settings y configura el API Token y Location ID de GHL.', _meta: { mode: 'live', configured: false } },
        { status: 400 },
      );
    }

    // Plan enforcement
    const enforcement = await enforceMotorAccess('forense');
    if (enforcement.blocked) return enforcement.response!;

    const token = decrypt(row.ghlApiToken);
    const locationId = row.ghlLocationId;

    try {
      const rawOpps = await fetchGhlLostOpportunities(token, locationId, 20);

      if (rawOpps.length === 0) {
        return NextResponse.json({
          batchResult: null,
          _meta: { mode: 'live', conversationCount: 0, note: 'No hay oportunidades perdidas en GHL.' },
        });
      }

      // Check conversation limit before processing
      const limitCheck = await enforceConversationLimit(rawOpps.length);
      if (limitCheck.blocked) return limitCheck.response!;

      // Fetch conversations with messages for each opportunity
      const conversations: GHLConversationInput[] = await Promise.all(
        rawOpps.slice(0, 15).map(async (opp) => {
          const messages = opp.conversationId
            ? await fetchGhlConversationMessages(token, opp.conversationId)
            : [];
          return {
            id: opp.conversationId ?? opp.id,
            contactId: opp.contact?.id ?? opp.id,
            contactName: opp.contact?.name ?? opp.name ?? 'Desconocido',
            lastMessageDate: Date.now(),
            lastMessageType: 'TYPE_WHATSAPP',
            lastMessageDirection: 'inbound' as const,
            lastMessageBody: messages[messages.length - 1]?.body ?? '',
            unreadCount: 0,
            tags: ['lost'],
            messages,
          };
        }),
      );

      const opps: GHLOpportunityInput[] = rawOpps.slice(0, 15).map((opp) => ({
        id: opp.id,
        name: opp.name ?? opp.contact?.name ?? 'Desconocido',
        contactId: opp.contact?.id ?? opp.id,
        contactName: opp.contact?.name ?? opp.name ?? 'Desconocido',
        monetaryValue: opp.monetaryValue ?? 0,
        pipelineId: opp.pipelineId ?? 'unknown',
        pipelineStageId: opp.pipelineStageId ?? 'lost',
        pipelineStageName: opp.pipelineStageName ?? 'Perdido',
        status: 'lost' as const,
        lastStageChangeAt: opp.lastStageChangeAt,
        createdAt: opp.createdAt ?? opp.dateAdded ?? new Date().toISOString(),
      }));

      const batchResult = runForensicsPipeline(conversations, opps);

      // Track usage
      await incrementUsage('forense', conversations.length);

      return NextResponse.json({
        batchResult,
        _meta: {
          mode: 'live',
          analyzedAt: new Date().toISOString(),
          conversationCount: conversations.length,
          locationId,
          note: 'Datos reales desde GHL API del tenant.',
        },
      });
    } catch (err) {
      return NextResponse.json(
        { error: 'Error al consultar GHL', detail: String(err), _meta: { mode: 'live' } },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
}

type GHLRawOpportunity = {
  id: string;
  name?: string;
  contact?: { id?: string; name?: string };
  monetaryValue?: number;
  pipelineId?: string;
  pipelineStageId?: string;
  pipelineStageName?: string;
  lastStageChangeAt?: string;
  createdAt?: string;
  dateAdded?: string;
  conversationId?: string;
};
