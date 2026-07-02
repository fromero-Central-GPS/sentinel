/**
 * Caché del último análisis LLM por tenant (Fase 2).
 *
 * Objetivo: al abrir una pantalla con IA se muestra el ÚLTIMO análisis guardado
 * (0 tokens); el LLM solo se re-ejecuta on-demand y actualiza esta caché. Evita
 * quemar tokens en cada refresh.
 *
 * engine: 'won_track' | 'forense'. key: 'playbook' (Won Track) o el opportunityId
 * (Forense, un registro por oportunidad).
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { llmAnalysis } from '@/db/schema';

export type LlmEngine = 'won_track' | 'forense';

export interface LlmRecord<T = unknown> {
  key: string;
  payload: T;
  model: string | null;
  analyzedAt: string;
}

/** Trae todos los registros LLM cacheados de un motor para el tenant. */
export async function getLlmAnalysis<T = unknown>(
  tenantId: string,
  engine: LlmEngine,
): Promise<LlmRecord<T>[]> {
  const rows = await db
    .select()
    .from(llmAnalysis)
    .where(and(eq(llmAnalysis.tenantId, tenantId), eq(llmAnalysis.engine, engine)));
  return rows.map((r) => ({
    key: r.key,
    payload: safeParse<T>(r.payload),
    model: r.model,
    analyzedAt: r.analyzedAt.toISOString(),
  }));
}

/** Upsert de un registro (por tenant+engine+key). */
export async function saveLlmAnalysis(
  tenantId: string,
  engine: LlmEngine,
  key: string,
  payload: unknown,
  model: string | null,
): Promise<void> {
  const now = new Date();
  await db
    .insert(llmAnalysis)
    .values({ tenantId, engine, key, payload: JSON.stringify(payload), model, analyzedAt: now })
    .onConflictDoUpdate({
      target: [llmAnalysis.tenantId, llmAnalysis.engine, llmAnalysis.key],
      set: { payload: JSON.stringify(payload), model, analyzedAt: now },
    });
}

function safeParse<T>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return s as unknown as T;
  }
}
