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
  type LossReasonDiagnosis,
} from '@/lib/analysis-engine';
import { getLlmAnalysis, saveLlmAnalysis } from '@/lib/llm-store';
import {
  fetchOpportunities,
  fetchConversationIdByContact,
  fetchConversationMessages,
  mapWithConcurrency,
} from '@/lib/ghl-client';
import { toMessages } from '@/lib/types';
import { diagnoseLossReasonLLM } from '@/lib/forense-llm';
import { getTenantAIConfig, type TenantAIConfig } from '@/lib/ai-config';

// ─── Mock data for demo mode ─────────────────────────────────────────────

const MOCK_MESSAGES: GHLMessage[] = [
  {
    id: 'm1',
    direction: 'outbound',
    body: 'Hola, gracias por contactarnos. ¿En qué podemos ayudarte?',
    messageType: 'TYPE_SMS',
    dateAdded: '2026-06-10T10:00:00Z',
  },
  {
    id: 'm2',
    direction: 'inbound',
    body: 'Me interesa el servicio para una flota de 5 vehículos',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-06-10T10:05:00Z',
  },
  {
    id: 'm3',
    direction: 'outbound',
    body: 'Perfecto. El plan Pro incluye reportes en tiempo real.',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-06-10T10:10:00Z',
  },
  {
    id: 'm4',
    direction: 'outbound',
    body: 'El valor es de $45.000 mensuales por equipo.',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-06-10T10:12:00Z',
  },
  {
    id: 'm5',
    direction: 'inbound',
    body: 'Ok, gracias. Lo voy a evaluar con mi jefe.',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-06-10T10:15:00Z',
  },
  {
    id: 'm6',
    direction: 'inbound',
    body: 'Solo estaba cotizando, más adelante les escribo.',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-06-12T10:40:00Z',
  },
  {
    id: 'm7',
    direction: 'inbound',
    body: 'Está muy caro, la competencia me ofrece algo similar por menos.',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-05-20T09:10:00Z',
  },
  {
    id: 'm8',
    direction: 'outbound',
    body: 'Entendible. Nuestra diferencia es el soporte local 24/7.',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-05-20T09:15:00Z',
  },
  {
    id: 'm9',
    direction: 'inbound',
    body: 'Lo vamos a pensar. Gracias.',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-05-20T09:20:00Z',
  },
  {
    id: 'm10',
    direction: 'inbound',
    body: 'Ya contraté con otra empresa. Gracias de todas formas.',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: '2026-03-20T10:00:00Z',
  },
];

function buildMockConversations(): GHLConversationInput[] {
  return [
    {
      id: 'CONV-DEMO-1',
      contactId: 'c1',
      contactName: 'Demo Cliente (Empresa A)',
      email: 'demo1@empresa-a.cl',
      phone: '+56912345678',
      lastMessageDate: Date.now() - 56 * 86400000,
      lastMessageType: 'TYPE_WHATSAPP',
      lastMessageBody: 'Solo estaba cotizando',
      lastMessageDirection: 'inbound',
      unreadCount: 0,
      tags: ['lost', 'high-value'],
      messages: [
        MOCK_MESSAGES[0],
        MOCK_MESSAGES[1],
        MOCK_MESSAGES[2],
        MOCK_MESSAGES[3],
        MOCK_MESSAGES[4],
        MOCK_MESSAGES[5],
      ],
    },
    {
      id: 'CONV-DEMO-2',
      contactId: 'c2',
      contactName: 'Demo Cliente (Empresa B)',
      email: 'demo2@empresa-b.cl',
      phone: '+56987654321',
      lastMessageDate: Date.now() - 30 * 86400000,
      lastMessageType: 'TYPE_WHATSAPP',
      lastMessageBody: 'Ya contraté con otra empresa',
      lastMessageDirection: 'inbound',
      unreadCount: 0,
      tags: ['lost', 'competitor'],
      messages: [MOCK_MESSAGES[6], MOCK_MESSAGES[7], MOCK_MESSAGES[8], MOCK_MESSAGES[9]],
    },
  ];
}

async function runForensicsPipeline(
  conversations: GHLConversationInput[],
  opps: GHLOpportunityInput[],
  opts?: { ai?: TenantAIConfig | null; cached?: Map<string, LossReasonDiagnosis> },
) {
  const ai = opts?.ai;
  const cached = opts?.cached;
  const analyses = await Promise.all(
    conversations.map(async (conv, i) => {
      const opp = opps[i];
      const messages = conv.messages || [];
      const abandonment = detectAbandonment(messages, conv.lastMessageDate);
      const intentSignals = detectPurchaseIntent(messages);
      const stageClassification = classifyFunnelStage(messages, opp.pipelineStageName);
      // Razón de pérdida: si se pidió IA, corre el LLM; si no, usa el último análisis
      // LLM cacheado para esa oportunidad; si tampoco hay, cae al regex determinista.
      const lossReason =
        (ai ? await diagnoseLossReasonLLM(messages, ai) : null) ??
        cached?.get(opp.id) ??
        diagnoseLossReason(messages, 'lost', abandonment);
      const recoverability = scoreRecoverability(
        opp.monetaryValue,
        abandonment,
        intentSignals,
        messages,
      );
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
    }),
  );
  return generateBatchSummary(analyses, opps[0]?.pipelineId ?? 'demo-pipeline', 'Sentinel');
}

// ─── Route handler ────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'mock';
  // El LLM (razón de pérdida) solo corre on-demand (?llm=true); por defecto usa el
  // regex determinista para no quemar tokens en cada refresh.
  const useLLM = searchParams.get('llm') === 'true';

  // ─── Mock mode: demo data, no GHL needed, no plan enforcement ──────────

  if (mode === 'mock') {
    const conversations = buildMockConversations();
    const opps: GHLOpportunityInput[] = [
      {
        id: 'OPP-1',
        name: 'Demo Cliente (Empresa A)',
        contactId: 'c1',
        contactName: 'Demo Cliente (Empresa A)',
        monetaryValue: 41116655,
        pipelineId: 'tenant-pipeline',
        pipelineStageId: 'lost',
        pipelineStageName: 'Perdido',
        status: 'lost',
        lastStageChangeAt: '2026-04-30T00:00:00Z',
        createdAt: '2026-01-15T00:00:00Z',
      },
      {
        id: 'OPP-2',
        name: 'Demo Cliente (Empresa B)',
        contactId: 'c2',
        contactName: 'Demo Cliente (Empresa B)',
        monetaryValue: 4300000,
        pipelineId: 'tenant-pipeline',
        pipelineStageId: 'lost',
        pipelineStageName: 'Perdido',
        status: 'lost',
        lastStageChangeAt: '2026-05-26T00:00:00Z',
        createdAt: '2026-02-20T00:00:00Z',
      },
    ];

    const batchResult = await runForensicsPipeline(conversations, opps);

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
        {
          error: 'GHL not configured',
          hint: 'Ve a /settings y configura el API Token y Location ID de GHL.',
          _meta: { mode: 'live', configured: false },
        },
        { status: 400 },
      );
    }

    // Plan enforcement
    const enforcement = await enforceMotorAccess('forense');
    if (enforcement.blocked) return enforcement.response!;

    const token = decrypt(row.ghlApiToken);
    const locationId = row.ghlLocationId;
    const creds = { token, locationId };

    try {
      const rawOpps = await fetchOpportunities(creds, 'lost', 20);

      if (rawOpps.length === 0) {
        return NextResponse.json({
          batchResult: null,
          _meta: {
            mode: 'live',
            conversationCount: 0,
            note: 'No hay oportunidades perdidas en GHL.',
          },
        });
      }

      // Check conversation limit before processing
      const limitCheck = await enforceConversationLimit(rawOpps.length);
      if (limitCheck.blocked) return limitCheck.response!;

      // Fetch conversations with messages for each opportunity
      const debugPerOpp: Array<{
        oppId: string;
        contactId: string | null;
        conversationIdSource: string;
        conversationId: string | null;
        messageCount: number;
      }> = [];

      const conversations: GHLConversationInput[] = await mapWithConcurrency(
        rawOpps.slice(0, 15),
        5,
        async (opp) => {
          const contactId = opp.contact?.id ?? null;
          // GHL /opportunities/search often omits conversationId — fall back to contact lookup
          let conversationId = opp.conversationId ?? null;
          let convIdSource = 'opp_direct';
          if (!conversationId && contactId) {
            conversationId = await fetchConversationIdByContact(creds, contactId);
            convIdSource = conversationId ? 'contact_lookup' : 'not_found';
          }

          const messages: GHLMessage[] = conversationId
            ? toMessages(await fetchConversationMessages(creds, conversationId))
            : [];

          debugPerOpp.push({
            oppId: opp.id,
            contactId,
            conversationIdSource: convIdSource,
            conversationId,
            messageCount: messages.length,
          });

          // Use real last-message timestamp; fall back to lastStageChangeAt to avoid 0-days bug
          const lastMsgTimestamp =
            messages.length > 0
              ? Math.max(...messages.map((m) => new Date(m.dateAdded).getTime()))
              : opp.lastStageChangeAt
                ? new Date(opp.lastStageChangeAt).getTime()
                : Date.now();

          return {
            id: conversationId ?? opp.id,
            contactId: contactId ?? opp.id,
            contactName: opp.contact?.name ?? opp.name ?? 'Desconocido',
            lastMessageDate: lastMsgTimestamp,
            lastMessageType: 'TYPE_WHATSAPP',
            lastMessageDirection: 'inbound' as const,
            lastMessageBody: messages[messages.length - 1]?.body ?? '',
            unreadCount: 0,
            tags: ['lost'],
            messages,
          };
        },
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

      // Razón de pérdida: on-demand corre el LLM y cachea; carga normal usa el
      // último análisis LLM guardado por oportunidad (0 tokens) + regex para las nuevas.
      let batchResult;
      let llmAnalyzedAt: string | null = null;
      if (useLLM) {
        const aiConfig = await getTenantAIConfig(orgId);
        batchResult = await runForensicsPipeline(conversations, opps, { ai: aiConfig });
        await Promise.all(
          batchResult.conversations
            .filter((c) => c.opportunityId)
            .map((c) =>
              saveLlmAnalysis(orgId, 'forense', c.opportunityId!, c.lossReason, aiConfig.model),
            ),
        );
        llmAnalyzedAt = new Date().toISOString();
      } else {
        const cachedRecs = await getLlmAnalysis<LossReasonDiagnosis>(orgId, 'forense');
        const cached = new Map(cachedRecs.map((r) => [r.key, r.payload]));
        llmAnalyzedAt = cachedRecs.reduce<string | null>(
          (max, r) => (!max || r.analyzedAt > max ? r.analyzedAt : max),
          null,
        );
        batchResult = await runForensicsPipeline(conversations, opps, { cached });
      }

      // Track usage
      await incrementUsage('forense', conversations.length);

      return NextResponse.json({
        batchResult,
        _meta: {
          mode: 'live',
          analyzedAt: new Date().toISOString(),
          llmAnalyzedAt,
          conversationCount: conversations.length,
          locationId,
          note: 'Datos reales desde GHL API del tenant.',
          debug: debugPerOpp,
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
