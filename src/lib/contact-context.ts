/**
 * Contexto del contacto — TERCERA CAPA de información para los motores y, en el
 * futuro, para el agente autónomo que tomará decisiones.
 *
 *   Capa 1 (primaria):   la conversación (mensajes).
 *   Capa 2 (secundaria): la oportunidad (valor, etapa, custom fields de la opp).
 *   Capa 3 (esta):       campos "AI" del CONTACTO + notas del contacto.
 *
 * Los campos AI son custom fields del contacto que hoy pueden estar vacíos y que
 * un agente irá completando (resúmenes, señales, próximos pasos). Las notas son
 * texto libre (bitácora). Ambos enriquecen el juicio sin sustituir a la
 * conversación: son contexto acumulado, no la señal en vivo.
 */

import {
  fetchContactById,
  fetchContactCustomFieldDefs,
  fetchContactNotes,
  type ContactCustomFieldDef,
  type GhlCredentials,
  type RawContactCustomFieldValue,
} from './ghl-client';

/** Un custom field del contacto ya resuelto (id → nombre) con su valor. */
export interface ContactField {
  id: string;
  name: string;
  fieldKey: string;
  value: string;
  /**
   * Tipo GHL del campo (TEXT, LARGE_TEXT, DATE, NUMERICAL, SINGLE_OPTIONS…).
   * `value` siempre viene como texto; el agente usa `dataType` para re-tiparlo
   * cuando necesita decidir (p.ej. `NUMERICAL` → `Number(value)`).
   */
  dataType: string;
  /** true si parece un campo poblado por IA/agente (ver `isAIField`). */
  isAI: boolean;
}

/** Una nota del contacto lista para mostrar/alimentar al LLM. */
export interface ContactNote {
  body: string;
  createdAt?: string;
}

/** La tercera capa ensamblada para un contacto. */
export interface ContactContext {
  /** Todos los custom fields del contacto con valor (AI y no-AI). */
  fields: ContactField[];
  /** Subconjunto de `fields` marcados como AI, para acceso directo. */
  aiFields: ContactField[];
  notes: ContactNote[];
}

/**
 * ¿Es un campo poblado por IA/agente? Convención por nombre/clave: un campo se
 * considera "AI" si su fieldKey o nombre empieza con `ai`/`ia` como token
 * (`ai_resumen`, `contact.ai_next_step`, "AI - Resumen", "IA Señal"). Es el
 * único punto a tocar si el equipo cambia la convención de nombres del agente.
 */
export function isAIField(def: Pick<ContactCustomFieldDef, 'name' | 'fieldKey'>): boolean {
  // El fieldKey de GHL viene como `contact.<clave>`; nos quedamos con la clave.
  const key = (def.fieldKey || '').split('.').pop() ?? '';
  const name = def.name || '';
  return /^(ai|ia)[\s._-]/i.test(key) || /^(ai|ia)[\s._-]/i.test(name.trim());
}

/** Normaliza el valor crudo (string | number | boolean | array) a texto. */
function valueToString(value: RawContactCustomFieldValue['value']): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return String(value).trim();
}

/**
 * Ensambla la tercera capa de un contacto: resuelve los custom fields del
 * contacto a nombres legibles, los marca AI/no-AI y adjunta las notas. Nunca
 * lanza: ante error de red devuelve lo que pudo (capas parciales), porque es
 * contexto complementario, no la señal principal.
 */
export async function assembleContactContext(
  creds: GhlCredentials,
  contactId: string,
  { maxNotes = 5 }: { maxNotes?: number } = {},
): Promise<ContactContext> {
  const [contact, defs, notes] = await Promise.all([
    fetchContactById(creds, contactId).catch(() => null),
    fetchContactCustomFieldDefs(creds).catch(() => new Map<string, ContactCustomFieldDef>()),
    fetchContactNotes(creds, contactId).catch(() => []),
  ]);

  const fields: ContactField[] = [];
  for (const raw of contact?.customFields ?? []) {
    const value = valueToString(raw.value);
    if (!value) continue; // los campos vacíos no aportan contexto
    const def = defs.get(raw.id);
    const name = def?.name ?? raw.id;
    const fieldKey = def?.fieldKey ?? '';
    const dataType = def?.dataType ?? '';
    const isAI = def ? isAIField(def) : false;
    fields.push({ id: raw.id, name, fieldKey, value, dataType, isAI });
  }

  return {
    fields,
    aiFields: fields.filter((f) => f.isAI),
    notes: notes.slice(0, maxNotes).map((n) => ({ body: n.body, createdAt: n.createdAt })),
  };
}

function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Renderiza la tercera capa como bloque de texto compacto para el prompt del
 * LLM/agente. Devuelve '' si no hay nada que aportar (para no ensuciar el
 * prompt). Prioriza los campos AI; luego el resto de campos; luego las notas.
 */
export function renderContactContextForLLM(ctx: ContactContext): string {
  const lines: string[] = [];

  if (ctx.aiFields.length > 0) {
    lines.push('Campos AI del contacto (poblados por el agente):');
    for (const f of ctx.aiFields) lines.push(`- ${f.name}: ${f.value}`);
  }

  const otherFields = ctx.fields.filter((f) => !f.isAI);
  if (otherFields.length > 0) {
    lines.push('Otros datos del contacto:');
    for (const f of otherFields) lines.push(`- ${f.name}: ${f.value}`);
  }

  if (ctx.notes.length > 0) {
    lines.push('Notas del contacto (más recientes primero):');
    for (const n of ctx.notes) {
      const when = shortDate(n.createdAt);
      lines.push(`- ${when ? `[${when}] ` : ''}${n.body}`);
    }
  }

  return lines.join('\n');
}
