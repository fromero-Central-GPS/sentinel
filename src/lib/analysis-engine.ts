/**
 * Cassper Analysis Engine
 *
 * Motor de análisis automático de conversaciones GHL.
 * Implementa los 5 patrones de análisis definidos en CEN-755:
 *
 * 1. Detección de intención de compra
 * 2. Clasificación de etapa del funnel
 * 3. Detección de abandono
 * 4. Diagnóstico de razón de pérdida
 * 5. Scoring de recuperabilidad
 *
 * Diseñado para ser ejecutado como parte de un Paperclip Agent
 * conectado al MCP de GHL (prod-ghl-mcp).
 */

// ─── Tipos de entrada (datos crudos de GHL MCP) ───────────────────────────

export interface GHLMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  messageType: string;
  dateAdded: string;
  contentType?: string;
  source?: string;
  meta?: Record<string, unknown>;
}

export interface GHLConversationInput {
  id: string;
  contactId: string;
  contactName: string;
  email?: string;
  phone?: string;
  lastMessageDate: number;
  lastMessageType: string;
  lastMessageDirection: 'inbound' | 'outbound';
  lastMessageBody: string;
  unreadCount: number;
  tags: string[];
  scoring?: Array<{ id: string; score: number }>;
  messages?: GHLMessage[];
}

export interface GHLOpportunityInput {
  id: string;
  name: string;
  contactId: string;
  contactName: string;
  monetaryValue: number;
  pipelineId: string;
  pipelineStageId: string;
  pipelineStageName: string;
  status: 'open' | 'won' | 'lost' | 'abandoned';
  lastStageChangeAt?: string;
  createdAt: string;
  customFields?: Array<{ id: string; fieldValueString?: string }>;
}

// ─── Tipos de salida (resultados del análisis) ────────────────────────────

export type LossReasonCategory =
  | 'sin_seguimiento'
  | 'precio'
  | 'competidor'
  | 'producto_no_disponible'
  | 'falta_informacion'
  | 'proceso_complejo'
  | 'cliente_explorando'
  | 'desconocido';

export type FunnelStage =
  | 'consulta_inicial'
  | 'cotizacion'
  | 'demo_plataforma'
  | 'negociacion'
  | 'cierre'
  | 'seguimiento'
  | 'perdido'
  | 'ganado';

export type RecoverabilityPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface IntentSignals {
  purchaseIntent: boolean;
  signals: string[];
  score: number; // 0-100
  keyPhrases: string[];
}

export interface StageClassification {
  detectedStage: FunnelStage;
  confidence: number; // 0-1
  evidence: string[];
  ghlStage: string; // etapa original en GHL
}

export interface AbandonmentDiagnosis {
  isAbandoned: boolean;
  daysSinceLastContact: number;
  lastInboundDate: string | null;
  lastOutboundDate: string | null;
  direction: 'inbound_sin_respuesta' | 'outbound_sin_respuesta' | 'mutuo_silencio' | 'activo';
}

export interface LossReasonDiagnosis {
  primaryReason: LossReasonCategory;
  secondaryReasons: LossReasonCategory[];
  confidence: number; // 0-1
  evidence: string[];
  suggestedAction: string;
}

export interface RecoverabilityScore {
  totalScore: number; // 0-100
  valueScore: number; // 0-30
  recencyScore: number; // 0-25
  intentScore: number; // 0-25
  engagementScore: number; // 0-20
  priority: RecoverabilityPriority;
  factors: string[];
}

export interface ConversationAnalysis {
  conversationId: string;
  contactId: string;
  contactName: string;
  opportunityId?: string;
  opportunityValue: number;
  channel: string;
  intentSignals: IntentSignals;
  stageClassification: StageClassification;
  abandonment: AbandonmentDiagnosis;
  lossReason: LossReasonDiagnosis;
  recoverability: RecoverabilityScore;
  analyzedAt: string;
}

export interface BatchAnalysisResult {
  analyzedAt: string;
  pipelineId: string;
  pipelineName: string;
  totalAnalyzed: number;
  summary: {
    totalValue: number;
    recoverableValue: number;
    highPriorityCount: number;
    urgentCount: number;
    avgRecoverabilityScore: number;
    topLossReasons: Array<{ reason: LossReasonCategory; count: number; value: number }>;
    lossByStage: Array<{ stage: FunnelStage; count: number; value: number }>;
  };
  conversations: ConversationAnalysis[];
}

// ─── 1. Detección de Intención de Compra ──────────────────────────────────

const PURCHASE_INTENT_PATTERNS: Array<{ pattern: RegExp; weight: number; category: string }> = [
  // Alta intención (peso 20-25)
  { pattern: /(?:me interesa|me interesaría|estoy interesad[oa]|quiero comprar|quiero contratar|compramos|contratamos)/i, weight: 25, category: 'interes_directo' },
  { pattern: /(?:cotizaci[oó]n|cotizar|cu[áa]nto (?:cuesta|vale|sale)|precio|valor|cuota)/i, weight: 20, category: 'consulta_precio' },
  { pattern: /(?:demo|demostraci[oó]n|probar|prueba|ver (?:la |el )?plataforma|c[oó]mo funciona)/i, weight: 22, category: 'solicitud_demo' },
  { pattern: /(?:urgente|lo antes posible|para (?:hoy|ma[ñn]ana|esta semana)|necesito|necesitamos)/i, weight: 18, category: 'urgencia' },

  // Intención media (peso 10-15)
  { pattern: /(?:informaci[oó]n|m[áa]s info|detalles|caracter[íi]sticas|especificaciones)/i, weight: 12, category: 'solicitud_info' },
  { pattern: /(?:comparar|comparativa|diferencia|vs\.?|versus|alternativa)/i, weight: 10, category: 'comparacion' },
  { pattern: /(?:flota|veh[íi]culos|camion(?:es|etas)|autos|buses|maquinaria)/i, weight: 14, category: 'mencion_flota' },
  { pattern: /(?:instalaci[oó]n|instalar|cu[áa]ndo (?:pueden|podr[íi]an)|tiempo de instalaci)/i, weight: 15, category: 'consulta_instalacion' },

  // Señales débiles (peso 5-8)
  { pattern: /(?:gps|rastreo|monitoreo|localizaci[oó]n|tracking|seguimiento)/i, weight: 8, category: 'mencion_gps' },
  { pattern: /(?:gracias|ok|okey|dale|bueno|perfecto|de acuerdo)/i, weight: 5, category: 'engagement_positivo' },
  { pattern: /(?:env[ií]a(?:me|n)|mand[aá](?:me|n)|reenv[ií]a)/i, weight: 12, category: 'solicitud_envio' },
  { pattern: /(?:ll[aá]ma(?:me|n)|comun[íi]ca(?:te|rse)|agendar|coordinar|reuni[oó]n)/i, weight: 16, category: 'solicitud_contacto' },
];

export function detectPurchaseIntent(messages: GHLMessage[]): IntentSignals {
  const allText = messages.map((m) => m.body).join(' ');
  const signals: string[] = [];
  const keyPhrases: string[] = [];
  let totalScore = 0;

  for (const { pattern, weight, category } of PURCHASE_INTENT_PATTERNS) {
    const matches = allText.match(pattern);
    if (matches) {
      signals.push(category);
      keyPhrases.push(matches[0]);
      totalScore += weight;
    }
  }

  // Bonus por inbound reciente con señales
  const recentInbound = messages.filter(
    (m) => m.direction === 'inbound'
  );
  if (recentInbound.length > 0 && signals.length >= 2) {
    totalScore += 10;
  }

  // Bonus por múltiples mensajes inbound (conversación activa)
  if (recentInbound.length >= 3) {
    totalScore += 5;
  }

  return {
    purchaseIntent: totalScore >= 25,
    signals: Array.from(new Set(signals)),
    score: Math.min(100, totalScore),
    keyPhrases: Array.from(new Set(keyPhrases)),
  };
}

// ─── 2. Clasificación de Etapa del Funnel ────────────────────────────────

const STAGE_PATTERNS: Array<{ stage: FunnelStage; patterns: RegExp[]; weight: number }> = [
  {
    stage: 'consulta_inicial',
    patterns: [
      /(?:informaci[oó]n|m[áa]s info|consulta|saber m[áa]s|conocer)/i,
      /(?:hola|buenas|buen d[ií]a|buenas tardes)/i,
      /(?:vi (?:su|un) anuncio|publicidad|google|instagram|facebook|lleg[uée] buscando)/i,
    ],
    weight: 1,
  },
  {
    stage: 'cotizacion',
    patterns: [
      /(?:cotizaci[oó]n|cotizar|cu[áa]nto (?:cuesta|vale|sale)|precio|valor)/i,
      /(?:presupuesto|proforma|factura|boleta)/i,
      /(?:cu[áa]ntos (?:equipos|veh[íi]culos|dispositivos)|para cu[áa]ntos)/i,
    ],
    weight: 2,
  },
  {
    stage: 'demo_plataforma',
    patterns: [
      /(?:demo|demostraci[oó]n|probar|prueba|plataforma|sistema|software)/i,
      /(?:c[oó]mo (?:funciona|se ve|es la interfaz)|acceso|ingresar|login)/i,
    ],
    weight: 3,
  },
  {
    stage: 'negociacion',
    patterns: [
      /(?:negociar|negociaci[oó]n|descuento|rebaja|mejor precio)/i,
      /(?:competencia|otra empresa|m[áa]s barato|diferencia de precio)/i,
      /(?:condiciones|contrato|t[ée]rminos|garant[íi]a|plazo)/i,
    ],
    weight: 4,
  },
  {
    stage: 'cierre',
    patterns: [
      /(?:comprar|contratar|cerrar|avanzar|proceder|seguir adelante)/i,
      /(?:datos para (?:factura|instalaci[oó]n)|documentos|firmar)/i,
      /(?:cu[áa]ndo (?:empieza|instalan|comienzan)|fecha de inicio)/i,
    ],
    weight: 5,
  },
  {
    stage: 'seguimiento',
    patterns: [
      /(?:seguimiento|recordatorio|pendiente|volver a contactar)/i,
      /(?:no (?:he|hemos) sabido|sin noticias|hace tiempo)/i,
      /(?:revisando|evaluando|todav[íi]a (?:no|estoy|estamos)|a[úu]n no)/i,
    ],
    weight: 0,
  },
];

export function classifyFunnelStage(
  messages: GHLMessage[],
  ghlStage: string
): StageClassification {
  const allText = messages.map((m) => m.body).join(' ');
  const scores: Array<{ stage: FunnelStage; score: number; evidence: string[] }> = [];

  for (const { stage, patterns, weight } of STAGE_PATTERNS) {
    const evidence: string[] = [];
    let score = 0;
    for (const pattern of patterns) {
      const matches = allText.match(pattern);
      if (matches) {
        evidence.push(matches[0]);
        score += weight;
      }
    }
    scores.push({ stage, score, evidence });
  }

  // Ordenar por score descendente
  scores.sort((a, b) => b.score - a.score);

  const top = scores[0];
  const confidence = top.score > 0
    ? Math.min(1, top.score / (scores[1]?.score + top.score || top.score))
    : 0.3;

  return {
    detectedStage: top.score > 0 ? top.stage : 'consulta_inicial',
    confidence,
    evidence: top.evidence,
    ghlStage,
  };
}

// ─── 3. Detección de Abandono ────────────────────────────────────────────

const ABANDONMENT_THRESHOLD_DAYS = 7; // días sin contacto para considerar abandono
const URGENT_THRESHOLD_HOURS = 4; // horas sin respuesta para alerta temprana

export function detectAbandonment(
  messages: GHLMessage[],
  lastMessageDate: number
): AbandonmentDiagnosis {
  const now = Date.now();
  const daysSinceLastContact = Math.floor(
    (now - lastMessageDate) / (1000 * 60 * 60 * 24)
  );

  // Encontrar último mensaje inbound y outbound
  let lastInboundDate: string | null = null;
  let lastOutboundDate: string | null = null;

  for (const msg of messages) {
    if (msg.direction === 'inbound') {
      if (!lastInboundDate || msg.dateAdded > lastInboundDate) {
        lastInboundDate = msg.dateAdded;
      }
    } else {
      if (!lastOutboundDate || msg.dateAdded > lastOutboundDate) {
        lastOutboundDate = msg.dateAdded;
      }
    }
  }

  // Determinar dirección del abandono
  let direction: AbandonmentDiagnosis['direction'] = 'activo';
  if (daysSinceLastContact >= ABANDONMENT_THRESHOLD_DAYS) {
    if (lastInboundDate && lastOutboundDate) {
      const inboundTime = new Date(lastInboundDate).getTime();
      const outboundTime = new Date(lastOutboundDate).getTime();
      if (inboundTime > outboundTime) {
        direction = 'inbound_sin_respuesta';
      } else if (outboundTime > inboundTime) {
        direction = 'outbound_sin_respuesta';
      } else {
        direction = 'mutuo_silencio';
      }
    } else if (lastInboundDate && !lastOutboundDate) {
      direction = 'inbound_sin_respuesta';
    } else if (!lastInboundDate && lastOutboundDate) {
      direction = 'outbound_sin_respuesta';
    } else {
      direction = 'mutuo_silencio';
    }
  }

  return {
    isAbandoned: daysSinceLastContact >= ABANDONMENT_THRESHOLD_DAYS,
    daysSinceLastContact,
    lastInboundDate,
    lastOutboundDate,
    direction,
  };
}

// ─── 4. Diagnóstico de Razón de Pérdida ──────────────────────────────────

const LOSS_REASON_PATTERNS: Array<{
  reason: LossReasonCategory;
  patterns: RegExp[];
  suggestion: string;
}> = [
  {
    reason: 'precio',
    patterns: [
      /(?:muy caro|demasiado caro|no (?:tengo|tenemos) presupuesto|fuera de (?:rango|presupuesto|alcance))/i,
      /(?:m[áa]s barato|econ[óo]mico|costoso|precio elevado|no (?:puedo|podemos) pagar)/i,
      /(?:hay algo m[áa]s barato|tienen planes m[áa]s econ[óo]micos)/i,
    ],
    suggestion: 'Ofrecer plan alternativo con menor precio o plan escalonado. Destacar ROI y ahorro a largo plazo.',
  },
  {
    reason: 'competidor',
    patterns: [
      /(?:ya (?:tengo|tenemos|contrat[eé]|compr[eé])|estoy con otra empresa|otro proveedor)/i,
      /(?:competencia|competidor|(?:wialon|satelital|gurtam|tracking chile|m2m|entel|claro|movistar))/i,
      /(?:me ofrecieron|me cotizaron en otro lado|encontr[eé] (?:algo|uno) m[áa]s)/i,
    ],
    suggestion: 'Comparar ventajas diferenciales. Enfocar en servicio, soporte local, funcionalidades únicas.',
  },
  {
    reason: 'producto_no_disponible',
    patterns: [
      /(?:no (?:tienen|hay|disponen|cuentan con)|(?:necesito|busco) (?:algo|un modelo|una versi[oó]n) (?:espec[íi]fic[ao]|particular|diferente))/i,
      /(?:no (?:sirve|funciona|aplica|corre) para|incompatible|no compatible)/i,
      /(?:stock|disponible|agotado|sin stock|no tienen en este momento)/i,
    ],
    suggestion: 'Verificar disponibilidad futura. Ofrecer producto alternativo o funcionalidad equivalente.',
  },
  {
    reason: 'falta_informacion',
    patterns: [
      /(?:no (?:s[ée]|tengo claro|entiendo|comprendo)|(?:me falta|necesito) (?:m[áa]s |)info)/i,
      /(?:c[oó]mo (?:funciona|se usa|se instala)|no me qued[oó] claro)/i,
      /(?:podr[íi]as explicar|me puedes contar m[áa]s|no conozco (?:bien|mucho))/i,
    ],
    suggestion: 'Enviar material informativo, video demo, caso de éxito relevante. Agendar llamada explicativa.',
  },
  {
    reason: 'sin_seguimiento',
    patterns: [
      /(?:no (?:me|nos) (?:han |ha |)(?:contactado|llamado|respondido|escrito)|(?:nadie|nunca) (?:me |nos |)(?:contact[oó]|llam[oó]|respondi[oó]))/i,
      /(?:se (?:perdi[oó]|cort[oó]) (?:el |la |)contacto|dejaron de responder|no supe m[áa]s)/i,
      /(?:sigo esperando|(?:qued[eé]|quedamos) (?:a la espera|pendiente|en veremos))/i,
    ],
    suggestion: 'Contactar inmediatamente con disculpas. Priorizar seguimiento humano, no automatizado.',
  },
  {
    reason: 'proceso_complejo',
    patterns: [
      /(?:muy (?:complejo|complicado|dif[íi]cil|engorroso|lento)|mucho (?:tr[áa]mite|papeleo|burocracia))/i,
      /(?:no (?:es|era|fue) (?:simple|f[áa]cil|r[áa]pido)|demasiados pasos|muchas vueltas)/i,
      /(?:proceso (?:largo|complicado|tedioso)|instalaci[oó]n muy compleja)/i,
    ],
    suggestion: 'Simplificar onboarding. Ofrecer instalación express o setup guiado. Reducir fricción.',
  },
  {
    reason: 'cliente_explorando',
    patterns: [
      /(?:s[oó]lo (?:estoy|estaba) (?:viendo|mirando|consultando|cotizando|explorando))/i,
      /(?:no (?:es|era) para (?:ahora|ya|este mes)|m[áa]s adelante|en (?:unos|algunos) (?:meses|semanas))/i,
      /(?:gracias por (?:la |su |)informaci[oó]n|lo (?:tendr[eé]|voy a tener) en cuenta|(?:te|les) aviso)/i,
    ],
    suggestion: 'Programar seguimiento en 30-60 días. Mantener en nurture con contenido relevante.',
  },
];

export function diagnoseLossReason(
  messages: GHLMessage[],
  opportunityStatus: string,
  abandonment: AbandonmentDiagnosis
): LossReasonDiagnosis {
  const allText = messages.map((m) => m.body).join(' ');
  const scores: Array<{ reason: LossReasonCategory; score: number; evidence: string[]; suggestion: string }> = [];

  for (const { reason, patterns, suggestion } of LOSS_REASON_PATTERNS) {
    const evidence: string[] = [];
    let score = 0;
    for (const pattern of patterns) {
      const matches = allText.match(pattern);
      if (matches) {
        evidence.push(matches[0]);
        score += 1;
      }
    }
    scores.push({ reason, score, evidence, suggestion });
  }

  // Si no hay evidencia textual pero hay abandono, inferir
  if (scores.every((s) => s.score === 0)) {
    if (abandonment.direction === 'inbound_sin_respuesta') {
      return {
        primaryReason: 'sin_seguimiento',
        secondaryReasons: [],
        confidence: 0.6,
        evidence: [`Cliente escribió y no hubo respuesta en ${abandonment.daysSinceLastContact} días`],
        suggestedAction: 'Contactar inmediatamente. El cliente mostró interés activo y no fue atendido.',
      };
    }
    if (abandonment.isAbandoned && abandonment.daysSinceLastContact > 30) {
      return {
        primaryReason: 'cliente_explorando',
        secondaryReasons: [],
        confidence: 0.4,
        evidence: [`Sin contacto por ${abandonment.daysSinceLastContact} días, sin señales claras en la conversación`],
        suggestedAction: 'Reactivar con contenido de valor. Evaluar si vale la pena el esfuerzo de recuperación.',
      };
    }
    return {
      primaryReason: 'desconocido',
      secondaryReasons: [],
      confidence: 0.2,
      evidence: ['No se detectaron patrones claros en la conversación'],
      suggestedAction: 'Revisar manualmente la conversación para entender el contexto.',
    };
  }

  // Ordenar por score
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1];

  return {
    primaryReason: top.score > 0 ? top.reason : 'desconocido',
    secondaryReasons: second && second.score > 0
      ? [second.reason]
      : [],
    confidence: top.score > 0
      ? Math.min(1, top.score / (scores.reduce((sum, s) => sum + s.score, 0) || top.score))
      : 0.2,
    evidence: top.evidence,
    suggestedAction: top.suggestion,
  };
}

// ─── 5. Scoring de Recuperabilidad ────────────────────────────────────────

export function scoreRecoverability(
  opportunityValue: number,
  abandonment: AbandonmentDiagnosis,
  intentSignals: IntentSignals,
  messages: GHLMessage[]
): RecoverabilityScore {
  // Sub-score: Valor (0-30)
  // Escala logarítmica para no sobre-priorizar deals muy grandes
  let valueScore: number;
  if (opportunityValue <= 0) valueScore = 5;
  else if (opportunityValue < 100000) valueScore = 8;
  else if (opportunityValue < 500000) valueScore = 15;
  else if (opportunityValue < 1000000) valueScore = 22;
  else if (opportunityValue < 5000000) valueScore = 27;
  else valueScore = 30;

  // Sub-score: Recencia (0-25)
  let recencyScore: number;
  if (abandonment.daysSinceLastContact <= 1) recencyScore = 25;
  else if (abandonment.daysSinceLastContact <= 3) recencyScore = 22;
  else if (abandonment.daysSinceLastContact <= 7) recencyScore = 18;
  else if (abandonment.daysSinceLastContact <= 14) recencyScore = 12;
  else if (abandonment.daysSinceLastContact <= 30) recencyScore = 7;
  else if (abandonment.daysSinceLastContact <= 60) recencyScore = 3;
  else recencyScore = 1;

  // Sub-score: Señales de intención (0-25)
  const intentScore = Math.round(intentSignals.score * 0.25);

  // Sub-score: Engagement (0-20)
  const inboundCount = messages.filter((m) => m.direction === 'inbound').length;
  const totalMessages = messages.length;
  let engagementScore: number;
  if (inboundCount >= 5 && totalMessages >= 10) engagementScore = 20;
  else if (inboundCount >= 3 && totalMessages >= 6) engagementScore = 15;
  else if (inboundCount >= 2) engagementScore = 10;
  else if (inboundCount >= 1) engagementScore = 5;
  else engagementScore = 2;

  const totalScore = valueScore + recencyScore + intentScore + engagementScore;

  // Determinar prioridad
  let priority: RecoverabilityPriority;
  if (totalScore >= 80) priority = 'urgent';
  else if (totalScore >= 60) priority = 'high';
  else if (totalScore >= 35) priority = 'medium';
  else priority = 'low';

  // Factores que contribuyen
  const factors: string[] = [];
  if (valueScore >= 22) factors.push(`Alto valor: $${(opportunityValue / 1000000).toFixed(1)}M`);
  if (recencyScore >= 18) factors.push(`Contacto reciente (${abandonment.daysSinceLastContact}d)`);
  if (intentSignals.purchaseIntent) factors.push(`Señales de compra: ${intentSignals.signals.join(', ')}`);
  if (engagementScore >= 15) factors.push(`Alto engagement (${inboundCount} mensajes inbound)`);
  if (abandonment.direction === 'inbound_sin_respuesta') factors.push('Cliente esperando respuesta ⚠️');

  return {
    totalScore,
    valueScore,
    recencyScore,
    intentScore,
    engagementScore,
    priority,
    factors,
  };
}

// ─── Pipeline de Análisis Completo ─────────────────────────────────────────

export function analyzeConversation(
  conversation: GHLConversationInput,
  opportunity?: GHLOpportunityInput
): ConversationAnalysis {
  const messages = conversation.messages || [];
  const opportunityValue = opportunity?.monetaryValue ?? 0;

  // 1. Detectar intención de compra
  const intentSignals = detectPurchaseIntent(messages);

  // 2. Clasificar etapa
  const ghlStage = opportunity?.pipelineStageName ?? 'desconocido';
  const stageClassification = classifyFunnelStage(messages, ghlStage);

  // 3. Detectar abandono
  const abandonment = detectAbandonment(messages, conversation.lastMessageDate);

  // 4. Diagnosticar razón de pérdida
  const lossReason = diagnoseLossReason(
    messages,
    opportunity?.status ?? 'open',
    abandonment
  );

  // 5. Scoring de recuperabilidad
  const recoverability = scoreRecoverability(
    opportunityValue,
    abandonment,
    intentSignals,
    messages
  );

  // Determinar canal
  const channelMap: Record<string, string> = {
    TYPE_WHATSAPP: 'WhatsApp',
    TYPE_EMAIL: 'Email',
    TYPE_SMS: 'SMS',
    TYPE_FACEBOOK: 'Facebook',
    TYPE_INSTAGRAM: 'Instagram',
    TYPE_CALL: 'Llamada',
  };
  const channel = channelMap[conversation.lastMessageType] ?? 'Desconocido';

  return {
    conversationId: conversation.id,
    contactId: conversation.contactId,
    contactName: conversation.contactName,
    opportunityId: opportunity?.id,
    opportunityValue,
    channel,
    intentSignals,
    stageClassification,
    abandonment,
    lossReason,
    recoverability,
    analyzedAt: new Date().toISOString(),
  };
}

export function generateBatchSummary(
  analyses: ConversationAnalysis[],
  pipelineId: string,
  pipelineName: string
): BatchAnalysisResult {
  const totalValue = analyses.reduce((sum, a) => sum + a.opportunityValue, 0);

  // Agregar razones de pérdida
  const reasonMap = new Map<LossReasonCategory, { count: number; value: number }>();
  for (const a of analyses) {
    const existing = reasonMap.get(a.lossReason.primaryReason) || { count: 0, value: 0 };
    reasonMap.set(a.lossReason.primaryReason, {
      count: existing.count + 1,
      value: existing.value + a.opportunityValue,
    });
  }
  const topLossReasons = Array.from(reasonMap.entries())
    .map(([reason, data]) => ({ reason, ...data }))
    .sort((a, b) => b.value - a.value);

  // Agregar por etapa
  const stageMap = new Map<FunnelStage, { count: number; value: number }>();
  for (const a of analyses) {
    const stage = a.stageClassification.detectedStage;
    const existing = stageMap.get(stage) || { count: 0, value: 0 };
    stageMap.set(stage, {
      count: existing.count + 1,
      value: existing.value + a.opportunityValue,
    });
  }
  const lossByStage = Array.from(stageMap.entries())
    .map(([stage, data]) => ({ stage, ...data }))
    .sort((a, b) => b.value - a.value);

  const highPriority = analyses.filter(
    (a) => a.recoverability.priority === 'high' || a.recoverability.priority === 'urgent'
  );

  return {
    analyzedAt: new Date().toISOString(),
    pipelineId,
    pipelineName,
    totalAnalyzed: analyses.length,
    summary: {
      totalValue,
      recoverableValue: highPriority.reduce((sum, a) => sum + a.opportunityValue, 0),
      highPriorityCount: highPriority.length,
      urgentCount: analyses.filter((a) => a.recoverability.priority === 'urgent').length,
      avgRecoverabilityScore: Math.round(
        analyses.reduce((sum, a) => sum + a.recoverability.totalScore, 0) / (analyses.length || 1)
      ),
      topLossReasons,
      lossByStage,
    },
    conversations: analyses.sort(
      (a, b) => b.recoverability.totalScore - a.recoverability.totalScore
    ),
  };
}

// ─── Utilidades para el scheduler ─────────────────────────────────────────

export function getUrgentConversations(
  analyses: ConversationAnalysis[]
): ConversationAnalysis[] {
  return analyses.filter(
    (a) =>
      a.recoverability.priority === 'urgent' ||
      (a.abandonment.direction === 'inbound_sin_respuesta' &&
        a.abandonment.daysSinceLastContact <= 2)
  );
}

export function getEarlyWarningConversations(
  analyses: ConversationAnalysis[]
): ConversationAnalysis[] {
  const now = Date.now();
  return analyses.filter((a) => {
    const hoursSinceLastInbound = a.abandonment.lastInboundDate
      ? (now - new Date(a.abandonment.lastInboundDate).getTime()) / (1000 * 60 * 60)
      : Infinity;
    return (
      a.abandonment.direction === 'inbound_sin_respuesta' &&
      hoursSinceLastInbound >= URGENT_THRESHOLD_HOURS &&
      hoursSinceLastInbound <= 24
    );
  });
}

/**
 * Estima el costo en tokens de Claude para analizar una conversación.
 *
 * Basado en promedios empíricos:
 * - ~500 tokens input promedio por conversación (mensajes + metadata)
 * - ~300 tokens output promedio (análisis estructurado)
 * - Precio Sonnet 4.6: $3/$15 por MTok input/output
 *
 * Costo por conversación: ~$0.006 USD
 */
export function estimateAnalysisCost(conversationCount: number): {
  totalTokensInput: number;
  totalTokensOutput: number;
  estimatedCostUSD: number;
  estimatedCostCLP: number;
} {
  const avgInputTokensPerConv = 500;
  const avgOutputTokensPerConv = 300;

  const totalTokensInput = conversationCount * avgInputTokensPerConv;
  const totalTokensOutput = conversationCount * avgOutputTokensPerConv;
  const estimatedCostUSD =
    (totalTokensInput / 1_000_000) * 3 + (totalTokensOutput / 1_000_000) * 15;
  const estimatedCostCLP = estimatedCostUSD * 950; // aprox

  return {
    totalTokensInput,
    totalTokensOutput,
    estimatedCostUSD: Math.round(estimatedCostUSD * 1000) / 1000,
    estimatedCostCLP: Math.round(estimatedCostCLP),
  };
}
