import { NextResponse } from 'next/server';
import { listGhlTenants, runForenseForTenant, verifyCronAuth } from '@/lib/engine-runners';

/**
 * Cron nocturno: drena diagnósticos LLM de razón de pérdida pendientes. Cada
 * corrida analiza los top-N deals perdidos sin diagnóstico cacheado; con los
 * días cubre el backlog completo sin intervención manual.
 */

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const tenants = await listGhlTenants();
  const results = [];
  // Secuencial entre tenants: cada uno ya corre su batch con concurrencia
  // acotada; paralelizar tenants multiplicaría la presión sobre el gateway.
  for (const { tenantId, creds } of tenants) {
    results.push(await runForenseForTenant(tenantId, creds));
  }

  const analyzed = results.reduce((s, r) => s + r.analyzed, 0);
  return NextResponse.json({
    job: 'forense',
    tenants: tenants.length,
    analyzed,
    durationMs: Date.now() - started,
    results,
  });
}
