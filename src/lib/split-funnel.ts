/**
 * Split the Funnel (Fase 4) — la dimensión transversal de Refine Labs.
 *
 * La tesis de "Split the Funnel" (Refine Labs) es que un pipeline mezcla dos
 * poblaciones que NO se pueden medir con la misma vara:
 *   - **Demanda declarada** (alta intención): el lead entró pidiendo comprar —
 *     precio, cotización, demo, contacto directo con ventas. Convierte alto y
 *     rápido; es la demanda que YA existía.
 *   - **Demanda creada** (baja intención): marketing la generó con contenido —
 *     ebook, webinar, feria, ads fríos. El lead dio sus datos por el contenido,
 *     no por comprar. Convierte más bajo y lento, pero alimenta la declarada.
 * Promediar ambas esconde la verdad: una tasa de conversión "global" del 15%
 * puede ser 35% en declarada y 4% en creada. Aquí segmentamos el funnel ya
 * sincronizado por bucket de intención y comparamos conversión, ciclo y ticket.
 *
 * Diseño: 100% cómputo sobre datos ya en BD (`deals`/`deal_messages`), sin
 * llamadas nuevas a GHL ni LLM. El clasificador usa el PRIMER mensaje inbound
 * (lo que el cliente realmente dijo — la señal más fuerte en un CRM
 * conversacional) y cae a `attributions` (UTM) como desempate.
 */

import type { CanonicalMessage, Deal } from './types';
import type { IntentClass } from './taxonomy';

/** Etiqueta legible de cada bucket (misma fuente para servidor y UI). */
export const INTENT_CLASS_LABELS: Record<IntentClass, string> = {
  declarada: 'Demanda declarada',
  creada: 'Demanda creada',
  desconocida: 'Sin clasificar',
};

// ─── Señales léxicas del primer mensaje inbound ───────────────────────────────
//
// Intención ALTA declarada: el cliente entra pidiendo comprar/cotizar/probar.
const DECLARED_MESSAGE_PATTERNS =
  /(?:precio|cu[aá]nto (?:cuesta|sale|vale|es)|cotiza(?:r|ci[oó]n)?|presupuesto|valor(?:es)?|plan(?:es)?|contratar|contrataci[oó]n|comprar|adquirir|quiero (?:el|la|contratar|comprar|adquirir)|me interesa (?:contratar|comprar|el plan|el servicio|adquirir)|demo|demostraci[oó]n|prueba|instalar|instalaci[oó]n|contactar (?:con )?ventas|asesor|vendedor)/i;

// Intención BAJA creada: contenido, evento, descarga, consulta vaga.
const CREATED_MESSAGE_PATTERNS =
  /(?:ebook|e-book|gu[ií]a|descarga(?:r|ble)?|webinar|newsletter|bolet[ií]n|feria|evento|charla|stand|sorteo|promoci[oó]n|concurso|vi (?:su|el|la|tu|un|una)|los vi|encontr[eé]|me lleg[oó]|art[ií]culo|blog|publicaci[oó]n|informaci[oó]n general|m[aá]s informaci[oó]n)/i;

// ─── Señales de atribución (UTM) — desempate secundario ───────────────────────
//
// Fuentes/medios que marcan demanda CREADA por marketing (lead magnets, ads
// de contenido, campañas de captación). Menos confiable que el mensaje porque
// muchas cuentas GHL registran todo como "social media"/"whatsapp".
const CREATED_ATTR_PATTERNS =
  /(?:ebook|webinar|feria|evento|content|contenido|blog|newsletter|display|lead[_-]?ad|leadgen|lead[_-]?form|form(?:ulario)?|download|descarga|paid[_-]?social|facebook|instagram|\big\b|tiktok|meta[_-]?ads)/i;
// Fuentes/medios de alta intención declarada (búsqueda, directo, referido).
const DECLARED_ATTR_PATTERNS =
  /(?:direct|referral|referido|organic[_-]?search|search|cpc|ppc|adwords|google[_-]?ads|sales|ventas|contacto)/i;

export interface IntentClassification {
  intent: IntentClass;
  /** De dónde salió la decisión (para transparencia en la UI). */
  signal: 'message' | 'attribution' | 'none';
  /** Explicación corta y legible. */
  reason: string;
}

/** Primer mensaje inbound "real" (sin actividades del sistema ni cuerpos vacíos). */
function firstInboundMessage(messages: CanonicalMessage[]): CanonicalMessage | null {
  const real = messages
    .filter(
      (m) =>
        m.direction === 'inbound' &&
        !m.messageType?.startsWith('TYPE_ACTIVITY') &&
        (m.body?.trim().length ?? 0) > 0 &&
        Number.isFinite(new Date(m.dateAdded).getTime()),
    )
    .sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());
  return real[0] ?? null;
}

/** Fuente de atribución de entrada (utmSessionSource preferido, si no el medium). */
function entryAttributionSource(deal: Deal): string {
  const attrs = deal.attributions ?? [];
  const first = attrs.find((a) => a.isFirst) ?? attrs[0];
  if (!first) return '';
  return `${first.utmSessionSource ?? ''} ${first.medium ?? ''}`.trim();
}

/**
 * Clasifica un deal en su bucket de intención de entrada.
 *
 * Prioridad: el PRIMER mensaje inbound (lo que el cliente dijo) manda; solo si
 * no hay señal léxica clara se recurre a la atribución UTM. Sin ninguna señal
 * → `desconocida` (honesto: no inventamos un bucket).
 */
export function classifyIntent(deal: Deal, messages: CanonicalMessage[]): IntentClassification {
  const firstMsg = firstInboundMessage(messages);
  if (firstMsg) {
    const body = firstMsg.body;
    // El mensaje puede tener ambas señales; declarada gana (pedir precio dentro
    // de "vi su ebook, ¿cuánto cuesta?" es intención de compra).
    if (DECLARED_MESSAGE_PATTERNS.test(body)) {
      return {
        intent: 'declarada',
        signal: 'message',
        reason: 'El cliente pidió precio/cotización/demo en su primer mensaje',
      };
    }
    if (CREATED_MESSAGE_PATTERNS.test(body)) {
      return {
        intent: 'creada',
        signal: 'message',
        reason: 'El primer mensaje viene de contenido/evento (baja intención)',
      };
    }
  }

  // Sin señal léxica: desempate por atribución de entrada.
  const source = entryAttributionSource(deal);
  if (source) {
    const lower = source.toLowerCase();
    // Declarada primero: búsqueda/directo/referido pesan más que un genérico "social".
    if (DECLARED_ATTR_PATTERNS.test(lower)) {
      return {
        intent: 'declarada',
        signal: 'attribution',
        reason: `Entró por canal de alta intención (${source})`,
      };
    }
    if (CREATED_ATTR_PATTERNS.test(lower)) {
      return {
        intent: 'creada',
        signal: 'attribution',
        reason: `Entró por campaña de captación (${source})`,
      };
    }
  }

  return {
    intent: 'desconocida',
    signal: 'none',
    reason: 'Sin señal de intención en el mensaje ni en la atribución',
  };
}

// ─── Motor de cohortes ────────────────────────────────────────────────────────

/** Días desde creación hasta el último cambio de etapa (cierre real, como Won Track). */
function timeToCloseDays(deal: Deal): number {
  const closed = new Date(deal.lastStageChangeAt ?? deal.updatedAt).getTime();
  const created = new Date(deal.createdAt).getTime();
  if (!Number.isFinite(closed) || !Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((closed - created) / (1000 * 60 * 60 * 24)));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export interface ClassifiedDeal {
  deal: Deal;
  intent: IntentClass;
}

export interface BucketMetrics {
  bucket: IntentClass;
  label: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  /** won / (won + lost) — sobre deals ya decididos. 0 si no hay decididos. */
  conversionRate: number;
  /** Ciclo de venta (días) promedio y mediano entre los ganados de la cohorte. */
  avgCycleDays: number;
  medianCycleDays: number;
  /** Ticket promedio de los ganados (CLP). */
  avgTicket: number;
  /** Revenue neto-nuevo de la cohorte (suma de ganados). */
  wonValue: number;
  /** Pipeline abierto de la cohorte (suma de abiertos). */
  openValue: number;
}

export interface SplitFunnelInsight {
  /** Cuántas veces mejor convierte declarada que creada (si ambas existen). */
  conversionRatio: number | null;
  /** Cuántos días más lento cierra la creada vs la declarada (si ambas existen). */
  cycleGapDays: number | null;
  message: string;
}

export interface SplitFunnelResult {
  /** Buckets con al menos un deal, ordenados declarada → creada → desconocida. */
  buckets: BucketMetrics[];
  totalDeals: number;
  /** % de deals con bucket asignado (no `desconocida`). */
  classifiedPct: number;
  insight: SplitFunnelInsight;
}

/** Orden estable de presentación de los buckets. */
const BUCKET_ORDER: IntentClass[] = ['declarada', 'creada', 'desconocida'];

function metricsFor(bucket: IntentClass, group: Deal[]): BucketMetrics {
  const won = group.filter((d) => d.status === 'won');
  const lost = group.filter((d) => d.status === 'lost');
  const open = group.filter((d) => d.status === 'open');
  const decided = won.length + lost.length;

  const wonCycles = won.map(timeToCloseDays);
  const avgCycleDays =
    wonCycles.length > 0 ? Math.round(wonCycles.reduce((s, v) => s + v, 0) / wonCycles.length) : 0;
  const wonValue = won.reduce((s, d) => s + (d.monetaryValue ?? 0), 0);
  const openValue = open.reduce((s, d) => s + (d.monetaryValue ?? 0), 0);

  return {
    bucket,
    label: INTENT_CLASS_LABELS[bucket],
    total: group.length,
    won: won.length,
    lost: lost.length,
    open: open.length,
    conversionRate: decided > 0 ? won.length / decided : 0,
    avgCycleDays,
    medianCycleDays: Math.round(median(wonCycles)),
    avgTicket: won.length > 0 ? Math.round(wonValue / won.length) : 0,
    wonValue,
    openValue,
  };
}

function buildInsight(buckets: BucketMetrics[]): SplitFunnelInsight {
  const declarada = buckets.find((b) => b.bucket === 'declarada');
  const creada = buckets.find((b) => b.bucket === 'creada');

  if (!declarada || !creada) {
    return {
      conversionRatio: null,
      cycleGapDays: null,
      message:
        'Aún no hay ambas cohortes con datos suficientes para comparar. Sincroniza más funnel o etiqueta la fuente de los leads.',
    };
  }

  const conversionRatio =
    creada.conversionRate > 0
      ? Math.round((declarada.conversionRate / creada.conversionRate) * 10) / 10
      : null;
  const cycleGapDays = creada.avgCycleDays - declarada.avgCycleDays;

  const parts: string[] = [];
  if (conversionRatio && conversionRatio !== 1) {
    parts.push(
      conversionRatio > 1
        ? `La demanda declarada convierte ${conversionRatio}× mejor que la creada`
        : `La demanda creada convierte ${Math.round((1 / conversionRatio) * 10) / 10}× mejor que la declarada`,
    );
  } else {
    parts.push('Ambas cohortes convierten a tasas similares');
  }
  if (Math.abs(cycleGapDays) >= 2) {
    parts.push(
      cycleGapDays > 0
        ? `y cierra ${cycleGapDays}d más lento`
        : `pero cierra ${Math.abs(cycleGapDays)}d más rápido`,
    );
  }

  return { conversionRatio, cycleGapDays, message: `${parts.join(' ')}.` };
}

/**
 * Agrupa los deals clasificados por bucket de intención y calcula las métricas
 * comparativas de cada cohorte. Solo devuelve buckets con ≥1 deal.
 */
export function computeSplitFunnel(classified: ClassifiedDeal[]): SplitFunnelResult {
  const groups = new Map<IntentClass, Deal[]>();
  for (const { deal, intent } of classified) {
    const list = groups.get(intent) ?? [];
    list.push(deal);
    groups.set(intent, list);
  }

  const buckets = BUCKET_ORDER.filter((b) => (groups.get(b)?.length ?? 0) > 0).map((b) =>
    metricsFor(b, groups.get(b)!),
  );

  const totalDeals = classified.length;
  const classifiedCount = classified.filter((c) => c.intent !== 'desconocida').length;

  return {
    buckets,
    totalDeals,
    classifiedPct: totalDeals > 0 ? Math.round((classifiedCount / totalDeals) * 100) : 0,
    insight: buildInsight(buckets),
  };
}
