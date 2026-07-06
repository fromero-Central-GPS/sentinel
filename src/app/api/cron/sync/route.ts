import { NextResponse } from 'next/server';
import { listGhlTenants, runSyncForTenant, verifyCronAuth } from '@/lib/engine-runners';

/**
 * Cron: sincroniza el funnel GHL → BD de todos los tenants configurados.
 * Incremental (solo re-trae mensajes de deals cambiados). Alimenta a Forense,
 * Won Track y Live Opp, que leen de la BD sincronizada.
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
    results.push(await runSyncForTenant(tenantId, creds));
  }

  return NextResponse.json({
    job: 'sync',
    tenants: tenants.length,
    durationMs: Date.now() - started,
    results,
  });
}
