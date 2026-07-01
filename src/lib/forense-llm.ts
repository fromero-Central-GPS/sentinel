/**
 * Forense LLM — diagnóstico de razón de pérdida con LLM (Fase 2).
 *
 * Reemplaza el regex de `analysis-engine.diagnoseLossReason`, que en el test real
 * clasificaba casi todo como `cliente_explorando` (no discriminaba). El LLM lee la
 * conversación y devuelve una razón del vocabulario compartido (`taxonomy`).
 *
 * Devuelve `null` si el LLM está deshabilitado/falla → la ruta cae al regex.
 */

import { z } from 'zod';
import { generateStructured, type LLMAuth } from './llm';
import { LOSS_REASONS, type LossReason } from './taxonomy';
import type { CanonicalMessage } from './types';
import type { LossReasonDiagnosis } from './analysis-engine';

const lossReasonEnum = z.enum(LOSS_REASONS as unknown as [LossReason, ...LossReason[]]);

const schema = z.object({
  primaryReason: lossReasonEnum,
  secondaryReasons: z.array(lossReasonEnum).max(2),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).max(4),
  suggestedAction: z.string(),
});

const SYSTEM = `Eres un analista de ventas B2B de una empresa chilena de GPS/telemetría para flotas.
Analizas una conversación de una oportunidad PERDIDA y determinas por qué se perdió.

Clasifica la razón principal en EXACTAMENTE una de estas categorías (usa el código tal cual):
- precio: el cliente objetó el precio / falta de presupuesto.
- competidor: se fue con otra empresa o comparó con la competencia.
- producto_no_disponible: necesitaba algo que no ofrecemos / incompatible.
- falta_informacion: no entendió el producto o le faltó información.
- sin_seguimiento: el cliente mostró interés pero el equipo no respondió/dio seguimiento.
- proceso_complejo: el proceso/onboarding le resultó complicado o lento.
- cliente_explorando: solo estaba cotizando/mirando, sin intención inmediata.
- desconocido: no hay evidencia suficiente en la conversación.

Reglas:
- Basa el diagnóstico SOLO en lo que dice la conversación; no inventes.
- "evidence" son citas textuales breves de la conversación que respaldan tu decisión.
- "suggestedAction" es una recomendación concreta y accionable en español.
- "confidence" refleja qué tan clara es la evidencia (0=nula, 1=inequívoca).`;

/**
 * Diagnostica la razón de pérdida vía LLM. `null` si no hay mensajes o el LLM
 * no está disponible (el llamador debe usar el fallback de regex).
 */
export async function diagnoseLossReasonLLM(
  messages: CanonicalMessage[],
  auth?: LLMAuth,
): Promise<LossReasonDiagnosis | null> {
  const realMessages = messages.filter(
    (m) => !m.messageType?.startsWith('TYPE_ACTIVITY') && (m.body?.trim().length ?? 0) > 0,
  );
  if (realMessages.length === 0) return null;

  // Acota el prompt para controlar costo/latencia (conversaciones largas se truncan).
  const transcript = realMessages
    .map((m) => `[${m.direction === 'inbound' ? 'CLIENTE' : 'VENDEDOR'}] ${m.body}`)
    .join('\n')
    .slice(0, 6000);

  return generateStructured({
    schema,
    system: SYSTEM,
    prompt: `Conversación de la oportunidad perdida:\n\n${transcript}`,
    model: auth?.model,
    apiKey: auth?.apiKey,
  });
}
