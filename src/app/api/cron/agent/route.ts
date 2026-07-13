import { NextResponse } from 'next/server';
import { listGhlTenants, verifyCronAuth } from '@/lib/engine-runners';
import { runAgentForTenant } from '@/lib/agent-runner';

/**
 * Cron del agente (AG-3, ~07:00 America/Santiago — una hora antes del digest,
 * para que el digest ya refleje lo propuesto/ejecutado). Evalúa el playbook
 * sobre el funnel sincronizado y encola propuestas o ejecuta según la matriz
 * de autonomía del tenant.
 *
 * `?dryRun=1` devuelve lo que HARÍA sin escribir nada (verificación segura).
 */

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';

  const started = Date.now();
  const tenants = await listGhlTenants();
  const results = [];
  for (const { tenantId, creds, salesPipelineId, agentAutonomy } of tenants) {
    results.push(await runAgentForTenant(tenantId, creds, salesPipelineId, agentAutonomy, { dryRun }));
  }

  return NextResponse.json({
    job: 'agent',
    dryRun,
    tenants: tenants.length,
    proposed: results.reduce((s, r) => s + r.proposed, 0),
    executed: results.reduce((s, r) => s + r.executed, 0),
    durationMs: Date.now() - started,
    results,
  });
}
