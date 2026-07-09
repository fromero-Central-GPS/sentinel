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
  /** ID del usuario GHL asignado (vendedor/dueño de la oportunidad). */
  assignedTo?: string;
  /** Razón de pérdida nativa de GHL (la registra el equipo al marcar lost). */
  lostReasonId?: string;
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

/**
 * POST a GHL con reintento ante 429 (mismo criterio que `ghlFetch`). Se usa para
 * las acciones de escritura (tags, tareas). Lanza si la respuesta no es OK.
 */
async function ghlPost(
  path: string,
  token: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GHL_BASE}${path}`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 600 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 8000)));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GHL POST ${path} ${res.status}: ${text}`);
    }
    return res.json().catch(() => ({}));
  }
}

/** Reintenta ante 429 (rate limit) con backoff, respetando Retry-After si viene. */
async function ghlFetch(path: string, token: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const MAX_RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GHL_BASE}${path}`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 600 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 8000)));
  }
}

/**
 * map con concurrencia acotada — evita reventar el rate limit de GHL cuando hay
 * que traer datos de muchas oportunidades. Preserva el orden de `items`.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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

/** Cursor de paginación de /opportunities/search (se pasa tal cual entre páginas). */
export interface OpportunityPageCursor {
  startAfter?: string;
  startAfterId?: string;
}

export interface OpportunityPage {
  opportunities: RawOpportunity[];
  /** Total de oportunidades con ese status en GHL (para barras de progreso). */
  total: number;
  /** Cursor para la página siguiente, o null si no hay más. */
  next: OpportunityPageCursor | null;
}

/**
 * Una página de oportunidades por estado, con cursor para continuar. Base del
 * sync full-funnel: permite recorrer las ~cientos de opps sin traerlas de golpe.
 */
export async function fetchOpportunitiesPage(
  { token, locationId }: GhlCredentials,
  status: OpportunityStatus,
  cursor?: OpportunityPageCursor,
  limit = 100,
): Promise<OpportunityPage> {
  const params = new URLSearchParams({
    location_id: locationId,
    status,
    limit: String(limit),
    order: 'added_desc',
  });
  if (cursor?.startAfter) params.set('startAfter', cursor.startAfter);
  if (cursor?.startAfterId) params.set('startAfterId', cursor.startAfterId);

  const res = await ghlFetch(`/opportunities/search?${params.toString()}`, token);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GHL opportunities page (${status}) ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    opportunities?: RawOpportunity[];
    meta?: { total?: number; startAfter?: number | string; startAfterId?: string; nextPageUrl?: string };
  };
  const opportunities = data.opportunities ?? [];
  const meta = data.meta;
  const hasNext = Boolean(meta?.nextPageUrl && meta?.startAfterId && opportunities.length > 0);
  return {
    opportunities,
    total: meta?.total ?? opportunities.length,
    next: hasNext
      ? { startAfter: String(meta!.startAfter), startAfterId: meta!.startAfterId }
      : null,
  };
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

/**
 * Mapa `pipelineStageId → nombre de etapa`. GHL /opportunities/search NO devuelve
 * el nombre de la etapa, solo el id; esto lo resuelve con un único llamado.
 */
export async function fetchStageMap({
  token,
  locationId,
}: GhlCredentials): Promise<Record<string, string>> {
  const res = await ghlFetch(`/opportunities/pipelines?locationId=${locationId}`, token);
  if (!res.ok) return {};
  const data = (await res.json()) as {
    pipelines?: Array<{ stages?: Array<{ id: string; name: string }> }>;
  };
  const map: Record<string, string> = {};
  for (const p of data.pipelines ?? []) {
    for (const s of p.stages ?? []) map[s.id] = s.name;
  }
  return map;
}

/**
 * Mapa `userId → nombre` de los usuarios de la location, para resolver el dueño
 * (assignedTo) de cada oportunidad. Un único llamado por request.
 */
export async function fetchUsers({
  token,
  locationId,
}: GhlCredentials): Promise<Record<string, string>> {
  const res = await ghlFetch(`/users/?locationId=${locationId}`, token);
  if (!res.ok) return {};
  const data = (await res.json()) as {
    users?: Array<{ id: string; name?: string; email?: string }>;
  };
  const map: Record<string, string> = {};
  for (const u of data.users ?? []) map[u.id] = u.name || u.email || u.id;
  return map;
}

/**
 * Usuarios de la location con detalle (nombre + teléfono), para el digest de
 * WhatsApp: necesitamos el número de cada vendedor para enviarle su mensaje.
 * GHL expone `phone` en algunos usuarios; queda vacío si no está cargado.
 */
export interface GhlUser {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

export async function fetchUsersDetailed({
  token,
  locationId,
}: GhlCredentials): Promise<GhlUser[]> {
  const res = await ghlFetch(`/users/?locationId=${locationId}`, token);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    users?: Array<{ id: string; name?: string; firstName?: string; lastName?: string; email?: string; phone?: string }>;
  };
  return (data.users ?? []).map((u) => ({
    id: u.id,
    name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id,
    email: u.email,
    phone: u.phone?.trim() || undefined,
  }));
}

/**
 * Usuario individual por ID vía `GET /users/{userId}` — fuente autoritativa del
 * nombre y teléfono del dueño de la oportunidad (`assignedTo`). El listado de la
 * location (`/users/?locationId=`) suele devolver el `phone` vacío, así que para
 * el digest resolvemos cada vendedor asignado por su ID. Devuelve null si el
 * usuario no existe / no es accesible con el token del tenant.
 */
export async function fetchUserById(
  { token }: GhlCredentials,
  userId: string,
): Promise<GhlUser | null> {
  const res = await ghlFetch(`/users/${userId}`, token);
  if (!res.ok) return null;
  const u = (await res.json().catch(() => null)) as {
    id?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  } | null;
  if (!u?.id) return null;
  return {
    id: u.id,
    name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id,
    email: u.email,
    phone: u.phone?.trim() || undefined,
  };
}

// ─── Acciones de escritura (P1-3: 1-click Forense → GHL) ──────────────────

/** Agrega tags a un contacto (p.ej. la ola de reactivación). */
export async function addContactTags(
  { token }: GhlCredentials,
  contactId: string,
  tags: string[],
): Promise<void> {
  await ghlPost(`/contacts/${contactId}/tags`, token, { tags });
}

/**
 * Crea una tarea sobre un contacto (seguimiento manual del vendedor).
 * `dueDate` en ISO; por defecto mañana. GHL exige un dueDate.
 */
export async function createContactTask(
  { token }: GhlCredentials,
  contactId: string,
  { title, body, dueDate }: { title: string; body?: string; dueDate?: string },
): Promise<{ id?: string }> {
  const due = dueDate ?? new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const result = (await ghlPost(`/contacts/${contactId}/tasks`, token, {
    title,
    body: body ?? '',
    dueDate: due,
    completed: false,
  })) as { task?: { id?: string }; id?: string };
  return { id: result.task?.id ?? result.id };
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
