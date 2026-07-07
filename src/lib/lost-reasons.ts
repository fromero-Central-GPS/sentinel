/**
 * Etiquetas de razón de pérdida nativa de GHL + calibración IA (P2).
 *
 * GHL guarda en cada oportunidad perdida un `lostReasonId` (la razón que el
 * equipo registró al marcarla perdida), pero NO expone por API el nombre de esa
 * razón. El tenant las etiqueta a mano en Settings: cada id → un nombre legible
 * y, opcionalmente, un código de taxonomía (`LossReason`) para poder comparar la
 * razón del equipo contra el diagnóstico del LLM (calibración).
 */

import { LOSS_REASONS, type LossReason } from './taxonomy';

export interface LostReasonLabel {
  name: string;
  /** Código de taxonomía equivalente (habilita la calibración IA vs equipo). */
  reason?: LossReason;
}

/** Mapa lostReasonId → etiqueta. Serializado en `appSettings.ghlLostReasonMap`. */
export type LostReasonMap = Record<string, LostReasonLabel>;

const LOSS_REASON_SET = new Set<string>(LOSS_REASONS);

/** Parsea el JSON almacenado, tolerante a datos corruptos/legacy. */
export function parseLostReasonMap(raw: string | null | undefined): LostReasonMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: LostReasonMap = {};
    for (const [id, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (!val || typeof val !== 'object') continue;
      const v = val as { name?: unknown; reason?: unknown };
      const name = typeof v.name === 'string' ? v.name.trim() : '';
      if (!name) continue;
      const reason =
        typeof v.reason === 'string' && LOSS_REASON_SET.has(v.reason)
          ? (v.reason as LossReason)
          : undefined;
      out[id] = { name, reason };
    }
    return out;
  } catch {
    return {};
  }
}

/** Serializa el mapa (descarta entradas sin nombre). */
export function serializeLostReasonMap(map: LostReasonMap): string {
  const clean: LostReasonMap = {};
  for (const [id, label] of Object.entries(map)) {
    const name = label?.name?.trim();
    if (!name) continue;
    clean[id] = {
      name,
      reason: label.reason && LOSS_REASON_SET.has(label.reason) ? label.reason : undefined,
    };
  }
  return JSON.stringify(clean);
}

export interface TeamReasonCount {
  id: string;
  name: string;
  reason?: LossReason;
  count: number;
}

/**
 * Combina el conteo de lostReasonId (id → nº de deals) con el mapa de etiquetas.
 * Los ids sin etiquetar quedan con `name` = el propio id (para que el tenant vea
 * que faltan por nombrar). Ordenado por frecuencia desc.
 */
export function resolveTeamReasons(
  counts: Record<string, number>,
  map: LostReasonMap,
): TeamReasonCount[] {
  return Object.entries(counts)
    .map(([id, count]) => ({
      id,
      name: map[id]?.name ?? id,
      reason: map[id]?.reason,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface Calibration {
  /** Deals con razón del equipo mapeada a taxonomía Y diagnóstico IA disponible. */
  comparable: number;
  /** De esos, cuántos coinciden IA ↔ equipo. */
  agree: number;
  /** agree / comparable (0 si no hay comparables). */
  agreement: number;
}

/**
 * Calibración del LLM contra la razón registrada por el equipo. Solo cuenta
 * deals donde el equipo dejó un `lostReasonId` mapeado a un código de taxonomía
 * y el LLM ya diagnosticó ese deal.
 */
export function computeCalibration(
  deals: Array<{ lostReasonId?: string | null; aiReason?: LossReason | null }>,
  map: LostReasonMap,
): Calibration {
  let comparable = 0;
  let agree = 0;
  for (const d of deals) {
    const teamReason = d.lostReasonId ? map[d.lostReasonId]?.reason : undefined;
    if (!teamReason || !d.aiReason) continue;
    comparable++;
    if (teamReason === d.aiReason) agree++;
  }
  return { comparable, agree, agreement: comparable > 0 ? agree / comparable : 0 };
}
