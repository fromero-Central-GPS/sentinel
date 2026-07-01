/**
 * Won Track LLM — narrativa "playbook" de ventas ganadas (Fase 2).
 *
 * Los factores de éxito por deal se calculan en código (contrato `WIN_FACTORS`,
 * ver won-track-engine). El LLM agrega SOLO la capa cualitativa: una síntesis
 * accionable de por qué se ganan los deals y qué replicar. Es UNA sola llamada
 * por corrida (barata), no una por deal.
 *
 * Devuelve `null` si el LLM está deshabilitado/falla → la ruta omite el playbook.
 */

import { z } from 'zod';
import { generateStructured } from './llm';
import type { WinFactor } from './taxonomy';
import type { WonTrackOutput } from './won-track-engine';

const schema = z.object({ summary: z.string() });

const SYSTEM = `Eres un estratega de ventas B2B de una empresa chilena de GPS/telemetría para flotas.
Recibes un resumen agregado de deals GANADOS (factores de éxito más frecuentes y benchmarks).
Escribe un "playbook" BREVE (máx 4 frases, en español) y accionable: qué patrones explican
las ventas ganadas y qué debería replicar el equipo comercial. No inventes datos; básate solo
en el resumen. No uses viñetas, escribe en prosa concisa.`;

/** Cuenta la frecuencia de cada factor de éxito entre los deals. */
function tallyFactors(output: WonTrackOutput): Array<[WinFactor, number]> {
  const counts = new Map<WinFactor, number>();
  for (const deal of output.deals) {
    for (const f of deal.factors) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Genera la narrativa playbook. `null` si no hay deals o el LLM no está disponible.
 */
export async function summarizeWinningPlaybookLLM(output: WonTrackOutput): Promise<string | null> {
  if (output.deals.length === 0) return null;

  const t = output.thresholds;
  const topFactors = tallyFactors(output)
    .slice(0, 8)
    .map(([factor, count]) => `${factor}: ${count}/${output.deals.length} deals`)
    .join('\n');

  const prompt = `Deals ganados analizados: ${output.deals.length}
Factores de éxito más frecuentes:
${topFactors}

Benchmarks:
- Tiempo de cierre mediano: ${t.medianTimeToClose}d (promedio ${t.avgTimeToClose}d)
- Respuesta ideal: ≤${t.idealResponseThreshold}min
- Canal top: ${t.topChannel}
- Plan más vendido: ${t.topPlan}`;

  const result = await generateStructured({ schema, system: SYSTEM, prompt });
  return result?.summary ?? null;
}
