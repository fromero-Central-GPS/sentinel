/**
 * Webhook de Meta / WhatsApp Cloud API (P1-2).
 *
 * - GET: handshake de verificación. Meta llama con
 *   `hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<n>`. El token
 *   es por tenant (`app_settings.meta_webhook_verify_token`); como la GET de
 *   verificación NO trae identificador de tenant, buscamos el tenant cuyo token
 *   coincide y devolvemos `hub.challenge` en texto plano (lo que Meta exige).
 * - POST: eventos entrantes (mensajes / estados de entrega). Hoy la integración
 *   WhatsApp es solo saliente, así que registramos y respondemos 200 para que
 *   Meta no reintente ni desactive la suscripción.
 *
 * Esta ruta está exenta de auth en `proxy.ts` (`/api/webhooks/*`), así que la
 * GET no autenticada de Meta puede llegar.
 */

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle({ client: neon(url) });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode !== 'subscribe' || !token || !challenge) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const db = getDb();
  const [match] = await db
    .select({ tenantId: schema.appSettings.tenantId })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.metaWebhookVerifyToken, token))
    .limit(1);

  if (!match) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Meta espera el challenge crudo (text/plain), sin JSON ni comillas.
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function POST(request: NextRequest) {
  // Eventos entrantes. La integración WhatsApp es solo saliente por ahora;
  // registramos para diagnóstico y confirmamos recepción con 200.
  try {
    const body = await request.json();
    console.log('[meta/whatsapp] evento entrante:', JSON.stringify(body).slice(0, 1000));
  } catch {
    console.warn('[meta/whatsapp] POST sin JSON válido');
  }
  return new NextResponse(null, { status: 200 });
}
