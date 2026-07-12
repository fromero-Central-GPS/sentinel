/**
 * Playbook — capa de decisión del agente vendedor (AG-1).
 *
 * Convierte el diagnóstico de Live Opp en UNA acción tipificada por deal
 * (`AgentAction`), portando la "lógica de rondas" del prototipo a etapas
 * canónicas y derivando los intentos de contacto del historial de mensajes
 * (nunca de custom fields). Determinista y puro: el LLM no decide acciones,
 * a lo sumo redactará el mensaje de una acción ya decidida (AG-4).
 *
 * En AG-1 la decisión es solo informativa (digest / Live Opp). En AG-2+ el
 * mismo output alimenta la cola de ejecución (`agent_actions`).
 * Ver docs/agente-vendedor-arquitectura.md §4-§5.
 */

import type { CanonicalMessage, Deal } from './types';
import type { LiveOppAnalysis } from './live-opp-engine';
import type { AgentAction, FunnelStage } from './taxonomy';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface PlaybookDecision {
  action: AgentAction;
  /** Explicación corta y accionable (para digest/UI), español neutro. */
  rationale: string;
  /** Etapa canónica sobre la que se decidió (null si no se pudo mapear). */
  stage: FunnelStage | null;
  /** Intentos de contacto sin respuesta (días con outbound desde el último inbound). */
  attempts: number;
  /** Días desde el último cambio de etapa (o desde la creación si no hay dato). */
  daysInStage: number;
  /** Vencimiento sugerido en días cuando la acción es crear_tarea_vendedor. */
  taskDueInDays?: number;
}

/** Etiqueta corta por acción, para listas y mensajes de WhatsApp. */
export const ACTION_LABELS: Record<AgentAction, string> = {
  contactar_cliente: 'Contactar',
  ultimo_intento: 'Último intento',
  mover_a_frio: 'Mover a Frío',
  crear_tarea_vendedor: 'Crear tarea',
  crear_nota: 'Dejar nota',
  escalar_a_humano: 'Responder ahora',
  no_tocar: 'En gestión',
  monitorear: 'Monitorear',
};

// ─── Etapa canónica desde el nombre de etapa GHL ─────────────────────────────

/**
 * Mapea el nombre de etapa del CRM a la etapa canónica por patrones de nombre.
 * Cubre los nombres habituales en español; cuando un tenant use nombres que no
 * calcen, el override por tenant es la extensión prevista (doc §10).
 */
const STAGE_NAME_PATTERNS: Array<{ stage: FunnelStage; re: RegExp }> = [
  { stage: 'perdido', re: /perdid|lost|descartad/i },
  { stage: 'ganado', re: /ganad|won|cliente activo/i },
  { stage: 'seguimiento', re: /fr[ií]o|dormid|pausa|nurtur|reactivar/i },
  { stage: 'cierre', re: /aceptad|cierre|firmad|firma|contratad|registro/i },
  { stage: 'negociacion', re: /negociaci|propuesta|contrato/i },
  { stage: 'demo_plataforma', re: /demo|prueba|piloto|instalad|plataforma/i },
  { stage: 'cotizacion', re: /calificad|cotiza|presupuesto|qualified/i },
  { stage: 'consulta_inicial', re: /recibid|nuevo|entrante|lead|sin contactar|consulta/i },
];

export function canonicalStageFromName(stageName: string): FunnelStage | null {
  const name = stageName.trim();
  if (!name) return null;
  for (const { stage, re } of STAGE_NAME_PATTERNS) {
    if (re.test(name)) return stage;
  }
  return null;
}

// ─── Intentos derivados del historial ────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Intentos de contacto sin respuesta: días distintos con mensajes outbound
 * posteriores al último inbound del cliente (varios mensajes el mismo día
 * cuentan como un intento). Si el cliente nunca escribió, cuentan todos los
 * días con outbound. Se derivan del historial en cada evaluación — no se
 * persisten, así no se desincronizan (doc §8).
 */
export function countUnansweredAttempts(messages: CanonicalMessage[]): number {
  const real = messages.filter(
    (m) => !m.messageType.startsWith('TYPE_ACTIVITY') && (m.body?.trim().length ?? 0) > 0,
  );
  let lastInbound = 0;
  for (const m of real) {
    if (m.direction !== 'inbound') continue;
    const t = new Date(m.dateAdded).getTime();
    if (t > lastInbound) lastInbound = t;
  }
  const days = new Set<string>();
  for (const m of real) {
    if (m.direction !== 'outbound') continue;
    const t = new Date(m.dateAdded).getTime();
    if (t <= lastInbound) continue;
    days.add(new Date(t).toISOString().slice(0, 10));
  }
  return days.size;
}

// ─── Decisión ────────────────────────────────────────────────────────────────

/** Tag del prototipo que pausa toda automatización sobre el contacto. */
const PAUSE_TAG = 'ai-pausado';

/** Umbrales del playbook (defaults del prototipo; parametrizables por tenant después). */
export interface PlaybookThresholds {
  /** Días sin gestión en cotización antes de crear tarea al vendedor. */
  staleQuoteDays: number;
  /** Días sin gestión en cotización antes de proponer mover a Frío. */
  frozenQuoteDays: number;
  /** Días en demo que separan activación / retención / empuje de cierre. */
  demoActivationDays: number;
  demoRetentionDays: number;
  /** Intentos sin respuesta que gatillan último intento y Frío en consulta inicial. */
  lastAttemptFrom: number;
  moveToColdFrom: number;
}

export function getDefaultPlaybookThresholds(): PlaybookThresholds {
  return {
    staleQuoteDays: 7,
    frozenQuoteDays: 21,
    demoActivationDays: 7,
    demoRetentionDays: 14,
    lastAttemptFrom: 3,
    moveToColdFrom: 6,
  };
}

/**
 * Decide la próxima acción para un deal abierto. Guards de coordinación
 * primero (pausado, cliente esperando, gestión humana activa), después la
 * ronda por etapa canónica + antigüedad + intentos.
 */
export function decidePlaybookAction(
  deal: Deal,
  messages: CanonicalMessage[],
  analysis: LiveOppAnalysis,
  thresholds: PlaybookThresholds = getDefaultPlaybookThresholds(),
): PlaybookDecision {
  const stage = canonicalStageFromName(deal.pipelineStageName);
  const attempts = countUnansweredAttempts(messages);
  const stageSince = deal.lastStageChangeAt ?? deal.createdAt;
  const daysInStage = Math.max(
    0,
    Math.floor((Date.now() - new Date(stageSince).getTime()) / DAY_MS),
  );
  const base = { stage, attempts, daysInStage };

  // ─── Guards de coordinación (doc §3 y §6) ────────────────────────────────
  if (deal.contact.tags?.some((t) => t.toLowerCase() === PAUSE_TAG)) {
    return { ...base, action: 'no_tocar', rationale: 'Pausado por el equipo (ai-pausado).' };
  }

  // Cliente esperando respuesta: eso es del vendedor (o de un playbook de
  // respuesta), nunca del agente de seguimiento.
  if (analysis.alerts.some((a) => a.category === 'no_response')) {
    const h = analysis.hoursSinceLastInbound;
    return {
      ...base,
      action: 'escalar_a_humano',
      rationale: `Cliente esperando respuesta${h != null ? ` hace ${h}h` : ''} — responder antes de cualquier seguimiento.`,
    };
  }

  // Etapas de cierre son territorio humano: solo empujar si se estancan.
  if (stage === 'negociacion' || stage === 'cierre') {
    if (analysis.daysSinceLastContact > thresholds.staleQuoteDays) {
      return {
        ...base,
        action: 'crear_tarea_vendedor',
        taskDueInDays: 3,
        rationale: `${analysis.daysSinceLastContact}d sin actividad en ${deal.pipelineStageName} — retomar el cierre.`,
      };
    }
    return { ...base, action: 'no_tocar', rationale: 'En cierre con gestión activa.' };
  }

  // ─── Rondas por etapa (prototipo → canónico) ─────────────────────────────

  // Ronda 4 — consulta inicial: escalar intentos hasta Frío.
  if (stage === 'consulta_inicial') {
    if (attempts >= thresholds.moveToColdFrom) {
      return {
        ...base,
        action: 'mover_a_frio',
        rationale: `${attempts} intentos sin respuesta — proponer mover a Frío con nota.`,
      };
    }
    if (attempts >= thresholds.lastAttemptFrom) {
      return {
        ...base,
        action: 'ultimo_intento',
        rationale: `${attempts} intentos sin respuesta — último intento cambiando de canal.`,
      };
    }
    return {
      ...base,
      action: 'contactar_cliente',
      rationale:
        analysis.totalMessages === 0
          ? `Lead sin primer contacto (${analysis.daysOpen}d desde creación).`
          : `Seguimiento a lead nuevo (intento ${attempts + 1}).`,
    };
  }

  // Ronda 3 — cotización/calificado: sin gestión → tarea al vendedor; muy
  // frío → proponer Frío; con gestión → no tocar.
  if (stage === 'cotizacion') {
    if (analysis.daysSinceLastContact > thresholds.frozenQuoteDays) {
      return {
        ...base,
        action: 'mover_a_frio',
        rationale: `${analysis.daysSinceLastContact}d sin gestión en ${deal.pipelineStageName} — proponer mover a Frío.`,
      };
    }
    if (analysis.daysSinceLastContact > thresholds.staleQuoteDays) {
      return {
        ...base,
        action: 'crear_tarea_vendedor',
        taskDueInDays: 7,
        rationale: `${analysis.daysSinceLastContact}d sin gestión — tarea al vendedor (vence en 7d).`,
      };
    }
    return { ...base, action: 'no_tocar', rationale: 'Cotización en gestión activa.' };
  }

  // Rondas 1/2 — demo: activación / retención / empujar cierre según edad.
  if (stage === 'demo_plataforma') {
    if (daysInStage > thresholds.demoRetentionDays) {
      return {
        ...base,
        action: 'crear_tarea_vendedor',
        taskDueInDays: 3,
        rationale: `${daysInStage}d en demo — identificar bloqueo y empujar firma.`,
      };
    }
    if (daysInStage > thresholds.demoActivationDays) {
      return {
        ...base,
        action: 'contactar_cliente',
        rationale: `${daysInStage}d en demo — reforzar uso (reportes, alertas, geocercas).`,
      };
    }
    return {
      ...base,
      action: 'contactar_cliente',
      rationale: `Demo reciente (${daysInStage}d) — verificar acceso y resolver dudas.`,
    };
  }

  // Frío: el agente no persigue lo que ya se enfrió a propósito.
  if (stage === 'seguimiento') {
    return { ...base, action: 'monitorear', rationale: 'En Frío — reactivación es de Forense.' };
  }

  return { ...base, action: 'monitorear', rationale: 'Sin regla para esta etapa — monitorear.' };
}
