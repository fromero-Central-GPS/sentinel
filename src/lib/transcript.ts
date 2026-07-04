/**
 * Transcript — preparación de conversaciones para regex/LLM (Fase 3).
 *
 * Dos problemas detectados con datos reales (deal Soser $41M, jun-2026):
 *
 * 1. Los emails de GHL traen el hilo citado completo + firmas: un solo mensaje
 *    puede pesar >5.000 chars de boilerplate, contaminando los patrones regex y
 *    agotando el presupuesto del prompt LLM antes de llegar al contenido nuevo.
 *
 * 2. `forense-llm` truncaba con `.slice(0, 6000)` — conservando el INICIO. La
 *    razón de pérdida casi siempre está al FINAL de la conversación ("decidimos
 *    continuar con nuestro proveedor actual" fue el último email del deal).
 */

import type { CanonicalMessage } from './types';

// ─── Limpieza de cuerpo de email ────────────────────────────────────────────

/** Líneas que marcan el comienzo de un hilo citado (a partir de ahí se corta). */
const QUOTE_HEADER_PATTERNS: RegExp[] = [
  /^De:\s.+$/im, // "De: Francisco Romero <...>"
  /^From:\s.+$/im,
  /^El\s.+\bescribió:\s*$/im, // "El lun, 30 mar 2026 ... escribió:"
  /^On\s.+\bwrote:\s*$/im,
  /^-{5,}\s*(?:Mensaje original|Original Message|Forwarded message)?\s*-{0,}$/im,
  /^_{5,}\s*$/im,
  /^>{1}\s?/m, // primera línea citada con ">"
];

/** Ruido típico de firmas/pies que no aporta señal de venta. */
const SIGNATURE_NOISE =
  /^(?:atte\.?|saludos|slds|cordialmente|best regards|enviado desde|sent from)/i;

/**
 * Limpia el cuerpo de un email: corta el hilo citado (todo lo que sigue al
 * primer marcador de cita) y descarta líneas de puro ruido (URLs de imágenes,
 * cid:, firmas). Para mensajes no-email es identidad salvo trim.
 */
export function cleanEmailBody(body: string): string {
  if (!body) return '';

  // Punto de corte: el marcador de cita MÁS TEMPRANO en el texto.
  let cut = body.length;
  for (const re of QUOTE_HEADER_PATTERNS) {
    const m = body.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  const own = body.slice(0, cut);

  const lines = own
    .split('\n')
    .map((l) => l.trim())
    // fuera imágenes inline, cids y URLs sueltas entre corchetes
    .filter((l) => !/^\[(?:https?:|cid:)/i.test(l) && !/^https?:\/\/\S+$/i.test(l))
    .filter((l) => !SIGNATURE_NOISE.test(l));

  // Colapsa líneas vacías consecutivas.
  const out: string[] = [];
  for (const l of lines) {
    if (l === '' && out[out.length - 1] === '') continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

/** Limpia un mensaje según su tipo (solo los emails necesitan cirugía). */
export function cleanMessageBody(msg: CanonicalMessage): string {
  const body = msg.body?.trim() ?? '';
  if (!body) return '';
  return msg.messageType === 'TYPE_EMAIL' ? cleanEmailBody(body) : body;
}

// ─── Construcción del transcript ────────────────────────────────────────────

/** Fracción del presupuesto reservada para el FINAL de la conversación. */
const TAIL_BUDGET_RATIO = 0.7;

/**
 * Arma el transcript acotado a `maxChars` priorizando el FINAL de la
 * conversación (donde vive la razón de pérdida/decisión), pero conservando el
 * inicio para contexto. Espera mensajes en orden cronológico ASC.
 */
export function buildTranscript(messages: CanonicalMessage[], maxChars = 6000): string {
  const lines = messages
    .filter((m) => !m.messageType?.startsWith('TYPE_ACTIVITY'))
    .map((m) => {
      const body = cleanMessageBody(m);
      if (!body) return null;
      return `[${m.direction === 'inbound' ? 'CLIENTE' : 'VENDEDOR'}] ${body}`;
    })
    .filter((l): l is string => l !== null);

  const totalLen = lines.reduce((s, l) => s + l.length + 1, 0);
  if (totalLen <= maxChars) return lines.join('\n');

  // Presupuesto: cola primero (70%), luego cabeza con lo que quede.
  const tailBudget = Math.floor(maxChars * TAIL_BUDGET_RATIO);
  const headBudget = maxChars - tailBudget;

  const tail: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + 1;
    if (used + cost > tailBudget) break;
    tail.unshift(lines[i]);
    used += cost;
  }

  const head: string[] = [];
  used = 0;
  const tailStart = lines.length - tail.length;
  for (let i = 0; i < tailStart; i++) {
    const cost = lines[i].length + 1;
    if (used + cost > headBudget) break;
    head.push(lines[i]);
    used += cost;
  }

  const omitted = lines.length - head.length - tail.length;
  const parts = [...head];
  if (omitted > 0) parts.push(`[... ${omitted} mensajes omitidos ...]`);
  parts.push(...tail);
  return parts.join('\n');
}
