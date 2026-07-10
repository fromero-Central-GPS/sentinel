/**
 * Test de envío de WhatsApp 1-a-1 (P1-2, herramienta de diagnóstico).
 *
 * Ejercita el MISMO path que el cron del digest — credenciales Meta del tenant
 * (token guardado y desencriptado desde `app_settings`) + `buildTenantDigests`
 * (mismo cómputo real) + plantilla configurada — pero enviando a UN número de
 * prueba en vez de a todos los vendedores. Sirve para validar el pipeline
 * completo (token, plantilla, entrega) sin hacer un blast al equipo.
 *
 * Autenticado con Clerk (orgId = tenantId). Body: `{ to, sellerId? }`.
 *   - `to`: teléfono destino en E.164 (con o sin `+`).
 *   - `sellerId` (opcional): usa el digest real de ese vendedor; si se omite,
 *     toma el de mayor valor en riesgo. Si no hay oportunidades en riesgo, envía
 *     un texto de muestra para validar igualmente token + plantilla + entrega.
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getMetaCreds, sendWhatsAppDigest } from '@/lib/whatsapp';
import { listGhlTenants } from '@/lib/engine-runners';
import { buildTenantDigests } from '@/lib/digest';

export const maxDuration = 120;

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { to?: string; sellerId?: string };
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  const sellerId = typeof body.sellerId === 'string' ? body.sellerId : undefined;
  if (!to) {
    return NextResponse.json({ error: 'Falta "to" (teléfono destino, E.164)' }, { status: 400 });
  }

  const metaCreds = await getMetaCreds(orgId);
  if (!metaCreds) {
    return NextResponse.json(
      { error: 'Meta/WhatsApp no configurado para este tenant (faltan phone number id / access token)' },
      { status: 400 },
    );
  }

  // Texto real del digest (mismo cómputo que el cron). Cae a un texto de muestra
  // si no hay credenciales GHL o no hay oportunidades en riesgo alto/crítico.
  let text: string;
  let source: string;
  const tenant = (await listGhlTenants()).find((t) => t.tenantId === orgId);
  if (tenant) {
    const digests = await buildTenantDigests(orgId, tenant.creds, tenant.salesPipelineId);
    const chosen = sellerId ? digests.find((d) => d.sellerId === sellerId) : digests[0];
    if (chosen) {
      text = chosen.text;
      source = `digest real de ${chosen.sellerName} (${chosen.sellerId})`;
    } else {
      text =
        'Prueba de Sentinel: no hay oportunidades en riesgo alto/crítico ahora mismo. Mensaje de validación de entrega.';
      source = digests.length
        ? `sellerId "${sellerId}" no encontrado; texto de muestra`
        : 'sin oportunidades en riesgo; texto de muestra';
    }
  } else {
    text = 'Prueba de Sentinel: validación de entrega del digest de WhatsApp.';
    source = 'sin credenciales GHL para el tenant; texto de muestra';
  }

  const result = await sendWhatsAppDigest(metaCreds, to, text);
  return NextResponse.json(
    { ok: result.sent, to, phoneNumberId: metaCreds.phoneNumberId, source, text, result },
    { status: result.sent ? 200 : 502 },
  );
}
