/**
 * Radar Engine (R-1) — clasificación Tier-1 (regex) de intención de COMPRA sobre
 * el último mensaje de una conversación GHL. Barato y sin LLM: corre sobre el
 * `lastMessageBody` que ya trae `conversations/search`.
 *
 * El objetivo es separar "huele a venta" (cotización, precio, quiero contratar…)
 * del ruido de soporte/postventa. En R-2 un LLM desambigua los casos dudosos.
 * Ver docs/radar-conversaciones-propuesta.md.
 */

/** Patrones de intención de COMPRA (lead nuevo / reactivación). */
const BUY_INTENT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /(?:cotizaci[oó]n|cotizar|cu[áa]nto (?:cuesta|vale|sale)|precio|valor|tarifa|presupuesto)/i, label: 'consulta_precio' },
  { re: /(?:me interesa|estoy interesad[oa]|quiero (?:comprar|contratar|cotizar)|necesito (?:cotizar|un plan|el servicio))/i, label: 'interes_compra' },
  { re: /(?:plan(?:es)?|contrato|contratar|adquirir|comprar)/i, label: 'mencion_plan' },
  { re: /(?:cu[áa]ntos? (?:equipos|veh[íi]culos|cam(?:ione|are)s)|flota|para \d+ )/i, label: 'volumen' },
  { re: /(?:demo|probar|c[oó]mo funciona|quiero ver)/i, label: 'solicitud_demo' },
  { re: /(?:instalaci[oó]n|instalar|cu[áa]ndo pueden|agendar)/i, label: 'consulta_instalacion' },
  { re: /(?:confirmo|confirmar|avanzar|proceder|seguir adelante|dónde pago|c[oó]mo pago)/i, label: 'confirmacion' },
];

/** Ruido que NO es compra (soporte / postventa) — baja la confianza. */
const SUPPORT_PATTERNS =
  /(?:no (?:funciona|anda|marca|reporta)|falla|problema|reclamo|soporte|no me (?:llega|aparece)|desinstalar|dar de baja|anular|factura|boleta|garant[íi]a)/i;

export interface IntentResult {
  buyIntent: boolean;
  signals: string[];
  /** true si el texto tiene marcadores de soporte/postventa (para desempatar). */
  supportHint: boolean;
}

/** Clasifica intención de compra sobre un texto (el último mensaje). */
export function classifyBuyIntent(text: string | undefined | null): IntentResult {
  const t = (text ?? '').trim();
  if (!t) return { buyIntent: false, signals: [], supportHint: false };
  const signals = BUY_INTENT_PATTERNS.filter(({ re }) => re.test(t)).map((p) => p.label);
  const supportHint = SUPPORT_PATTERNS.test(t);
  // Compra si hay señal de compra y no domina el soporte (o hay ≥2 señales).
  const buyIntent = signals.length > 0 && (!supportHint || signals.length >= 2);
  return { buyIntent, signals, supportHint };
}
