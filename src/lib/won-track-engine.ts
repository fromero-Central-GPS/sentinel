/**
 * Won Track — Motor de extracción de inteligencia de ventas exitosas
 *
 * Analiza oportunidades ganadas para extraer:
 *   1. Business Features — características del negocio/contrato ganado
 *   2. Communication Patterns — patrones de comunicación exitosa
 *   3. Success Thresholds — umbrales que alimentan Live Opp
 *
 * Diseñado para ejecutarse desde un Paperclip Agent con acceso al MCP de GHL.
 * Basado en datos reales de Central GPS (198 won opportunities, ~$20M CLP).
 */

import type { CanonicalMessage, Deal } from './types';
import type { WinFactor } from './taxonomy';

// ─── Tipos ──────────────────────────────────────────────────────────────────

/** @deprecated Usar `CanonicalMessage` de `./types`. Alias de compatibilidad. */
export type GHLMessage = CanonicalMessage;
/** @deprecated Usar `Deal` de `./types`. Alias de compatibilidad. */
export type GHLOpportunity = Deal;

// ─── Utilidades ─────────────────────────────────────────────────────────────

/** Mediana correcta: promedia los dos centrales en arrays de longitud par. */
function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedAsc[mid - 1] + sortedAsc[mid]) / 2 : sortedAsc[mid];
}

/** Promedio simple (0 si el array está vacío). */
function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Percentil con interpolación lineal sobre un array ASC. `p` en [0,1].
 * Robusto a outliers — base del saneamiento de thresholds (vs. avg crudo).
 */
function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Milisegundos epoch de un timestamp ISO, o NaN si es inválido. */
function msOf(dateStr: string): number {
  const t = new Date(dateStr).getTime();
  return Number.isFinite(t) ? t : NaN;
}

// ─── Saneamiento de tiempos de respuesta ─────────────────────────────────────
//
// El test real (CentralGPS, jun-2026) mostró thresholds absurdos: respuesta
// "ideal" 33h, "peligro" 94h, y deals con respuesta 0min. Causas: timestamps
// sucios (réplicas con la misma hora → 0min) y outliers (gaps de días contados
// como "tiempo de respuesta") promediados crudos, más multiplicadores mágicos
// (ideal=avg×0.7, peligro=avg×2). Estas constantes y el uso de percentiles
// reemplazan esa heurística por algo defendible y acotado.

/** Tiempo de respuesta máximo creíble: más allá es re-enganche, no respuesta. */
const MAX_RESPONSE_MIN = 3 * 24 * 60; // 3 días
/** Pisos/techos defendibles para los thresholds que alimentan Live Opp. */
const IDEAL_RESPONSE_FLOOR_MIN = 5; // nunca exigir responder en <5min
const IDEAL_RESPONSE_CAP_MIN = 120; // meta ≤2h aunque la muestra sea peor
const DANGER_RESPONSE_FLOOR_MIN = 60; // no marcar peligro por debajo de 1h
const DANGER_RESPONSE_CAP_MIN = 8 * 60; // 8h (jornada): más allá Live Opp nunca alertaría
/** Defaults cuando no hay datos de respuesta utilizables. */
const DEFAULT_IDEAL_RESPONSE_MIN = 30;
const DEFAULT_DANGER_RESPONSE_MIN = 120;

// ─── 1. Business Features ──────────────────────────────────────────────────

export interface BusinessFeatures {
  // Contrato
  planType: string; // "Lite Anual", "Pro Anual", "Super", etc.
  planCategory: 'anual' | 'mensual' | 'desconocido';
  equipmentCount: number;
  contractValue: number;
  contractValueCLP: number;

  // Cliente
  fleetSize: string; // "1 vehículo", "2 a 9 vehículos", "10 a 49", "+50"
  hasCompany: boolean;
  industry: string; // inferido del nombre de empresa
  clientTags: string[];

  // Adquisición
  acquisitionChannel: string; // "Social media", "Organic Search", "Paid Search", etc.
  channelCategory: 'whatsapp' | 'organico' | 'ads' | 'directo' | 'referido' | 'otro';
  leadScore: number; // score de GHL al momento del cierre

  // Proceso
  timeToClose: number; // días desde creación hasta won
  closeSpeed: 'instantaneo' | 'rapido' | 'normal' | 'lento'; // ≤1d, ≤7d, ≤30d, >30d
  stageAtCreation: string;
  stageAtWin: string;
}

/**
 * Mapeo de IDs de custom fields de GHL → significado de negocio. Es por tenant
 * (cada cuenta GHL tiene IDs distintos). Se persiste en `appSettings` y la ruta
 * lo inyecta; los defaults son los de CentralGPS para no romper su análisis.
 */
export interface CustomFieldMap {
  plan?: string;
  equipos?: string;
  /** Custom field de oportunidad "Comentarios" (lo que el cliente cotiza). */
  comentarios?: string;
}

/** Defaults de CentralGPS — override por tenant vía `appSettings.ghlField*`. */
export const DEFAULT_FIELD_MAP: CustomFieldMap = {
  plan: 'GGjdMKQ53tRNd8oGLzGu',
  equipos: 'yFxYOya6JEfZeA69R63D',
  comentarios: 'tPpr8KLntYIHydAUYPIr',
};

export function extractBusinessFeatures(
  opp: GHLOpportunity,
  fieldMap: CustomFieldMap = DEFAULT_FIELD_MAP,
): BusinessFeatures {
  // Resolución por-campo: un mapa parcial cae al default en lo que falte.
  const planFieldId = fieldMap.plan ?? DEFAULT_FIELD_MAP.plan;
  const equiposFieldId = fieldMap.equipos ?? DEFAULT_FIELD_MAP.equipos;

  // Plan type
  const planType =
    opp.customFields?.find((f) => f.id === planFieldId)?.fieldValueString ?? 'desconocido';
  const planCategory: BusinessFeatures['planCategory'] = planType.toLowerCase().includes('anual')
    ? 'anual'
    : planType.toLowerCase().includes('mensual')
      ? 'mensual'
      : 'desconocido';

  // Equipment count
  const equipRaw = opp.customFields?.find((f) => f.id === equiposFieldId)?.fieldValueNumber;
  const equipmentCount = equipRaw ?? 0;

  // Fleet size from tags
  const tags = opp.contact.tags ?? [];
  let fleetSize = 'desconocido';
  for (const tag of tags) {
    if (tag.includes('+50') || tag.includes('50')) fleetSize = '+50 vehículos';
    else if (tag.includes('10 a 49') || tag.includes('10 a')) fleetSize = '10 a 49 vehículos';
    else if (tag.includes('2 a 9') || tag.includes('2 a')) fleetSize = '2 a 9 vehículos';
    else if (tag.includes('1 vehículo') || tag.includes('1 vehiculo')) fleetSize = '1 vehículo';
  }

  // Acquisition channel
  const firstAttr = opp.attributions?.find((a) => a.isFirst);
  const channel = firstAttr?.utmSessionSource ?? firstAttr?.medium ?? 'desconocido';
  const channelCategory: BusinessFeatures['channelCategory'] =
    channel.toLowerCase().includes('social media') || channel === 'whatsapp'
      ? 'whatsapp'
      : channel.toLowerCase().includes('organic')
        ? 'organico'
        : channel.toLowerCase().includes('paid') || channel.toLowerCase().includes('adwords')
          ? 'ads'
          : channel.toLowerCase().includes('direct')
            ? 'directo'
            : channel.toLowerCase().includes('referral') || channel.toLowerCase().includes('crm')
              ? 'referido'
              : 'otro';

  // Lead score
  const leadScore = opp.contact.score?.[0]?.score ?? 0;

  // Time to close: usar lastStageChangeAt (momento real del won) — updatedAt se
  // contamina con cualquier edición posterior (hubo una edición masiva el
  // 15-may-2026 que inflaba el promedio de cierre a 56d vs 12d de mediana).
  const closedAtMs = new Date(opp.lastStageChangeAt ?? opp.updatedAt).getTime();
  const timeToClose = Math.max(
    0,
    Math.floor((closedAtMs - new Date(opp.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
  );
  const closeSpeed: BusinessFeatures['closeSpeed'] =
    timeToClose <= 1
      ? 'instantaneo'
      : timeToClose <= 7
        ? 'rapido'
        : timeToClose <= 30
          ? 'normal'
          : 'lento';

  return {
    planType,
    planCategory,
    equipmentCount,
    contractValue: opp.monetaryValue,
    contractValueCLP: opp.monetaryValue,
    fleetSize,
    hasCompany: !!opp.contact.companyName,
    industry: opp.contact.companyName ?? 'particular',
    clientTags: tags,
    acquisitionChannel: channel,
    channelCategory,
    leadScore,
    timeToClose,
    closeSpeed,
    stageAtCreation: opp.pipelineStageName,
    stageAtWin: opp.pipelineStageName,
  };
}

// ─── 2. Communication Patterns ─────────────────────────────────────────────

export interface CommunicationPatterns {
  totalMessages: number;
  inboundCount: number;
  outboundCount: number;
  inboundRatio: number; // inbound / total — >0.5 = client very engaged

  // Response times (outbound after inbound)
  avgResponseMinutes: number;
  medianResponseMinutes: number;
  maxResponseMinutes: number;
  responseUnder30min: number; // count
  responseUnder1h: number;
  responseUnder4h: number;

  // Activity windows
  activeDays: number; // days between first and last message
  messagesPerDay: number; // message density
  businessHoursRatio: number; // 8am-7pm CLT / total

  // Content signals
  hasAttachments: boolean;
  hasVoiceNotes: boolean; // voice notes = high engagement
  hasEmailThread: boolean; // email + WhatsApp = multi-channel
  paymentMentioned: boolean; // payment proof or bank details shared
  integrationMentioned: boolean; // integration requirements discussed

  // Engagement signals
  clientInitiatedConversation: boolean; // first message was inbound
  clientSentDocuments: boolean; // client sent files/attachments
  positiveLanguageCount: number; // "gracias", "perfecto", "ok", etc.
  questionCount: number; // client asked questions (engagement)

  // Key milestone detection
  milestones: Array<{
    type:
      | 'first_contact'
      | 'quote_sent'
      | 'quote_accepted'
      | 'payment_made'
      | 'registration_completed'
      | 'installation_coordinated';
    date: string;
    detail: string;
  }>;
}

const POSITIVE_PATTERNS =
  /(?:gracias|perfecto|excelente|genial|buen[oí]simo|okey|dale|listo|de acuerdo)/i;
const QUESTION_PATTERNS =
  /(?:c[oó]mo|cu[áa]ndo|cu[áa]nto|d[oó]nde|qui[ée]n|por qu[ée]|cu[aá]l|me (?:puedes|podr[íi]as|ayudas|indicas|confirmas))/i;

export function extractCommunicationPatterns(messages: GHLMessage[]): CommunicationPatterns {
  if (messages.length === 0) {
    return {
      totalMessages: 0,
      inboundCount: 0,
      outboundCount: 0,
      inboundRatio: 0,
      avgResponseMinutes: 0,
      medianResponseMinutes: 0,
      maxResponseMinutes: 0,
      responseUnder30min: 0,
      responseUnder1h: 0,
      responseUnder4h: 0,
      activeDays: 0,
      messagesPerDay: 0,
      businessHoursRatio: 0,
      hasAttachments: false,
      hasVoiceNotes: false,
      hasEmailThread: false,
      paymentMentioned: false,
      integrationMentioned: false,
      clientInitiatedConversation: false,
      clientSentDocuments: false,
      positiveLanguageCount: 0,
      questionCount: 0,
      milestones: [],
    };
  }

  const sorted = [...messages]
    .filter((m) => Number.isFinite(msOf(m.dateAdded)))
    .sort((a, b) => msOf(a.dateAdded) - msOf(b.dateAdded));

  // Basic counts
  // Only count actual message types (WhatsApp, Email, Call), filter system messages
  const realMessages = sorted.filter(
    (m) => !m.messageType.startsWith('TYPE_ACTIVITY') && m.body?.trim().length > 0,
  );
  const inbound = realMessages.filter((m) => m.direction === 'inbound');
  const outbound = realMessages.filter((m) => m.direction === 'outbound');
  const totalMessages = realMessages.length;

  // Response times: tiempo hasta la PRIMERA respuesta del equipo por cada ráfaga
  // inbound. Recorre la conversación en orden: al primer inbound sin contestar
  // abre un pendiente; el siguiente outbound lo cierra y registra el gap. Así
  // varios inbounds seguidos no inflan la muestra (antes cada inbound matcheaba
  // el mismo outbound). Se descartan gaps ≤0 (timestamps sucios/idénticos) y
  // outliers > MAX_RESPONSE_MIN (re-enganche, no respuesta).
  const responseTimes: number[] = [];
  let pendingInboundMs: number | null = null;
  for (const msg of realMessages) {
    const t = msOf(msg.dateAdded);
    if (msg.direction === 'inbound') {
      if (pendingInboundMs === null) pendingInboundMs = t;
    } else if (pendingInboundMs !== null) {
      const respMinutes = (t - pendingInboundMs) / (1000 * 60);
      if (respMinutes > 0 && respMinutes <= MAX_RESPONSE_MIN) responseTimes.push(respMinutes);
      pendingInboundMs = null;
    }
  }

  const sortedRT = [...responseTimes].sort((a, b) => a - b);
  const avgResponseMinutes =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length)
      : 0;
  const medianResponseMinutes = sortedRT.length > 0 ? Math.round(median(sortedRT)) : 0;

  // Activity window
  const firstDate = new Date(sorted[0].dateAdded);
  const lastDate = new Date(sorted[sorted.length - 1].dateAdded);
  const activeDays = Math.max(
    1,
    Math.ceil((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)),
  );

  // Business hours (8am-7pm CLT = 12-23 UTC)
  const businessHoursMsgs = realMessages.filter((m) => {
    const h = new Date(m.dateAdded).getUTCHours();
    return h >= 12 && h <= 23;
  });

  // Content detection
  const hasAttachments = realMessages.some((m) => (m.attachments?.length ?? 0) > 0);
  const hasVoiceNotes = realMessages.some((m) =>
    m.attachments?.some((a) => a.url?.endsWith('.ogg')),
  );
  const hasEmailThread = realMessages.some((m) => m.messageType === 'TYPE_EMAIL');

  const allBodies = realMessages.map((m) => m.body).join(' ');
  const paymentMentioned = /(?:transferencia|pago|deposito|banco|cuenta|comprobante|factura)/i.test(
    allBodies,
  );
  const integrationMentioned = /(?:integraci[oó]n|API|SimpleRoute|compatible|conecta)/i.test(
    allBodies,
  );

  // Client signals
  const clientInitiatedConversation = sorted.length > 0 && sorted[0].direction === 'inbound';
  const clientSentDocuments = inbound.some((m) => (m.attachments?.length ?? 0) > 0);

  // Language signals (only client messages)
  const clientBodies = inbound.map((m) => m.body).join(' ');
  const positiveLanguageCount = (clientBodies.match(new RegExp(POSITIVE_PATTERNS, 'gi')) ?? [])
    .length;
  const questionCount = (clientBodies.match(new RegExp(QUESTION_PATTERNS, 'gi')) ?? []).length;

  // Milestones
  const milestones: CommunicationPatterns['milestones'] = [];

  // First contact
  if (sorted.length > 0) {
    milestones.push({
      type: 'first_contact',
      date: sorted[0].dateAdded,
      detail:
        sorted[0].direction === 'inbound' ? 'Cliente inició contacto' : 'Vendedor inició contacto',
    });
  }

  // Quote sent
  const quoteMsg = realMessages.find(
    (m) =>
      m.direction === 'outbound' && /(?:cotizaci[oó]n|presupuesto|enviado|adjunto)/i.test(m.body),
  );
  if (quoteMsg) {
    milestones.push({ type: 'quote_sent', date: quoteMsg.dateAdded, detail: 'Cotización enviada' });
  }

  // Payment
  if (paymentMentioned) {
    const payMsg = realMessages.find(
      (m) =>
        /(?:transferencia|pago|deposito|comprobante)/i.test(m.body) && m.direction === 'inbound',
    );
    if (payMsg) {
      milestones.push({
        type: 'payment_made',
        date: payMsg.dateAdded,
        detail: 'Cliente realizó pago',
      });
    }
  }

  // Installation coordinated
  const installMsg = realMessages.find(
    (m) =>
      m.direction === 'outbound' &&
      /(?:instalaci[oó]n|domicilio|centro de atenci[oó]n|t[ée]cnico)/i.test(m.body),
  );
  if (installMsg) {
    milestones.push({
      type: 'installation_coordinated',
      date: installMsg.dateAdded,
      detail: 'Instalación coordinada',
    });
  }

  return {
    totalMessages,
    inboundCount: inbound.length,
    outboundCount: outbound.length,
    inboundRatio: totalMessages > 0 ? inbound.length / totalMessages : 0,
    avgResponseMinutes,
    medianResponseMinutes,
    maxResponseMinutes: sortedRT.length > 0 ? Math.round(sortedRT[sortedRT.length - 1]) : 0,
    responseUnder30min: responseTimes.filter((t) => t <= 30).length,
    responseUnder1h: responseTimes.filter((t) => t <= 60).length,
    responseUnder4h: responseTimes.filter((t) => t <= 240).length,
    activeDays,
    messagesPerDay: Math.round((totalMessages / activeDays) * 10) / 10,
    businessHoursRatio:
      realMessages.length > 0
        ? Math.round((businessHoursMsgs.length / realMessages.length) * 100) / 100
        : 0,
    hasAttachments,
    hasVoiceNotes,
    hasEmailThread,
    paymentMentioned,
    integrationMentioned,
    clientInitiatedConversation,
    clientSentDocuments,
    positiveLanguageCount,
    questionCount,
    milestones,
  };
}

// ─── 3. Success Thresholds (for Live Opp) ──────────────────────────────────

export interface SuccessThresholds {
  // Time-based
  avgTimeToClose: number;
  medianTimeToClose: number;
  fastCloseThreshold: number; // deals closing ≤N days are "fast"

  // Response-based
  avgResponseMinutes: number;
  medianResponseMinutes: number;
  dangerResponseThreshold: number; // if response > N minutes, risk increases
  idealResponseThreshold: number; // target response time

  // Engagement-based
  avgMessagesPerDeal: number;
  avgInboundRatio: number;
  lowEngagementThreshold: number; // if inbound ratio < N, risk

  // Channel-based
  topChannel: string;
  channelWinRates: Record<string, number>; // channel → win count

  // Plan-based
  topPlan: string;
  planDistribution: Record<string, number>; // plan → count

  // Value-based
  avgContractValue: number;
  medianContractValue: number;
  valueByFleetSize: Record<string, number>; // fleet → avg value

  // Sample info
  sampleSize: number;
  analyzedAt: string;
}

export function computeSuccessThresholds(
  features: BusinessFeatures[],
  patterns: CommunicationPatterns[],
): SuccessThresholds {
  const n = features.length;
  if (n === 0) {
    return {
      avgTimeToClose: 0,
      medianTimeToClose: 0,
      fastCloseThreshold: 0,
      avgResponseMinutes: 0,
      medianResponseMinutes: 0,
      dangerResponseThreshold: 0,
      idealResponseThreshold: 0,
      avgMessagesPerDeal: 0,
      avgInboundRatio: 0,
      lowEngagementThreshold: 0,
      topChannel: '',
      channelWinRates: {},
      topPlan: '',
      planDistribution: {},
      avgContractValue: 0,
      medianContractValue: 0,
      valueByFleetSize: {},
      sampleSize: 0,
      analyzedAt: new Date().toISOString(),
    };
  }

  // Time to close
  const ttcs = features.map((f) => f.timeToClose).sort((a, b) => a - b);
  const avgTimeToClose = Math.round(ttcs.reduce((s, v) => s + v, 0) / n);
  const medianTimeToClose = Math.round(median(ttcs));

  // Response times: cada deal aporta su MEDIANA (robusta a outliers intra-deal),
  // ya saneada en extractCommunicationPatterns. Sobre esas medianas calculamos
  // percentiles entre deals — no promedios crudos ni multiplicadores mágicos.
  const perDealMedians = patterns
    .map((p) => p.medianResponseMinutes)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const hasResponseData = perDealMedians.length > 0;

  const avgResponseMinutes = hasResponseData ? Math.round(mean(perDealMedians)) : 0;
  const medianResponseMinutes = hasResponseData ? Math.round(median(perDealMedians)) : 0;

  // Ideal = mediana de medianas (p50), acotada a un rango defendible.
  // Peligro = p90 entre deals, acotado, y siempre claramente por encima del ideal.
  const idealResponseThreshold = hasResponseData
    ? clamp(medianResponseMinutes, IDEAL_RESPONSE_FLOOR_MIN, IDEAL_RESPONSE_CAP_MIN)
    : DEFAULT_IDEAL_RESPONSE_MIN;
  const dangerResponseThreshold = hasResponseData
    ? clamp(
        Math.max(Math.round(percentile(perDealMedians, 0.9)), idealResponseThreshold * 2),
        DANGER_RESPONSE_FLOOR_MIN,
        DANGER_RESPONSE_CAP_MIN,
      )
    : DEFAULT_DANGER_RESPONSE_MIN;

  // Engagement
  const avgMessagesPerDeal = Math.round(patterns.reduce((s, p) => s + p.totalMessages, 0) / n);
  const avgInboundRatio =
    Math.round((patterns.reduce((s, p) => s + p.inboundRatio, 0) / n) * 100) / 100;

  // Channel distribution
  const channelCounts: Record<string, number> = {};
  for (const f of features) {
    channelCounts[f.channelCategory] = (channelCounts[f.channelCategory] ?? 0) + 1;
  }
  const topChannel = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  // Plan distribution
  const planCounts: Record<string, number> = {};
  for (const f of features) {
    planCounts[f.planType] = (planCounts[f.planType] ?? 0) + 1;
  }
  const topPlan = Object.entries(planCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  // Contract value
  const values = features.map((f) => f.contractValue).sort((a, b) => a - b);
  const avgContractValue = Math.round(values.reduce((s, v) => s + v, 0) / n);
  const medianContractValue = Math.round(median(values));

  // Value by fleet size
  const fleetValues: Record<string, number[]> = {};
  for (const f of features) {
    if (!fleetValues[f.fleetSize]) fleetValues[f.fleetSize] = [];
    fleetValues[f.fleetSize].push(f.contractValue);
  }
  const valueByFleetSize: Record<string, number> = {};
  for (const [fleet, vals] of Object.entries(fleetValues)) {
    valueByFleetSize[fleet] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }

  return {
    avgTimeToClose,
    medianTimeToClose,
    fastCloseThreshold: Math.max(1, Math.round(medianTimeToClose * 0.5)),
    avgResponseMinutes,
    medianResponseMinutes,
    dangerResponseThreshold,
    idealResponseThreshold,
    avgMessagesPerDeal,
    avgInboundRatio,
    lowEngagementThreshold: Math.max(0.1, avgInboundRatio - 0.2),
    topChannel,
    channelWinRates: channelCounts,
    topPlan,
    planDistribution: planCounts,
    avgContractValue,
    medianContractValue,
    valueByFleetSize,
    sampleSize: n,
    analyzedAt: new Date().toISOString(),
  };
}

// ─── 4. Won Deal Summary (aggregate output) ────────────────────────────────

export interface WonDealAnalysis {
  dealId: string;
  contactName: string;
  features: BusinessFeatures;
  patterns: CommunicationPatterns;
  /** Contrato estable (códigos de taxonomy.WIN_FACTORS) que Live Opp comparará. */
  factors: WinFactor[];
  winningFormula: string[]; // human-readable list of what worked (misma fuente que factors)
}

export interface WonTrackOutput {
  analyzedAt: string;
  sampleSize: number;
  totalWonValue: number;
  deals: WonDealAnalysis[];
  thresholds: SuccessThresholds;
  /** Narrativa "playbook" generada por LLM (Fase 2). undefined si el LLM no corrió. */
  playbookSummary?: string;
  /** Cuándo se generó el playbook (ISO). Presente si viene de caché o recién corrido. */
  playbookAnalyzedAt?: string;
}

export function analyzeWonDeal(
  opp: GHLOpportunity,
  messages: GHLMessage[],
  fieldMap: CustomFieldMap = DEFAULT_FIELD_MAP,
): WonDealAnalysis {
  const features = extractBusinessFeatures(opp, fieldMap);
  const patterns = extractCommunicationPatterns(messages);

  // Fuente única: cada condición numérica cumplida aporta un código de taxonomía
  // (contrato para Live Opp) + su etiqueta legible. Los números viven en código;
  // el LLM solo agrega la narrativa agregada (playbookSummary).
  const factors: WinFactor[] = [];
  const formula: string[] = [];
  const add = (factor: WinFactor, label: string) => {
    factors.push(factor);
    formula.push(label);
  };

  if (features.closeSpeed === 'instantaneo' || features.closeSpeed === 'rapido') {
    add('fast_close', `Cierre ${features.closeSpeed} (${features.timeToClose}d)`);
  }
  if (patterns.avgResponseMinutes <= 60) {
    add('fast_response', `Respuesta rápida (promedio ${patterns.avgResponseMinutes}min)`);
  }
  if (patterns.inboundRatio >= 0.4) {
    add(
      'high_engagement',
      `Alto engagement del cliente (${Math.round(patterns.inboundRatio * 100)}% inbound)`,
    );
  }
  if (patterns.hasVoiceNotes) {
    add('voice_notes', 'Cliente envió notas de voz (alto compromiso)');
  }
  if (patterns.hasEmailThread) {
    add('multichannel', 'Comunicación multi-canal (WhatsApp + Email)');
  }
  if (patterns.paymentMentioned && patterns.clientSentDocuments) {
    add('proactive_client', 'Cliente proactivo con documentos y pago');
  }
  if (features.channelCategory === 'whatsapp') {
    add('preferred_channel', 'Canal WhatsApp (respuesta rápida)');
  }
  if (features.planCategory === 'anual') {
    add('annual_plan', `Plan anual (${features.planType}) — mayor retención`);
  }
  if (features.equipmentCount >= 3) {
    add('multi_equipment', `Multi-equipo (${features.equipmentCount}) — potencial upsell`);
  }
  if (patterns.questionCount >= 3) {
    add('high_intent', `Cliente hizo ${patterns.questionCount} preguntas — alta intención`);
  }
  if (patterns.positiveLanguageCount >= 2) {
    add('positive_language', `Lenguaje positivo (${patterns.positiveLanguageCount} expresiones)`);
  }
  if (patterns.integrationMentioned) {
    add('integration_fit', 'Requerimiento de integración satisfecho');
  }
  if (features.leadScore >= 20) {
    add('high_lead_score', `Lead score alto (${features.leadScore}) al entrar`);
  }

  return {
    dealId: opp.id,
    contactName: opp.contact.name,
    features,
    patterns,
    factors,
    winningFormula: formula.length > 0 ? formula : ['Análisis insuficiente — revisar manualmente'],
  };
}

export function generateWonTrackOutput(
  deals: WonDealAnalysis[],
  allFeatures: BusinessFeatures[],
  allPatterns: CommunicationPatterns[],
): WonTrackOutput {
  const thresholds = computeSuccessThresholds(allFeatures, allPatterns);

  return {
    analyzedAt: new Date().toISOString(),
    sampleSize: deals.length,
    totalWonValue: deals.reduce((s, d) => s + d.features.contractValue, 0),
    deals: deals.sort((a, b) => b.features.contractValue - a.features.contractValue),
    thresholds,
  };
}

/**
 * Genera un resumen en markdown del análisis Won Track.
 * Útil para reportes y dashboards.
 */
export function formatWonTrackMarkdown(output: WonTrackOutput): string {
  const { thresholds, deals } = output;
  const fmt = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 0 });

  const lines: string[] = [
    `# 🏆 Won Track — Análisis de Ventas Exitosas`,
    '',
    `> ${output.sampleSize} deals ganados analizados — **$${fmt(output.totalWonValue)} CLP** en revenue.`,
    '',
    `## 📊 Umbrales de Éxito (→ Live Opp)`,
    '',
    `| Métrica | Valor | Implicancia para Live Opp |`,
    `|---|---|---|`,
    `| Tiempo promedio cierre | ${thresholds.avgTimeToClose}d | Alertar si deal abierto >${thresholds.avgTimeToClose * 2}d sin avance |`,
    `| Tiempo respuesta ideal | ≤${thresholds.idealResponseThreshold}min | Alerta si respuesta >${thresholds.dangerResponseThreshold}min |`,
    `| Ratio inbound promedio | ${Math.round(thresholds.avgInboundRatio * 100)}% | Riesgo si <${Math.round(thresholds.lowEngagementThreshold * 100)}% |`,
    `| Mensajes por deal | ${thresholds.avgMessagesPerDeal} | Baja actividad = riesgo de abandono |`,
    `| Canal top | ${thresholds.topChannel} (${thresholds.channelWinRates[thresholds.topChannel] ?? 0} deals) | Priorizar seguimiento en este canal |`,
    `| Plan más vendido | ${thresholds.topPlan} (${thresholds.planDistribution[thresholds.topPlan] ?? 0} deals) | Sugerir este plan en cotizaciones |`,
    `| Valor promedio contrato | $${fmt(thresholds.avgContractValue)} CLP | Benchmark para calificar leads |`,
    '',
    `## 📋 Top Deals Analizados`,
    '',
    `| # | Contacto | Valor | Plan | Equipos | Canal | Cierre | Fórmula de éxito |`,
    `|---|---|---|---|---|---|---|---|`,
  ];

  deals.slice(0, 20).forEach((d, i) => {
    const f = d.features;
    const p = d.patterns;
    const formula = d.winningFormula.slice(0, 3).join(' · ');
    lines.push(
      `| ${i + 1} | **${d.contactName}** | $${fmt(f.contractValue)} | ${f.planType} | ${f.equipmentCount} | ${f.channelCategory} | ${f.timeToClose}d | ${formula} |`,
    );
  });

  lines.push('');
  lines.push(`## 💡 Fórmulas de Éxito Más Comunes`);
  lines.push('');

  // Aggregate winning formulas
  const formulaCounts = new Map<string, number>();
  for (const d of deals) {
    for (const f of d.winningFormula) {
      formulaCounts.set(f, (formulaCounts.get(f) ?? 0) + 1);
    }
  }
  const topFormulas = Array.from(formulaCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [formula, count] of topFormulas) {
    const pct = Math.round((count / deals.length) * 100);
    lines.push(`- **${formula}** — presente en ${count} deals (${pct}%)`);
  }

  lines.push('');
  lines.push(`---`);
  lines.push(
    `*Won Track generado el ${new Date().toISOString()} — alimenta Live Opp con umbrales de éxito*`,
  );

  return lines.join('\n');
}
