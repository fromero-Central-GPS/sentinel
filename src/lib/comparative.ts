/**
 * Inteligencia comparativa (P2) — qué SEPARA ganar de perder.
 *
 * Won Track mostraba "frecuencia entre ganadores" (P(factor|won)), que no
 * discrimina: si un factor aparece en el 80% de los ganados pero también en el
 * 80% de los perdidos, no explica nada. Aquí calculamos el **lift**:
 *   lift(factor) = P(factor|won) / P(factor|lost)
 * Un lift > 1 significa que el factor es más común en los deals ganados — ese
 * sí discrimina. Se computa sobre el funnel completo sincronizado (won + lost),
 * reusando la MISMA extracción de factores (`analyzeWonDeal`) en ambos lados.
 *
 * Además: benchmarks SEGMENTADOS por tamaño de flota (un deal de $60K y uno de
 * $41M no comparten ciclo), para que Live Opp compare cada oportunidad contra
 * su segmento y no contra un promedio global sesgado.
 */

import type { WinFactor } from './taxonomy';
import { WIN_FACTORS } from './taxonomy';
import {
  computeSuccessThresholds,
  type BusinessFeatures,
  type CommunicationPatterns,
  type SuccessThresholds,
} from './won-track-engine';

/** Etiqueta legible de cada factor (misma fuente para servidor y UI). */
export const FACTOR_LABELS: Record<WinFactor, string> = {
  fast_close: 'Cierre rápido',
  fast_response: 'Respuesta rápida',
  high_engagement: 'Alto engagement del cliente',
  voice_notes: 'Notas de voz',
  multichannel: 'Comunicación multi-canal',
  proactive_client: 'Cliente proactivo (docs/pago)',
  preferred_channel: 'Canal preferido (WhatsApp)',
  annual_plan: 'Plan anual',
  multi_equipment: 'Multi-equipo',
  high_intent: 'Alta intención (preguntas)',
  positive_language: 'Lenguaje positivo',
  integration_fit: 'Requerimiento de integración',
  high_lead_score: 'Lead score alto',
};

export interface FactorLift {
  factor: WinFactor;
  label: string;
  wonCount: number;
  wonTotal: number;
  wonRate: number; // P(factor|won)
  lostCount: number;
  lostTotal: number;
  lostRate: number; // P(factor|lost)
  /** wonRate/lostRate con suavizado Laplace (finito y estable en muestras chicas). */
  lift: number;
}

/**
 * Lift por factor sobre los conjuntos de factores de deals ganados y perdidos.
 * Cada elemento de `wonFactorSets`/`lostFactorSets` son los factores de UN deal.
 *
 * El lift usa suavizado add-α (α=0.5) para no dividir por cero cuando un factor
 * no aparece en ningún perdido, y para no sobre-reaccionar con muestras chicas.
 * Las tasas crudas (`wonRate`/`lostRate`) se reportan sin suavizar para mostrar.
 */
export function computeFactorLift(
  wonFactorSets: WinFactor[][],
  lostFactorSets: WinFactor[][],
): FactorLift[] {
  const wonTotal = wonFactorSets.length;
  const lostTotal = lostFactorSets.length;

  const countIn = (sets: WinFactor[][], factor: WinFactor) =>
    sets.reduce((n, s) => (s.includes(factor) ? n + 1 : n), 0);

  const ALPHA = 0.5;
  const lifts: FactorLift[] = WIN_FACTORS.map((factor) => {
    const wonCount = countIn(wonFactorSets, factor);
    const lostCount = countIn(lostFactorSets, factor);
    const wonRate = wonTotal > 0 ? wonCount / wonTotal : 0;
    const lostRate = lostTotal > 0 ? lostCount / lostTotal : 0;
    // Tasas suavizadas para el ratio (evita 0 e ∞).
    const wonSmooth = (wonCount + ALPHA) / (wonTotal + 2 * ALPHA);
    const lostSmooth = (lostCount + ALPHA) / (lostTotal + 2 * ALPHA);
    const lift = lostSmooth > 0 ? wonSmooth / lostSmooth : 0;
    return {
      factor,
      label: FACTOR_LABELS[factor],
      wonCount,
      wonTotal,
      wonRate,
      lostCount,
      lostTotal,
      lostRate,
      lift: Math.round(lift * 100) / 100,
    };
  });

  // Más discriminante primero (lift alto), pero solo factores que existen.
  return lifts
    .filter((l) => l.wonCount > 0 || l.lostCount > 0)
    .sort((a, b) => b.lift - a.lift);
}

// ─── Benchmarks segmentados por tamaño de flota ────────────────────────────

export interface DealFeaturesPatterns {
  features: BusinessFeatures;
  patterns: CommunicationPatterns;
}

export interface SegmentThresholds {
  /** Etiqueta del segmento (BusinessFeatures.fleetSize). */
  segment: string;
  sampleSize: number;
  thresholds: SuccessThresholds;
}

/** Muestra mínima para reportar un segmento (bajo esto no es estadísticamente útil). */
const MIN_SEGMENT_SAMPLE = 3;

/**
 * Umbrales de éxito por segmento de flota. Solo devuelve segmentos con muestra
 * suficiente; el resto queda cubierto por el threshold global. Ordenado por
 * tamaño de muestra desc.
 */
export function computeSegmentedThresholds(deals: DealFeaturesPatterns[]): SegmentThresholds[] {
  const bySegment = new Map<string, DealFeaturesPatterns[]>();
  for (const d of deals) {
    const seg = d.features.fleetSize || 'desconocido';
    const list = bySegment.get(seg) ?? [];
    list.push(d);
    bySegment.set(seg, list);
  }

  const out: SegmentThresholds[] = [];
  for (const [segment, group] of bySegment) {
    if (group.length < MIN_SEGMENT_SAMPLE) continue;
    out.push({
      segment,
      sampleSize: group.length,
      thresholds: computeSuccessThresholds(
        group.map((g) => g.features),
        group.map((g) => g.patterns),
      ),
    });
  }
  return out.sort((a, b) => b.sampleSize - a.sampleSize);
}
