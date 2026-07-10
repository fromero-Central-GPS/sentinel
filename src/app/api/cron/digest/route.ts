import { NextResponse } from 'next/server';
import { listGhlTenants, verifyCronAuth } from '@/lib/engine-runners';
import { runDigestForTenant } from '@/lib/digest';

/**
 * Cron matinal (~8:00 America/Santiago): envía a cada vendedor su digest de
 * WhatsApp con las oportunidades abiertas en riesgo. Sin credenciales Meta /
 * plantilla configurada, hace dry-run y devuelve el preview de cada mensaje.
 */

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const tenants = await listGhlTenants();
  const results = [];
  for (const { tenantId, creds, salesPipelineId } of tenants) {
    results.push(await runDigestForTenant(tenantId, creds, salesPipelineId));
  }

  const sent = results.reduce((s, r) => s + r.sent, 0);
  return NextResponse.json({
    job: 'digest',
    tenants: tenants.length,
    sent,
    durationMs: Date.now() - started,
    results,
  });
}
