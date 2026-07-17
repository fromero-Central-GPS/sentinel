import { NextResponse } from 'next/server';
import { listGhlTenants, verifyCronAuth } from '@/lib/engine-runners';
import { runRadarIngest } from '@/lib/radar-store';

/**
 * Cron del Radar: recorre las conversaciones de cada tenant, clasifica intención
 * de compra (regex) y persiste las que no tienen oportunidad abierta. Alimenta la
 * vista `/dashboard/radar`. Sin costo LLM (R-1).
 */

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const tenants = await listGhlTenants();
  const results = [];
  for (const { tenantId, creds } of tenants) {
    results.push(await runRadarIngest(tenantId, creds));
  }

  return NextResponse.json({
    job: 'radar',
    tenants: tenants.length,
    durationMs: Date.now() - started,
    results,
  });
}
