/**
 * Live Opp — Motor de prevención de pérdidas en oportunidades abiertas
 *
 * Detecta riesgo de abandono en oportunidades abiertas usando:
 *   1. Early Warning (regex) — alertas inmediatas sin costo Claude
 *   2. Predictive Risk Scoring — umbrales de Won Track aplicados a datos reales
 *   3. Actionable Recommendations — qué hacer para prevenir la pérdida
 *
 * Input: SuccessThresholds de Won Track + datos de oportunidades abiertas
 * Output: Risk scores, alertas priorizadas, y acciones recomendadas
 */

import type { SuccessThresholds } from "./won-track-engine";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface GHLMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  dateAdded: string;
  messageType: string;
  status?: string;
  attachments?: Array<{ url: string }>;
}

export interface OpenOpportunity {
  id: string;
  name: string;
  monetaryValue: number;
  pipelineName: string;
  pipelineStageName: string;
  status: "open";
  createdAt: string;
  updatedAt: string;
  contactId: string;
  /** ID del usuario GHL asignado (vendedor responsable) — CEN-1000 */
  assignedTo?: string;
  contact: {
    id: string;
    name: string;
    companyName?: string | null;
    email?: string;
    phone?: string;
    tags?: string[];
  };
  customFields?: Array<{
    id: string;
    fieldValueString?: string;
    fieldValueNumber?: number;
    type: string;
  }>;
}

export type RiskSeverity = "critical" | "high" | "medium" | "low" | "none";
export type RiskCategory =
  | "no_response"        // client waiting for response
  | "stalling"           // no activity for too long
  | "low_engagement"     // client not engaging enough
  | "slow_response"      // team responding too slowly
  | "deal_decay"         // deal open longer than benchmark
  | "competitor_risk";   // client mentioned competitor

export interface RiskAlert {
  category: RiskCategory;
  severity: RiskSeverity;
  title: string;
  detail: string;
  metric: string;         // e.g. "response_time", "days_since_contact"
  currentValue: number;
  threshold: number;
  direction: "above" | "below"; // is the current value above or below threshold?
}

export interface LiveOppAnalysis {
  opportunityId: string;
  contactName: string;
  value: number;
  stage: string;
  pipeline: string;
  /** ID del usuario GHL asignado (vendedor responsable) — CEN-1000 */
  assignedTo?: string;

  // Risk scoring
  overallRiskScore: number;    // 0-100, higher = more at risk
  riskLevel: RiskSeverity;
  alerts: RiskAlert[];

  // Engagement metrics
  messagesInLast7Days: number;
  daysSinceLastContact: number;
  hoursSinceLastInbound: number | null;
  avgResponseMinutes: number;
  inboundRatio: number;
  totalMessages: number;

  // Deal health
  daysOpen: number;
  isPastBenchmark: boolean;     // has been open longer than Won Track avg
  intentSignals: string[];

  // Recommendations
  recommendedActions: string[];
  urgency: "ahora" | "hoy" | "esta_semana" | "monitorear";
}

export interface LiveOppOutput {
  analyzedAt: string;
  totalAnalyzed: number;
  totalValueAtRisk: number;
  criticalCount: number;
  highCount: number;
  opportunities: LiveOppAnalysis[];
  thresholds: SuccessThresholds;
}

// ─── Early Warning Patterns ─────────────────────────────────────────────────

const INTENT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /(?:cotizaci[oó]n|cotizar|cu[áa]nto (?:cuesta|vale|sale)|precio|valor)/i, label: "consulta_precio" },
  { re: /(?:me interesa|estoy interesad[oa]|quiero comprar|quiero contratar)/i, label: "interes_directo" },
  { re: /(?:demo|probar|plataforma|c[oó]mo funciona)/i, label: "solicitud_demo" },
  { re: /(?:urgente|lo antes posible|necesito|necesitamos)/i, label: "urgencia" },
  { re: /(?:instalaci[oó]n|instalar|cu[áa]ndo pueden)/i, label: "consulta_instalacion" },
  { re: /(?:gps|rastreo|monitoreo|tracking)/i, label: "mencion_gps" },
  { re: /(?:competencia|otra empresa|m[áa]s barato|wialon|satelital)/i, label: "mencion_competidor" },
  { re: /(?:confirmo|confirmar|avanzar|proceder|seguir adelante)/i, label: "confirmacion" },
];

const COMPETITOR_PATTERNS = /(?:competencia|otra empresa|m[áa]s barato|wialon|satelital|gurtam|otro proveedor|encontr[eé] (?:algo|uno) m[áa]s)/i;

// ─── Risk Scoring Engine ───────────────────────────────────────────────────

function severityOrder(s: RiskSeverity): number {
  return { critical: 0, high: 1, medium: 2, low: 3, none: 4 }[s];
}

function urgencyFromScore(score: number): LiveOppAnalysis["urgency"] {
  if (score >= 80) return "ahora";
  if (score >= 50) return "hoy";
  if (score >= 25) return "esta_semana";
  return "monitorear";
}

function riskLevelFromScore(score: number): RiskSeverity {
  if (score >= 80) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  if (score > 0) return "low";
  return "none";
}

export function analyzeLiveOpportunity(
  opp: OpenOpportunity,
  messages: GHLMessage[],
  thresholds: SuccessThresholds
): LiveOppAnalysis {
  const now = Date.now();
  const sorted = [...messages].sort(
    (a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()
  );

  // Filter real messages (exclude system activity messages)
  const realMessages = sorted.filter((m) =>
    !m.messageType.startsWith("TYPE_ACTIVITY") && (m.body?.trim().length ?? 0) > 0
  );
  const inbound = realMessages.filter((m) => m.direction === "inbound");
  const outbound = realMessages.filter((m) => m.direction === "outbound");

  // Find last activity timestamps
  let lastInbound: Date | null = null;
  let lastOutbound: Date | null = null;
  let lastAny: Date | null = null;

  for (const msg of sorted) {
    const d = new Date(msg.dateAdded);
    if (!lastAny || d > lastAny) lastAny = d;
    if (msg.direction === "inbound" && (!lastInbound || d > lastInbound)) lastInbound = d;
    if (msg.direction === "outbound" && (!lastOutbound || d > lastOutbound)) lastOutbound = d;
  }

  const daysSinceLastContact = lastAny
    ? Math.floor((now - lastAny.getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  const hoursSinceLastInbound = lastInbound
    ? (now - lastInbound.getTime()) / (1000 * 60 * 60)
    : null;

  const daysOpen = Math.floor(
    (now - new Date(opp.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Messages in last 7 days
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const messagesInLast7Days = realMessages.filter(
    (m) => new Date(m.dateAdded).getTime() >= sevenDaysAgo
  ).length;

  // Response time calculation
  const responseTimes: number[] = [];
  for (const msg of realMessages) {
    if (msg.direction === "outbound") continue;
    const inboundTime = new Date(msg.dateAdded).getTime();
    const nextOutbound = realMessages.find(
      (m) => m.direction === "outbound" && new Date(m.dateAdded).getTime() > inboundTime
    );
    if (nextOutbound) {
      responseTimes.push((new Date(nextOutbound.dateAdded).getTime() - inboundTime) / (1000 * 60));
    }
  }
  const avgResponseMinutes = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length)
    : 0;

  // Inbound ratio
  const totalMessages = realMessages.length;
  const inboundRatio = totalMessages > 0 ? inbound.length / totalMessages : 0;

  // Intent signals
  const allText = realMessages.map((m) => m.body).join(" ");
  const intentSignals = INTENT_PATTERNS
    .filter(({ re }) => re.test(allText))
    .map(({ label }) => label);

  // ─── Risk Alerts ──────────────────────────────────────────────────────

  const alerts: RiskAlert[] = [];
  let riskScore = 0;

  // 1. Client waiting for response (CRITICAL)
  if (lastInbound && hoursSinceLastInbound !== null) {
    if (lastOutbound && lastInbound > lastOutbound) {
      // Client sent last message, no response yet
      if (hoursSinceLastInbound >= 1) {
        const sev: RiskSeverity = hoursSinceLastInbound >= 4 ? "critical" : "high";
        alerts.push({
          category: "no_response",
          severity: sev,
          title: "Cliente esperando respuesta",
          detail: `Último mensaje inbound hace ${Math.round(hoursSinceLastInbound)}h sin respuesta`,
          metric: "hours_since_last_inbound",
          currentValue: Math.round(hoursSinceLastInbound),
          threshold: 1,
          direction: "above",
        });
        riskScore += hoursSinceLastInbound >= 4 ? 40 : 25;
      }
    }
  }

  // 2. Response time too slow vs Won Track benchmark
  if (thresholds.dangerResponseThreshold > 0 && avgResponseMinutes > thresholds.dangerResponseThreshold) {
    alerts.push({
      category: "slow_response",
      severity: "high",
      title: "Tiempo de respuesta excede benchmark",
      detail: `Respuesta promedio ${avgResponseMinutes}min vs ideal ≤${thresholds.idealResponseThreshold}min (benchmark Won Track: ≤${thresholds.avgResponseMinutes}min)`,
      metric: "avg_response_minutes",
      currentValue: avgResponseMinutes,
      threshold: thresholds.dangerResponseThreshold,
      direction: "above",
    });
    riskScore += 20;
  } else if (thresholds.dangerResponseThreshold > 0 && avgResponseMinutes > thresholds.idealResponseThreshold) {
    alerts.push({
      category: "slow_response",
      severity: "medium",
      title: "Tiempo de respuesta sobre ideal",
      detail: `Respuesta promedio ${avgResponseMinutes}min vs ideal ≤${thresholds.idealResponseThreshold}min`,
      metric: "avg_response_minutes",
      currentValue: avgResponseMinutes,
      threshold: thresholds.idealResponseThreshold,
      direction: "above",
    });
    riskScore += 10;
  }

  // 3. No contact for too long
  if (daysSinceLastContact >= 14) {
    alerts.push({
      category: "stalling",
      severity: "critical",
      title: "Oportunidad abandonada",
      detail: `${daysSinceLastContact} días sin contacto con el cliente`,
      metric: "days_since_last_contact",
      currentValue: daysSinceLastContact,
      threshold: 14,
      direction: "above",
    });
    riskScore += 35;
  } else if (daysSinceLastContact >= 7) {
    alerts.push({
      category: "stalling",
      severity: "high",
      title: "Sin contacto reciente",
      detail: `${daysSinceLastContact} días sin actividad`,
      metric: "days_since_last_contact",
      currentValue: daysSinceLastContact,
      threshold: 7,
      direction: "above",
    });
    riskScore += 20;
  } else if (daysSinceLastContact >= 3) {
    alerts.push({
      category: "stalling",
      severity: "medium",
      title: "Contacto en riesgo",
      detail: `${daysSinceLastContact} días sin actividad — seguimiento recomendado`,
      metric: "days_since_last_contact",
      currentValue: daysSinceLastContact,
      threshold: 3,
      direction: "above",
    });
    riskScore += 10;
  }

  // 4. Low engagement vs Won Track benchmark
  if (thresholds.lowEngagementThreshold > 0 && inboundRatio < thresholds.lowEngagementThreshold && totalMessages >= 5) {
    alerts.push({
      category: "low_engagement",
      severity: "medium",
      title: "Engagement bajo vs benchmark",
      detail: `Ratio inbound ${Math.round(inboundRatio * 100)}% — benchmark Won Track: ${Math.round(thresholds.avgInboundRatio * 100)}%`,
      metric: "inbound_ratio",
      currentValue: Math.round(inboundRatio * 100),
      threshold: Math.round(thresholds.lowEngagementThreshold * 100),
      direction: "below",
    });
    riskScore += 15;
  }

  // 5. Deal open longer than Won Track benchmark
  if (thresholds.avgTimeToClose > 0 && daysOpen > thresholds.avgTimeToClose * 2) {
    alerts.push({
      category: "deal_decay",
      severity: "high",
      title: "Deal abierto más del doble del benchmark",
      detail: `${daysOpen}d abierto vs ${thresholds.avgTimeToClose}d promedio de cierre en Won Track`,
      metric: "days_open",
      currentValue: daysOpen,
      threshold: thresholds.avgTimeToClose * 2,
      direction: "above",
    });
    riskScore += 25;
  } else if (thresholds.avgTimeToClose > 0 && daysOpen > thresholds.avgTimeToClose) {
    alerts.push({
      category: "deal_decay",
      severity: "medium",
      title: "Deal excede tiempo promedio de cierre",
      detail: `${daysOpen}d abierto vs ${thresholds.avgTimeToClose}d promedio Won Track`,
      metric: "days_open",
      currentValue: daysOpen,
      threshold: thresholds.avgTimeToClose,
      direction: "above",
    });
    riskScore += 10;
  }

  // 6. Competitor risk
  if (COMPETITOR_PATTERNS.test(allText)) {
    alerts.push({
      category: "competitor_risk",
      severity: "high",
      title: "Cliente mencionó competencia",
      detail: "El cliente comparó con otro proveedor en la conversación",
      metric: "competitor_mention",
      currentValue: 1,
      threshold: 0,
      direction: "above",
    });
    riskScore += 20;
  }

  // 7. No messages at all (new lead, no conversation)
  if (totalMessages === 0 && daysOpen >= 3) {
    alerts.push({
      category: "stalling",
      severity: "medium",
      title: "Lead sin contacto inicial",
      detail: `${daysOpen}d desde creación sin mensajes`,
      metric: "days_open",
      currentValue: daysOpen,
      threshold: 3,
      direction: "above",
    });
    riskScore += 15;
  }

  // ─── Recommendations ──────────────────────────────────────────────────

  const recommendations: string[] = [];

  // Sort alerts by severity
  alerts.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));

  const hasCritical = alerts.some((a) => a.severity === "critical");
  const hasNoResponse = alerts.some((a) => a.category === "no_response");
  const hasStalling = alerts.some((a) => a.category === "stalling");
  const hasSlowResponse = alerts.some((a) => a.category === "slow_response");
  const hasDealDecay = alerts.some((a) => a.category === "deal_decay");
  const hasLowEngagement = alerts.some((a) => a.category === "low_engagement");

  if (hasNoResponse) {
    recommendations.push(
      `🚨 RESPONDER AHORA: Cliente esperando. Usar WhatsApp (canal preferido en ${Math.round((thresholds.channelWinRates["whatsapp"] ?? 0) / Math.max(1, thresholds.sampleSize) * 100)}% de cierres)`
    );
  }
  if (hasStalling && daysSinceLastContact >= 7) {
    recommendations.push(
      "📞 Llamada de seguimiento: Si no hay respuesta en WhatsApp en 24h, llamar directamente. Deals con seguimiento multi-canal cierran más rápido."
    );
  }
  if (hasSlowResponse) {
    recommendations.push(
      `⏱️ Mejorar tiempo de respuesta: Equipo responde en ${avgResponseMinutes}min. Benchmark ganador: ≤${thresholds.idealResponseThreshold}min. Cada hora de demora reduce probabilidad de cierre.`
    );
  }
  if (hasDealDecay) {
    recommendations.push(
      `📊 Deal envejeciendo: ${daysOpen}d abierto vs ${thresholds.avgTimeToClose}d benchmark. Evaluar descuento por tiempo o incentivo de cierre rápido.`
    );
  }
  if (hasLowEngagement) {
    recommendations.push(
      `💬 Reactivar engagement: Enviar contenido de valor (caso de éxito, demo, feature nueva). Benchmark: ${Math.round(thresholds.avgInboundRatio * 100)}% inbound en deals ganados.`
    );
  }
  if (intentSignals.includes("consulta_precio") && !hasNoResponse) {
    recommendations.push(
      `💰 Cliente consultó precio — enviar cotización con opciones (plan más vendido: ${thresholds.topPlan}). Adjuntar caso de éxito relevante.`
    );
  }
  if (intentSignals.includes("mencion_competidor")) {
    recommendations.push(
      "⚔️ Cliente comparando — enviar comparativa de ventajas diferenciales. Enfocar en soporte local, integración SimpleRoute, y tiempo de respuesta."
    );
  }
  if (hasCritical && opp.monetaryValue > 500000) {
    recommendations.push(
      `🔴 DEAL CRÍTICO: $${(opp.monetaryValue / 1000000).toFixed(1)}M en riesgo. Escalar a gerencia para contacto prioritario.`
    );
  }
  if (totalMessages === 0) {
    recommendations.push(
      "📭 Sin historial de conversación — verificar si el contacto tiene WhatsApp/Email registrado y hacer primer contacto."
    );
  }

  // Default: monitor
  if (recommendations.length === 0) {
    recommendations.push("✅ Sin alertas detectadas. Monitorear próximos 7 días.");
  }

  // Cap risk score at 100
  const cappedScore = Math.min(100, riskScore);

  return {
    opportunityId: opp.id,
    contactName: opp.contact.name,
    value: opp.monetaryValue,
    stage: opp.pipelineStageName,
    pipeline: opp.pipelineName,
    assignedTo: opp.assignedTo,
    overallRiskScore: cappedScore,
    riskLevel: riskLevelFromScore(cappedScore),
    alerts,
    messagesInLast7Days,
    daysSinceLastContact,
    hoursSinceLastInbound: hoursSinceLastInbound !== null ? Math.round(hoursSinceLastInbound) : null,
    avgResponseMinutes,
    inboundRatio,
    totalMessages,
    daysOpen,
    isPastBenchmark: thresholds.avgTimeToClose > 0 && daysOpen > thresholds.avgTimeToClose,
    intentSignals,
    recommendedActions: recommendations,
    urgency: urgencyFromScore(cappedScore),
  };
}

// ─── Batch Analysis ─────────────────────────────────────────────────────────

export function analyzeLiveOpportunities(
  opportunities: Array<{ opp: OpenOpportunity; messages: GHLMessage[] }>,
  thresholds: SuccessThresholds
): LiveOppOutput {
  const analyses = opportunities.map(({ opp, messages }) =>
    analyzeLiveOpportunity(opp, messages, thresholds)
  );

  // Sort by risk score desc
  analyses.sort((a, b) => b.overallRiskScore - a.overallRiskScore);

  const totalValueAtRisk = analyses
    .filter((a) => a.riskLevel === "critical" || a.riskLevel === "high")
    .reduce((sum, a) => sum + a.value, 0);

  return {
    analyzedAt: new Date().toISOString(),
    totalAnalyzed: analyses.length,
    totalValueAtRisk,
    criticalCount: analyses.filter((a) => a.riskLevel === "critical").length,
    highCount: analyses.filter((a) => a.riskLevel === "high").length,
    opportunities: analyses,
    thresholds,
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function severityEmoji(s: RiskSeverity): string {
  return { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢", none: "⚪" }[s];
}

function urgencyLabel(u: LiveOppAnalysis["urgency"]): string {
  return { ahora: "🚨 AHORA", hoy: "📞 HOY", esta_semana: "📅 Esta semana", monitorear: "👀 Monitorear" }[u];
}

export function formatLiveOppMarkdown(output: LiveOppOutput): string {
  const fmt = (n: number) => n.toLocaleString("es-CL", { maximumFractionDigits: 0 });
  const { thresholds } = output;

  const lines: string[] = [
    `# 🔴 Live Opp — Prevención de Pérdidas`,
    "",
    `> ${output.totalAnalyzed} oportunidades abiertas analizadas. **$${fmt(output.totalValueAtRisk)} CLP** en riesgo alto/crítico.`,
    "",
    `## 📊 Dashboard`,
    "",
    `| Métrica | Valor |`,
    `|---|---|`,
    `| 🔴 Críticas | ${output.criticalCount} |`,
    `| 🟠 Alto riesgo | ${output.highCount} |`,
    `| Total analizadas | ${output.totalAnalyzed} |`,
    `| Valor en riesgo | $${fmt(output.totalValueAtRisk)} CLP |`,
    "",
    `## ⚙️ Umbrales aplicados (desde Won Track)`,
    "",
    `| Umbral | Valor | Fuente |`,
    `|---|---|---|`,
    `| Tiempo respuesta ideal | ≤${thresholds.idealResponseThreshold}min | Won Track (${thresholds.sampleSize} deals) |`,
    `| Tiempo respuesta peligro | >${thresholds.dangerResponseThreshold}min | 2x promedio Won Track |`,
    `| Engagement mínimo | ${Math.round(thresholds.lowEngagementThreshold * 100)}% inbound | Won Track - 20% |`,
    `| Benchmark cierre | ${thresholds.avgTimeToClose}d | Promedio Won Track |`,
    `| Canal más efectivo | ${thresholds.topChannel} | ${thresholds.channelWinRates[thresholds.topChannel] ?? 0} deals ganados |`,
    "",
    `## 🚨 Oportunidades en Riesgo`,
    "",
  ];

  const atRisk = output.opportunities.filter((a) => a.riskLevel !== "none");
  if (atRisk.length === 0) {
    lines.push("✅ Ninguna oportunidad abierta muestra señales de riesgo.");
  } else {
    lines.push(`| # | Contacto | Valor | Riesgo | Score | Alertas | Acción |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    atRisk.slice(0, 20).forEach((a, i) => {
      const alertSummary = a.alerts.slice(0, 2).map((al) => `${severityEmoji(al.severity)} ${al.title}`).join("<br>");
      const action = a.recommendedActions[0]?.slice(0, 60) ?? "—";
      lines.push(
        `| ${i + 1} | **${a.contactName}** | $${fmt(a.value)} | ${severityEmoji(a.riskLevel)} ${a.riskLevel} | ${a.overallRiskScore} | ${alertSummary} | ${action} |`
      );
    });
  }

  lines.push("");
  lines.push("---");
  lines.push(`*Live Opp generado el ${new Date().toISOString()} — aplicando umbrales de Won Track (${thresholds.sampleSize} deals)*`);

  return lines.join("\n");
}
