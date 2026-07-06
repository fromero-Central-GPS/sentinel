/**
 * WhatsApp Business (Meta Cloud API) — envío de mensajes salientes (P1-2).
 *
 * Credenciales por tenant en `app_settings` (`meta_phone_number_id`,
 * `meta_access_token`, encriptadas). El digest matinal es un mensaje
 * business-initiated (fuera de la ventana de 24h), así que Meta EXIGE una
 * plantilla aprobada: se configura por env `WHATSAPP_DIGEST_TEMPLATE` (+ idioma
 * `WHATSAPP_DIGEST_LANG`) con UNA variable de cuerpo que recibe el texto del
 * digest. Sin plantilla configurada, `sendWhatsAppDigest` NO envía (dry-run) y
 * devuelve el texto compuesto para inspección/logs.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { decrypt } from '@/lib/encryption';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface MetaCredentials {
  phoneNumberId: string;
  accessToken: string;
}

/** Credenciales Meta del tenant (desencriptadas) o null si no están cargadas. */
export async function getMetaCreds(tenantId: string): Promise<MetaCredentials | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.tenantId, tenantId));
  if (!row?.metaPhoneNumberId || !row?.metaAccessToken) return null;
  try {
    return { phoneNumberId: row.metaPhoneNumberId, accessToken: decrypt(row.metaAccessToken) };
  } catch {
    return null;
  }
}

/** Deja el teléfono en formato E.164 sin `+` (lo que espera Meta en `to`). */
export function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, '');
}

export interface SendResult {
  sent: boolean;
  /** true si no se envió porque no hay plantilla configurada (dry-run). */
  dryRun?: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Envía el digest a un vendedor. Usa la plantilla de env con una variable de
 * cuerpo = `text`. Si no hay plantilla configurada, es dry-run (no envía).
 */
export async function sendWhatsAppDigest(
  creds: MetaCredentials,
  to: string,
  text: string,
): Promise<SendResult> {
  const template = process.env.WHATSAPP_DIGEST_TEMPLATE;
  const lang = process.env.WHATSAPP_DIGEST_LANG ?? 'es';
  if (!template) return { sent: false, dryRun: true };

  const payload = {
    messaging_product: 'whatsapp',
    to: normalizePhone(to),
    type: 'template',
    template: {
      name: template,
      language: { code: lang },
      components: [
        { type: 'body', parameters: [{ type: 'text', text }] },
      ],
    },
  };

  try {
    const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { sent: false, error: `Meta ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    return { sent: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}
