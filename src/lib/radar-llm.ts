/**
 * Radar LLM (R-2) — clasificación del TENOR real de una conversación.
 *
 * El regex Tier-1 detecta vocabulario de venta, no el sentido: "retirar el demo"
 * contiene "demo" pero es churn; un cliente pidiendo soporte menciona "GPS" pero
 * no es un lead (bug jul-2026: Pedro/Erico/José Emilio). El LLM lee el hilo y
 * clasifica el tipo de conversación + si el contacto ya es cliente, alimentando
 * la reconciliación de tags (`tag-taxonomy.reconcileTags`).
 *
 * Devuelve `null` si el LLM está deshabilitado o falla (nunca lanza); el
 * llamador NO debe cachear el fallback.
 */

import { z } from 'zod';
import { generateStructured, type LLMAuth, type LLMUsage } from './llm';
import { CONV_TIPOS, type ConvTipo } from './tag-taxonomy';
import { buildTranscript } from './transcript';
import type { CanonicalMessage } from './types';

const schema = z.object({
  tipo: z.enum(CONV_TIPOS as unknown as [ConvTipo, ...ConvTipo[]]),
  esCliente: z.boolean(),
  confianza: z.number().min(0).max(1),
  motivo: z.string(),
});

export type TenorResult = z.infer<typeof schema>;

const SYSTEM = `Eres un analista comercial de una empresa chilena de GPS/telemetría para flotas (CentralGPS).
Lees una conversación (WhatsApp/email) y determinas el TENOR REAL: qué está pasando AHORA con este contacto.

Clasifica "tipo" en EXACTAMENTE una de estas categorías (usa el código tal cual):
- intencion-compra: quiere cotizar, comprar o contratar el servicio AHORA (lead o cliente que amplía).
- soporte: YA es cliente y tiene un problema técnico (equipo no reporta, plataforma, claves, botón de pánico…).
- postventa: YA es cliente y trata temas administrativos (factura, renovación, cambio de plan, datos).
- churn: quiere anular, dar de baja o retirar el servicio/equipo (ej: "retirar el demo").
- interno: es un empleado o partner de CentralGPS coordinando trabajo, no un cliente externo.
- frio: conversación sin señal accionable (saludos, nurture sin respuesta, tema agotado).
- spam: no es una conversación real de negocio.

"esCliente" = true si la evidencia muestra que YA tiene el servicio/equipos instalados
(habla de "mi plataforma", "mis equipos", fallas, claves de acceso, renovación…).
OJO: pedir soporte/renovación/baja implica que es cliente. Pedir una cotización inicial NO.

Reglas:
- Júzgalo por lo que dice el CLIENTE, no por los mensajes automáticos del equipo/bot.
- "motivo": una frase en español citando la evidencia clave.
- "confianza": 0=nula, 1=inequívoca.`;

/**
 * Clasifica el tenor de la conversación. `null` si no hay texto o el LLM no
 * está disponible.
 */
export async function classifyTenorLLM(
  messages: CanonicalMessage[],
  auth?: LLMAuth,
  onUsage?: (usage: LLMUsage) => void,
  onError?: (message: string) => void,
): Promise<TenorResult | null> {
  const transcript = buildTranscript(messages, 5000);
  if (transcript.length === 0) return null;
  return generateStructured({
    schema,
    system: SYSTEM,
    prompt: `Conversación:\n\n${transcript}`,
    model: auth?.model,
    attribution: auth?.attribution,
    onUsage,
    onError,
  });
}
