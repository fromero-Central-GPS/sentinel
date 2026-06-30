/**
 * Taxonomy — vocabulario compartido de los motores de Sentinel.
 *
 * Los 3 motores (Forense/analysis, Won Track, Live Opp) tienen que "hablar el
 * mismo idioma": una razón de pérdida, una señal de riesgo o una intención debe
 * significar lo mismo en todos. Antes cada motor definía sus propias uniones de
 * string en paralelo; acá viven una sola vez y los motores las re-exportan.
 *
 * Cada vocabulario se declara como `const` array (fuente de verdad runtime, útil
 * para iterar/validar) + un tipo derivado (`(typeof X)[number]`). Las cadenas
 * literales son idénticas a las que ya usaban los motores, de modo que el cambio
 * es puramente de centralización y no altera ningún contrato externo (UI/rutas).
 */

// ─── Razones de pérdida (Forense) ─────────────────────────────────────────────

export const LOSS_REASONS = [
  'sin_seguimiento',
  'precio',
  'competidor',
  'producto_no_disponible',
  'falta_informacion',
  'proceso_complejo',
  'cliente_explorando',
  'desconocido',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

// ─── Etapas del funnel (Forense) ──────────────────────────────────────────────

export const FUNNEL_STAGES = [
  'consulta_inicial',
  'cotizacion',
  'demo_plataforma',
  'negociacion',
  'cierre',
  'seguimiento',
  'perdido',
  'ganado',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// ─── Señales / categorías de riesgo (Live Opp) ────────────────────────────────

export const RISK_SIGNALS = [
  'no_response', // cliente esperando respuesta
  'stalling', // sin actividad por demasiado tiempo
  'low_engagement', // el cliente no se involucra lo suficiente
  'slow_response', // el equipo responde demasiado lento
  'deal_decay', // deal abierto más allá del benchmark
  'competitor_risk', // el cliente mencionó competencia
] as const;
export type RiskSignal = (typeof RISK_SIGNALS)[number];

export const RISK_SEVERITIES = ['critical', 'high', 'medium', 'low', 'none'] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

// ─── Señales de intención conversacional (Forense + Live Opp) ─────────────────

/**
 * Etiquetas de intención que se detectan dentro de una conversación. Unión de
 * las que usaban `analysis-engine` y `live-opp-engine` por separado.
 */
export const INTENT_SIGNALS = [
  'interes_directo',
  'consulta_precio',
  'solicitud_demo',
  'urgencia',
  'solicitud_info',
  'comparacion',
  'mencion_flota',
  'consulta_instalacion',
  'mencion_gps',
  'engagement_positivo',
  'solicitud_envio',
  'solicitud_contacto',
  'mencion_competidor',
  'confirmacion',
] as const;
export type IntentSignal = (typeof INTENT_SIGNALS)[number];

// ─── Factores de éxito (Won Track) ────────────────────────────────────────────

/**
 * Vocabulario controlado de factores que explican un deal ganado. Won Track hoy
 * emite descripciones en texto libre (`winningFormula`); estos códigos son el
 * contrato estable que el cerebro LLM de Fase 2 emitirá y que Live Opp podrá
 * comparar contra deals abiertos.
 */
export const WIN_FACTORS = [
  'fast_close', // cierre rápido vs benchmark
  'fast_response', // respuesta rápida del equipo
  'high_engagement', // cliente muy involucrado (inbound alto)
  'voice_notes', // cliente envió notas de voz
  'multichannel', // comunicación multi-canal (WhatsApp + Email)
  'proactive_client', // cliente proactivo con documentos/pago
  'preferred_channel', // entró por el canal más efectivo
  'annual_plan', // plan anual (mayor retención)
  'multi_equipment', // multi-equipo (potencial upsell)
  'high_intent', // muchas preguntas / alta intención
  'positive_language', // lenguaje positivo del cliente
  'integration_fit', // requerimiento de integración satisfecho
  'high_lead_score', // lead score alto al entrar
] as const;
export type WinFactor = (typeof WIN_FACTORS)[number];

// ─── Clase de intención de entrada (Split the Funnel) ─────────────────────────

/**
 * Bucket de "Split the Funnel" (Refine Labs): por qué entró el lead al pipeline.
 * - `declarada`: intención alta declarada (demo, precio, contacto-ventas).
 * - `creada`: intención baja creada por marketing (ebook, webinar, feria).
 * Dimensión transversal de los 3 motores; se explota en Fase 4.
 */
export const INTENT_CLASSES = ['declarada', 'creada', 'desconocida'] as const;
export type IntentClass = (typeof INTENT_CLASSES)[number];
