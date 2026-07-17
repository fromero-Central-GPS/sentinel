import { NextResponse } from 'next/server';
import { listGhlTenants, verifyCronAuth } from '@/lib/engine-runners';
import { runRadarClassify, runRadarIngest } from '@/lib/radar-store';

/**
 * Cron del Radar: (1) ingesta — recorre las conversaciones de cada tenant y
 * persiste candidatas por regex; (2) clasificación LLM del tenor (R-2) — separa
 * intención de compra real de soporte/postventa/churn/interno y reconcilia los
 * tags del contacto en GHL de forma autónoma. Alimenta `/dashboard/radar`.
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
    const ingest = await runRadarIngest(tenantId, creds);
    const classify = await runRadarClassify(tenantId, creds);
    results.push({ ingest, classify });
  }

  return NextResponse.json({
    job: 'radar',
    tenants: tenants.length,
    durationMs: Date.now() - started,
    results,
  });
}
