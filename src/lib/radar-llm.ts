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
  resumen: z.string(),
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
- CLASIFICA POR EL ESTADO ACTUAL: pesa los ÚLTIMOS mensajes del cliente. Muchas
  conversaciones ABREN pidiendo cotización y luego DERIVAN. Si el hilo termina en
  "retiren el equipo / desinstalen el demo / demos de baja" es churn; si termina
  pidiendo ayuda técnica (no reporta, no prende, falla) es soporte; si termina en
  factura/renovación es postventa. El tenor lo define dónde ACABA la
  conversación, no cómo empezó.
- "motivo": una frase en español citando la evidencia clave (idealmente del tramo final).
- "confianza": 0=nula, 1=inequívoca.
- "resumen": resumen comercial de 1-2 frases enfocado en EL NEGOCIO, para que un
  vendedor sepa de qué va la conversación sin leerla. Prioriza, si aparecen:
  qué servicio/producto quiere (GPS, telemetría, tacógrafo, cámaras…), cuántos
  vehículos/equipos cotiza, tipo de flota, y en qué etapa está (recién consulta,
  pidió precio, evalúa propuesta, listo para cerrar). Si no es una venta, resume
  igual el asunto real (p.ej. "cliente reporta que 2 equipos no reportan"). Sé
  concreto y breve; nada de relleno. En español neutro.`;

/**
 * Clasifica el tenor de la conversación. `null` si no hay texto o el LLM no
 * está disponible.
 */
export async function classifyTenorLLM(
  messages: CanonicalMessage[],
  auth?: LLMAuth,
  onUsage?: (usage: LLMUsage) => void,
  onError?: (message: string) => void,
  /**
   * Tercera capa de contexto (campos AI + notas del contacto), ya renderizada.
   * La conversación manda; esto solo complementa. Ver `contact-context.ts`.
   */
  extraContext?: string,
): Promise<TenorResult | null> {
  const transcript = buildTranscript(messages, 5000);
  if (transcript.length === 0) return null;
  const context = extraContext?.trim()
    ? `Contexto adicional del contacto (complementario, la conversación manda):\n\n${extraContext.trim()}\n\n`
    : '';
  return generateStructured({
    schema,
    system: SYSTEM,
    prompt: `${context}Conversación:\n\n${transcript}`,
    model: auth?.model,
    attribution: auth?.attribution,
    onUsage,
    onError,
  });
}
