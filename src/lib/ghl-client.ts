/**
 * GHL Client — capa de acceso a datos de GoHighLevel.
 *
 * Centraliza todas las llamadas HTTP a la API de GHL (antes duplicadas en cada
 * ruta de motor). Funciona como el ÚNICO punto de contacto con GHL, de modo que
 * cuando integremos otros CRMs en el futuro solo haya que escribir un cliente
 * análogo que devuelva los mismos tipos normalizados (`RawOpportunity`, `RawMessage`).
 *
 * Todas las llamadas usan timeout para no colgar la función serverless.
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const DEFAULT_TIMEOUT_MS = 10_000;

export type OpportunityStatus = 'open' | 'won' | 'lost' | 'abandoned';

/** Forma cruda de una oportunidad tal como la devuelve GHL (campos opcionales/inconsistentes). */
export interface RawOpportunity {
  id: string;
  name?: string;
  status?: string;
  monetaryValue?: number;
  pipelineId?: string;
  pipelineName?: string;
  pipeline?: { name?: string };
  pipelineStageId?: string;
  pipelineStageName?: string;
  pipelineStage?: { name?: string };
  lastStageChangeAt?: string;
  createdAt?: string;
  updatedAt?: string;
  dateAdded?: string;
  conversationId?: string;
  contactId?: string;
  contact?: {
    id?: string;
    name?: string;
    companyName?: string;
    email?: string;
    phone?: string;
    tags?: string[];
    score?: Array<{ id: string; score: number }>;
  };
  customFields?: Array<{
    id: string;
    fieldValueString?: string;
    fieldValueNumber?: number;
    type: string;
  }>;
  attributions?: Array<{
    utmSessionSource?: string;
    medium?: string;
    isFirst?: boolean;
    isLast?: boolean;
  }>;
}

/** Mensaje normalizado de una conversación. */
export interface RawMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  messageType: string;
  dateAdded: string;
  attachments?: Array<{ url: string }>;
}

export interface GhlCredentials {
  token: string;
  locationId: string;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Version: GHL_VERSION };
}

async function ghlFetch(path: string, token: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

/** Lista oportunidades por estado (open/won/lost). Devuelve [] ante error de red controlado. */
export async function fetchOpportunities(
  { token, locationId }: GhlCredentials,
  status: OpportunityStatus,
  limit = 50,
): Promise<RawOpportunity[]> {
  const res = await ghlFetch(
    `/opportunities/search?location_id=${locationId}&status=${status}&limit=${limit}`,
    token,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GHL opportunities (${status}) ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { opportunities?: RawOpportunity[]; data?: RawOpportunity[] };
  return data.opportunities ?? data.data ?? [];
}

/** Resuelve el conversationId de un contacto (GHL suele omitirlo en /opportunities). */
export async function fetchConversationIdByContact(
  { token, locationId }: GhlCredentials,
  contactId: string,
): Promise<string | null> {
  const res = await ghlFetch(
    `/conversations/search?locationId=${locationId}&contactId=${contactId}&limit=1`,
    token,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { conversations?: Array<{ id: string }> };
  return data.conversations?.[0]?.id ?? null;
}

/** Trae los mensajes de una conversación (más recientes primero, normalizados). */
export async function fetchConversationMessages(
  { token }: GhlCredentials,
  conversationId: string,
  limit = 50,
): Promise<RawMessage[]> {
  const res = await ghlFetch(`/conversations/${conversationId}/messages?limit=${limit}`, token);
  if (!res.ok) return [];
  // GHL anida la lista: { messages: { messages: [...] } }. Algunos endpoints/mocks
  // la devuelven plana, así que aceptamos ambas formas.
  type RawGhlMessage = {
    id: string;
    direction: string;
    body?: string;
    messageType: string;
    dateAdded: string;
    attachments?: Array<{ url: string }>;
  };
  const data = (await res.json()) as {
    messages?: { messages?: RawGhlMessage[] } | RawGhlMessage[];
  };
  const list = Array.isArray(data.messages) ? data.messages : (data.messages?.messages ?? []);
  return list.map((m) => ({
    id: m.id,
    direction: m.direction === 'outbound' ? 'outbound' : 'inbound',
    body: m.body ?? '',
    messageType: m.messageType,
    dateAdded: m.dateAdded,
    attachments: m.attachments,
  }));
}

/**
 * Atajo: resuelve la conversación de un contacto y trae sus mensajes en un paso.
 * Devuelve [] si el contacto no tiene conversación.
 */
export async function fetchMessagesForContact(
  creds: GhlCredentials,
  contactId: string,
  limit = 50,
): Promise<RawMessage[]> {
  const conversationId = await fetchConversationIdByContact(creds, contactId);
  if (!conversationId) return [];
  return fetchConversationMessages(creds, conversationId, limit);
}

/** Verifica credenciales contra el endpoint de location. */
export async function verifyLocation({
  token,
  locationId,
}: GhlCredentials): Promise<{ ok: boolean; name?: string; error?: string }> {
  const res = await ghlFetch(`/locations/${locationId}`, token);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `GHL ${res.status}: ${text}` };
  }
  const data = (await res.json()) as { location?: { name?: string }; name?: string };
  return { ok: true, name: data.location?.name ?? data.name ?? 'Unknown' };
}
