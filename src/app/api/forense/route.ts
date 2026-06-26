import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt } from '@/lib/encryption';
import { enforceMotorAccess, incrementUsage } from '@/lib/plan-enforcement';
import {
  analyzeConversation,
  generateBatchSummary,
  type GHLConversationInput,
  type GHLMessage,
  type BatchAnalysisResult,
} from '@/lib/analysis-engine';

// ─── Mock data (used when no GHL credentials or as fallback) ──────────────

const MOCK_MESSAGES: GHLMessage[] = [
  { id: 'm1', direction: 'inbound', body: 'Hola, me interesa el servicio de rastreo para una flota de 5 camiones', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-10T10:05:00Z' },
  { id: 'm2', direction: 'outbound', body: 'Perfecto. Te puedo ofrecer nuestro plan Pro con reportes en tiempo real. El valor es de $45.000 mensuales por equipo.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-10T10:10:00Z' },
  { id: 'm3', direction: 'inbound', body: 'Ok, gracias por la información. Lo voy a evaluar con mi jefe.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-10T10:15:00Z' },
  { id: 'm4', direction: 'inbound', body: 'Está muy caro, en la competencia me ofrecieron algo similar por menos.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-05-20T09:10:00Z' },
  { id: 'm5', direction: 'outbound', body: 'Entendible. Nuestra diferencia es el soporte local y la plataforma sin límites.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-05-20T09:15:00Z' },
  { id: 'm6', direction: 'inbound', body: 'Lo vamos a pensar. Gracias.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-05-20T09:20:00Z' },
  { id: 'm7', direction: 'inbound', body: 'Hola, solo estaba cotizando. Más adelante les escribo.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-02T10:40:00Z' },
  { id: 'm8', direction: 'inbound', body: 'No me alcanza el presupuesto para este mes, muy caro para mi empresa.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-02T10:30:00Z' },
  { id: 'm9', direction: 'outbound', body: 'Buenos días, ¿pudo revisar la cotización que le enviamos?', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-06-01T11:00:00Z' },
  { id: 'm10', direction: 'inbound', body: 'Ya contraté con otra empresa. Gracias de todas formas.', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-03-20T10:00:00Z' },
  { id: 'm11', direction: 'inbound', body: 'Hola, hace tiempo que no tengo noticias. ¿Sigue vigente la cotización?', messageType: 'TYPE_WHATSAPP', dateAdded: '2026-03-15T16:00:00Z' },
  { id: 'm12', direction: 'inbound', body: 'Necesito información sobre integración con su API para nuestro software', messageType: 'TYPE_EMAIL', dateAdded: '2026-04-20T14:00:00Z' },
  { id: 'm13', direction: 'outbound', body: 'Le envío la documentación de nuestra API REST.', messageType: 'TYPE_EMAIL', dateAdded: '2026-04-20T14:10:00Z' },
  { id: 'm14', direction: 'inbound', body: 'Gracias. Reviso y te confirmo si me sirve.', messageType: 'TYPE_EMAIL', dateAdded: '2026-04-20T14:25:00Z' },
];

function buildMockConversations(): GHLConversationInput[] {
  return [
    {
      id: 'CONV-DEMO-1', contactId: 'c1', contactName: 'Empresa Demo A',
      lastMessageDate: Date.now() - 56 * 86400000,
      lastMessageType: 'TYPE_WHATSAPP', lastMessageBody: 'No me alcanza el presupuesto',
      lastMessageDirection: 'inbound', unreadCount: 0, tags: ['lost'],
      messages: [MOCK_MESSAGES[0], MOCK_MESSAGES[1], MOCK_MESSAGES[2], MOCK_MESSAGES[7], MOCK_MESSAGES[8]],
    },
    {
      id: 'CONV-DEMO-2', contactId: 'c2', contactName: 'Empresa Demo B',
      lastMessageDate: Date.now() - 8 * 86400000,
      lastMessageType: 'TYPE_WHATSAPP', lastMessageBody: 'La competencia tiene algo más barato',
      lastMessageDirection: 'inbound', unreadCount: 0, tags: ['lost'],
      messages: [MOCK_MESSAGES[3], MOCK_MESSAGES[4], MOCK_MESSAGES[5]],
    },
    {
      id: 'CONV-DEMO-3', contactId: 'c3', contactName: 'Empresa Demo C',
      lastMessageDate: Date.now() - 34 * 86400000,
      lastMessageType: 'TYPE_WHATSAPP', lastMessageBody: 'Ya contraté con otra empresa',
      lastMessageDirection: 'inbound', unreadCount: 0, tags: ['lost'],
      messages: [MOCK_MESSAGES[9], MOCK_MESSAGES[10]],
    },
    {
      id: 'CONV-DEMO-4', contactId: 'c4', contactName: 'Empresa Demo D',
      lastMessageDate: Date.now() - 2 * 86400000,
      lastMessageType: 'TYPE_WHATSAPP', lastMessageBody: 'Solo estaba cotizando',
      lastMessageDirection: 'inbound', unreadCount: 0, tags: ['lost'],
      messages: [MOCK_MESSAGES[6], MOCK_MESSAGES[1]],
    },
    {
      id: 'CONV-DEMO-5', contactId: 'c5', contactName: 'Empresa Demo E',
      lastMessageDate: Date.now() - 94 * 86400000,
      lastMessageType: 'TYPE_EMAIL', lastMessageBody: 'Reviso y te confirmo',
      lastMessageDirection: 'inbound', unreadCount: 0, tags: ['lost'],
      messages: [MOCK_MESSAGES[11], MOCK_MESSAGES[12], MOCK_MESSAGES[13]],
    },
  ];
}

function runAnalysis(
  conversations: GHLConversationInput[],
  opps: Array<{
    id: string; name: string; contactId: string; contactName: string;
    monetaryValue: number; pipelineId: string; pipelineStageId: string;
    pipelineStageName: string; status: 'lost'; createdAt: string;
  }>,
  pipelineName: string,
): BatchAnalysisResult {
  const analyses = conversations.map((conv, i) => analyzeConversation(conv, opps[i]));
  return generateBatchSummary(analyses, opps[0]?.pipelineId ?? 'unknown', pipelineName);
}

// ─── GHL live fetch (best-effort, returns null on error) ──────────────────

async function fetchGHLForense(
  ghlApiToken: string,
  ghlLocationId: string,
): Promise<BatchAnalysisResult | null> {
  const headers = {
    Authorization: `Bearer ${ghlApiToken}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
  const baseUrl = 'https://services.leadconnectorhq.com';

  try {
    // 1. Get lost opportunities
    const oppRes = await fetch(
      `${baseUrl}/opportunities/search?location_id=${ghlLocationId}&status=lost&limit=20`,
      { headers },
    );
    if (!oppRes.ok) return null;
    const oppData = await oppRes.json();
    const rawOpps: any[] = oppData.opportunities ?? [];
    if (rawOpps.length === 0) return null;

    // 2. For each opp, get conversation messages (parallel, capped at 10)
    const oppsToProcess = rawOpps.slice(0, 10);
    const conversations: GHLConversationInput[] = [];
    const mappedOpps: Parameters<typeof runAnalysis>[1] = [];

    await Promise.all(
      oppsToProcess.map(async (opp: any) => {
        try {
          // Search conversations for this contact
          const convRes = await fetch(
            `${baseUrl}/conversations/search?locationId=${ghlLocationId}&contactId=${opp.contact?.id}&limit=1`,
            { headers },
          );
          if (!convRes.ok) return;
          const convData = await convRes.json();
          const conv = convData.conversations?.[0];
          if (!conv) return;

          // Get messages
          const msgRes = await fetch(
            `${baseUrl}/conversations/${conv.id}/messages`,
            { headers },
          );
          if (!msgRes.ok) return;
          const msgData = await msgRes.json();
          const messages: GHLMessage[] = (msgData.messages ?? []).map((m: any) => ({
            id: m.id,
            direction: m.direction === 1 ? 'inbound' : 'outbound',
            body: m.body ?? '',
            messageType: m.messageType ?? 'TYPE_WHATSAPP',
            dateAdded: m.dateAdded,
          }));

          conversations.push({
            id: conv.id,
            contactId: opp.contact?.id ?? '',
            contactName: opp.contact?.name ?? opp.name,
            lastMessageDate: new Date(conv.lastMessageDate ?? Date.now()).getTime(),
            lastMessageType: conv.type ?? 'TYPE_WHATSAPP',
            lastMessageBody: conv.lastMessage ?? '',
            lastMessageDirection: conv.lastMessageDirection === 1 ? 'inbound' : 'outbound',
            unreadCount: conv.unreadCount ?? 0,
            tags: [],
            messages,
          });

          mappedOpps.push({
            id: opp.id,
            name: opp.name,
            contactId: opp.contact?.id ?? '',
            contactName: opp.contact?.name ?? opp.name,
            monetaryValue: opp.monetaryValue ?? 0,
            pipelineId: opp.pipelineId,
            pipelineStageId: opp.pipelineStageId,
            pipelineStageName: opp.pipelineStage?.name ?? 'Perdido',
            status: 'lost',
            createdAt: opp.dateAdded ?? new Date().toISOString(),
          });
        } catch {
          // skip this opp on any error
        }
      }),
    );

    if (conversations.length === 0) return null;

    return runAnalysis(conversations, mappedOpps, ghlLocationId);
  } catch {
    return null;
  }
}

// ─── Route handler ────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Plan enforcement
  const enforcement = await enforceMotorAccess('forense');
  if (enforcement.blocked) return enforcement.response!;

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') ?? 'auto';

  // Get tenant credentials
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.tenantId, orgId));
  const hasCredentials = !!(settings?.ghlApiToken && settings?.ghlLocationId);

  // Live mode: try GHL API
  if (mode === 'live' || (mode === 'auto' && hasCredentials)) {
    try {
      const ghlToken = decrypt(settings.ghlApiToken!);
      const ghlLocationId = settings.ghlLocationId!;
      const result = await fetchGHLForense(ghlToken, ghlLocationId);
      if (result) {
        await incrementUsage('forense', result.totalAnalyzed);
        return NextResponse.json({
          batchResult: result,
          _meta: {
            mode: 'live',
            tenant: orgId,
            analyzedAt: new Date().toISOString(),
            source: 'GHL API',
          },
        });
      }
    } catch {
      // fall through to mock
    }
  }

  // Mock mode (default fallback)
  const conversations = buildMockConversations();
  const opps = conversations.map((c, i) => ({
    id: `OPP-MOCK-${i + 1}`,
    name: c.contactName,
    contactId: c.contactId,
    contactName: c.contactName,
    monetaryValue: [4500000, 1200000, 890000, 620000, 340000][i],
    pipelineId: orgId,
    pipelineStageId: 'lost-stage',
    pipelineStageName: 'Perdido',
    status: 'lost' as const,
    createdAt: '2026-01-15T00:00:00Z',
  }));

  const batchResult = runAnalysis(conversations, opps, 'Demo Pipeline');

  // Track usage (mock mode)
  await incrementUsage('forense', batchResult.totalAnalyzed);

  return NextResponse.json({
    batchResult,
    _meta: {
      mode: 'mock',
      tenant: orgId,
      analyzedAt: new Date().toISOString(),
      note: hasCredentials
        ? 'Datos mock. El análisis en vivo falló — verifica tus credenciales GHL.'
        : 'Datos demo. Configura GHL en Settings para análisis real.',
    },
  });
}
