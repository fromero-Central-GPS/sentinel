import { NextResponse } from 'next/server';
import { listGhlTenants, runWonTrackForTenant, verifyCronAuth } from '@/lib/engine-runners';

/**
 * Cron semanal: recomputa el blueprint de Won Track (umbrales que consume Live
 * Opp) sobre el funnel ganado sincronizado y refresca la narrativa playbook.
 */

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const tenants = await listGhlTenants();
  const results = [];
  for (const { tenantId, creds, fieldMap } of tenants) {
    results.push(await runWonTrackForTenant(tenantId, creds, { useLLM: true, fieldMap }));
  }

  return NextResponse.json({
    job: 'won-track',
    tenants: tenants.length,
    durationMs: Date.now() - started,
    results,
  });
}
