/**
 * Matriz de autonomía del agente por tenant (AG-3).
 *
 * Para cada acción ejecutable del playbook, el tenant define el modo:
 *  - `off`: el cron la ignora (solo queda visible en Live Opp).
 *  - `propose`: el cron la encola como 'proposed' (aparece en el digest y se
 *    ejecuta con el 1-click de Live Opp). Default seguro.
 *  - `auto`: el cron la ejecuta solo y deja bitácora [AGENTE] (nivel A2).
 *
 * La promoción a `auto` es decisión humana informada por el outcome tracking
 * (doc agente-vendedor §6). Serializado como JSON en `app_settings.agent_autonomy`.
 */

import { EXECUTABLE_ACTIONS } from './playbook-engine';
import type { AgentAction } from './taxonomy';

export const AUTONOMY_MODES = ['off', 'propose', 'auto'] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export type AutonomyConfig = Record<AgentAction, AutonomyMode>;

/** Default: todo lo ejecutable en 'propose'; lo que toca al cliente en 'off'. */
export function getDefaultAutonomy(): AutonomyConfig {
  const config = {} as AutonomyConfig;
  for (const action of [
    'contactar_cliente',
    'ultimo_intento',
    'mover_a_frio',
    'crear_tarea_vendedor',
    'crear_nota',
    'escalar_a_humano',
    'no_tocar',
    'monitorear',
  ] as AgentAction[]) {
    config[action] = EXECUTABLE_ACTIONS.includes(action) ? 'propose' : 'off';
  }
  return config;
}

/** Parsea el JSON guardado; valores inválidos o ausentes caen al default. */
export function parseAutonomyConfig(raw: string | null | undefined): AutonomyConfig {
  const config = getDefaultAutonomy();
  if (!raw) return config;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const action of Object.keys(config) as AgentAction[]) {
      const mode = parsed[action];
      if (mode && (AUTONOMY_MODES as readonly string[]).includes(mode)) {
        // Guardrail duro: las acciones que tocan al cliente no se pueden
        // habilitar por config mientras no exista AG-4.
        if (!EXECUTABLE_ACTIONS.includes(action) && mode !== 'off') continue;
        config[action] = mode as AutonomyMode;
      }
    }
  } catch {
    // JSON corrupto → default seguro
  }
  return config;
}

export function serializeAutonomyConfig(config: AutonomyConfig): string {
  return JSON.stringify(config);
}
