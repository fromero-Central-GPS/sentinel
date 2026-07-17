/**
 * Taxonomía canónica de TAGS de contacto (nombres planos, sin prefijo).
 *
 * La pertenencia a cada dimensión vive AQUÍ, no en el nombre del tag (decisión
 * de Francisco, 2026-07-17: nombres planos, reusando los que ya existen en GHL).
 * Ver docs/tags-normalizacion-propuesta.md.
 *
 * Dimensiones:
 *  - CICLO (exclusiva: exactamente 1): qué ES el contacto.
 *  - CONV (1 principal, reevaluable): de qué trata la conversación AHORA.
 *  - El resto de tags (industria, producto, flota, operación) se conservan.
 */

// ─── Dimensión A: ciclo de vida (exclusiva) ────────────────────────────────

export const CICLO_TAGS = [
  'cliente activo',
  'cliente inactivo',
  'ex-cliente',
  'prospecto',
  'lead',
  'perdido',
  'descartado',
] as const;
export type CicloTag = (typeof CICLO_TAGS)[number];

/** Precedencia para resolver conflictos (índice menor = gana). */
const CICLO_PRECEDENCE: CicloTag[] = [
  'cliente activo',
  'cliente inactivo',
  'ex-cliente',
  'prospecto',
  'lead',
  'perdido',
  'descartado',
];

// ─── Dimensión B: tipo de conversación (tenor) ─────────────────────────────

export const CONV_TIPOS = [
  'intencion-compra',
  'soporte',
  'postventa',
  'churn',
  'interno',
  'frio',
  'spam',
] as const;
export type ConvTipo = (typeof CONV_TIPOS)[number];

/** Tipos que solo un CLIENTE puede tener (soporte/postventa/churn ⇒ es cliente). */
const CONV_IMPLICA_CLIENTE: ConvTipo[] = ['soporte', 'postventa', 'churn'];

// ─── Mapa de absorción: tag viejo → canónico ───────────────────────────────
// Solo ciclo/conv + typos evidentes. Las facetas (industria/flota/producto) se
// migran en lote aparte; el motor no las toca.

const TAG_ALIASES: Record<string, string> = {
  // → lead
  nuevo: 'lead',
  'fb lead': 'lead',
  'lead-correo': 'lead',
  // → prospecto
  calificado: 'prospecto',
  'lead-cotizacion': 'prospecto',
  // → cliente activo
  cliente: 'cliente activo',
  customer: 'cliente activo',
  'cliente nuevo': 'cliente activo',
  renovado: 'cliente activo',
  // → perdido
  'no cliente': 'perdido',
  // → churn (tipo de conversación)
  'churn-risk': 'churn',
  // typos de facetas (dedupe barato, no cambia dimensión)
  contruccion: 'construccion',
  intefraciones: 'integracion',
};

/** Normaliza un tag: minúsculas, trim, alias. */
export function canonicalTag(raw: string): string {
  const t = raw.trim().toLowerCase();
  return TAG_ALIASES[t] ?? t;
}

// ─── Reconciliación ────────────────────────────────────────────────────────

export interface TenorAssessment {
  /** Tipo de conversación determinado por el LLM (tenor real). */
  tipo: ConvTipo;
  /** ¿La evidencia indica que YA es cliente (equipo instalado, servicio activo)? */
  esCliente: boolean;
  /** 0..1 */
  confianza: number;
}

export interface TagReconciliation {
  add: string[];
  remove: string[];
  /** Ciclo final del contacto tras aplicar las reglas. */
  ciclo: CicloTag | null;
  motivo: string;
}

/**
 * Reglas de reconciliación (§4 de la propuesta). Dado los tags actuales del
 * contacto y el tenor de la conversación, calcula qué tags agregar/quitar:
 *
 *  1. soporte/postventa/churn ⇒ ES cliente ⇒ fuera `lead`/`prospecto`/`perdido`.
 *  2. churn ⇒ `cliente inactivo` (deja de ser `cliente activo`).
 *  3. intencion-compra + NO cliente ⇒ `prospecto` (o conserva `lead`).
 *  4. interno ⇒ sin ciclo de venta (fuera del Radar).
 *  5. spam ⇒ `descartado`.
 *  6. Exclusividad: a lo más 1 tag de ciclo (gana la precedencia).
 */
export function reconcileTags(
  currentTags: string[],
  assessment: TenorAssessment,
): TagReconciliation {
  const canonical = currentTags.map(canonicalTag);
  const currentCiclos = CICLO_PRECEDENCE.filter((c) => canonical.includes(c));
  const esCliente =
    assessment.esCliente || CONV_IMPLICA_CLIENTE.includes(assessment.tipo);

  // Ciclo objetivo según el tenor.
  let target: CicloTag | null;
  const reasons: string[] = [];
  switch (assessment.tipo) {
    case 'soporte':
    case 'postventa':
      target = currentCiclos.includes('cliente inactivo') ? 'cliente inactivo' : 'cliente activo';
      reasons.push(`conversación de ${assessment.tipo} ⇒ es cliente`);
      break;
    case 'churn':
      target = 'cliente inactivo';
      reasons.push('quiere retirar/anular el servicio ⇒ cliente inactivo');
      break;
    case 'intencion-compra':
      if (esCliente) {
        // Cliente que quiere comprar más: conserva su ciclo de cliente.
        target = currentCiclos.find((c) => c.startsWith('cliente')) ?? 'cliente activo';
        reasons.push('intención de compra de un cliente (upsell)');
      } else {
        target = currentCiclos.includes('lead') && !canonical.includes('prospecto') ? 'lead' : 'prospecto';
        reasons.push('intención de compra activa ⇒ prospecto');
      }
      break;
    case 'interno':
      target = null;
      reasons.push('contacto interno: sin ciclo de venta');
      break;
    case 'spam':
      target = 'descartado';
      reasons.push('spam / no es conversación real');
      break;
    case 'frio':
    default:
      // Sin señal nueva: solo dedupe/exclusividad sobre lo existente.
      target = currentCiclos[0] ?? null;
      if (esCliente && (!target || target === 'prospecto' || target === 'lead' || target === 'perdido')) {
        target = 'cliente activo';
        reasons.push('evidencia de que ya es cliente');
      }
      break;
  }

  // Si es cliente, jamás conservar lead/prospecto/perdido.
  if (esCliente && target && ['prospecto', 'lead', 'perdido'].includes(target)) {
    target = 'cliente activo';
    reasons.push('es cliente ⇒ no puede ser prospecto/lead');
  }

  const add: string[] = [];
  const remove: string[] = [];

  // Exclusividad de ciclo: quitar todo ciclo que no sea el objetivo, y también
  // los ALIAS del objetivo (ej: `customer` se reemplaza por `cliente activo`).
  let targetPresentAsCanonical = false;
  for (let i = 0; i < currentTags.length; i++) {
    const raw = currentTags[i];
    const c = canonical[i];
    if (!(CICLO_TAGS as readonly string[]).includes(c)) continue;
    if (c !== target) remove.push(raw);
    else if (raw.trim().toLowerCase() !== target) remove.push(raw); // alias del objetivo
    else targetPresentAsCanonical = true;
  }
  if (target && !targetPresentAsCanonical) add.push(target);

  // Tag de tipo de conversación (tenor actual): agrega el vigente y quita los
  // viejos que lo contradicen (mismo criterio de alias que el ciclo).
  const convTag = assessment.tipo === 'frio' ? null : assessment.tipo;
  let convPresentAsCanonical = false;
  for (let i = 0; i < currentTags.length; i++) {
    const raw = currentTags[i];
    const c = canonical[i];
    if (!(CONV_TIPOS as readonly string[]).includes(c)) continue;
    if (!convTag || c !== convTag) remove.push(raw);
    else if (raw.trim().toLowerCase() !== convTag) remove.push(raw);
    else convPresentAsCanonical = true;
  }
  if (convTag && !convPresentAsCanonical) add.push(convTag);

  return {
    add: [...new Set(add)],
    remove: [...new Set(remove)],
    ciclo: target,
    motivo: reasons.join('; ') || 'normalización de tags',
  };
}
