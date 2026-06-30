/**
 * Won Track store — persistencia del "blueprint" de éxito por tenant.
 *
 * Won Track calcula los SuccessThresholds a partir de los deals ganados y los
 * guarda aquí. Live Opp los lee para evaluar las oportunidades abiertas contra
 * el patrón real del tenant (en vez de umbrales hardcodeados).
 */
import { db } from '@/db';
import { wonTrackThresholds } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { SuccessThresholds } from './won-track-engine';

/** Lee los thresholds persistidos del tenant. Devuelve null si nunca se computaron. */
export async function getTenantThresholds(tenantId: string): Promise<SuccessThresholds | null> {
  try {
    const [row] = await db
      .select({ thresholds: wonTrackThresholds.thresholds })
      .from(wonTrackThresholds)
      .where(eq(wonTrackThresholds.tenantId, tenantId));
    if (!row) return null;
    return JSON.parse(row.thresholds) as SuccessThresholds;
  } catch {
    // Tabla aún no migrada o JSON corrupto → tratar como "sin blueprint".
    return null;
  }
}

/** Guarda (upsert) los thresholds del tenant tras un análisis Won Track. */
export async function saveTenantThresholds(
  tenantId: string,
  thresholds: SuccessThresholds,
): Promise<void> {
  const now = new Date();
  const payload = JSON.stringify(thresholds);
  await db
    .insert(wonTrackThresholds)
    .values({
      tenantId,
      thresholds: payload,
      sampleSize: String(thresholds.sampleSize),
      computedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: wonTrackThresholds.tenantId,
      set: {
        thresholds: payload,
        sampleSize: String(thresholds.sampleSize),
        computedAt: now,
        updatedAt: now,
      },
    });
}
