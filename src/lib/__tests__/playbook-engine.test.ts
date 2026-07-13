import { describe, it, expect } from 'vitest';
import {
  canonicalStageFromName,
  countUnansweredAttempts,
  decidePlaybookAction,
  formatAgentNote,
  EXECUTABLE_ACTIONS,
} from '../playbook-engine';
import type { LiveOppAnalysis } from '../live-opp-engine';
import type { CanonicalMessage, Deal } from '../types';

// ─── Helpers de fixture ───────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

function mkDeal(over: Partial<Deal> = {}): Deal {
  const base: Deal = {
    id: 'd1',
    name: 'Deal',
    status: 'open',
    monetaryValue: 1_000_000,
    pipelineName: 'Ventas',
    pipelineStageName: 'Recibido',
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
    lastStageChangeAt: daysAgo(10),
    contactId: 'c1',
    contact: { id: 'c1', name: 'Cliente' },
  };
  return { ...base, ...over };
}

function msg(
  direction: 'inbound' | 'outbound',
  daysBack: number,
  over: Partial<CanonicalMessage> = {},
): CanonicalMessage {
  return {
    id: `m-${direction}-${daysBack}`,
    direction,
    body: 'hola',
    messageType: 'TYPE_WHATSAPP',
    dateAdded: daysAgo(daysBack),
    ...over,
  };
}

function mkAnalysis(over: Partial<LiveOppAnalysis> = {}): LiveOppAnalysis {
  const base: LiveOppAnalysis = {
    opportunityId: 'd1',
    contactName: 'Cliente',
    value: 1_000_000,
    stage: 'Recibido',
    pipeline: 'Ventas',
    overallRiskScore: 60,
    riskLevel: 'high',
    alerts: [],
    messagesInLast7Days: 0,
    daysSinceLastContact: 5,
    hoursSinceLastInbound: null,
    avgResponseMinutes: 0,
    inboundRatio: 0,
    totalMessages: 2,
    daysOpen: 10,
    isPastBenchmark: false,
    intentSignals: [],
    recommendedActions: ['Revisar la oportunidad.'],
    urgency: 'hoy',
  };
  return { ...base, ...over };
}

// ─── canonicalStageFromName ───────────────────────────────────────────────────

describe('canonicalStageFromName', () => {
  it('mapea los nombres típicos de etapas en español', () => {
    expect(canonicalStageFromName('Recibido')).toBe('consulta_inicial');
    expect(canonicalStageFromName('Calificado')).toBe('cotizacion');
    expect(canonicalStageFromName('Demo/Plataforma')).toBe('demo_plataforma');
    expect(canonicalStageFromName('Demo/Instalado')).toBe('demo_plataforma');
    expect(canonicalStageFromName('Aceptado')).toBe('cierre');
    expect(canonicalStageFromName('Frio')).toBe('seguimiento');
    expect(canonicalStageFromName('Frío')).toBe('seguimiento');
    expect(canonicalStageFromName('Perdido')).toBe('perdido');
  });

  it('devuelve null cuando no hay patrón que calce', () => {
    expect(canonicalStageFromName('Etapa Rarísima X')).toBeNull();
    expect(canonicalStageFromName('')).toBeNull();
  });
});

// ─── countUnansweredAttempts ──────────────────────────────────────────────────

describe('countUnansweredAttempts', () => {
  it('cuenta días con outbound posteriores al último inbound', () => {
    const messages = [msg('inbound', 10), msg('outbound', 8), msg('outbound', 5), msg('outbound', 2)];
    expect(countUnansweredAttempts(messages)).toBe(3);
  });

  it('colapsa varios outbound del mismo día en un intento', () => {
    const sameDay = daysAgo(3);
    const messages = [
      msg('inbound', 10),
      msg('outbound', 3, { dateAdded: sameDay, id: 'a' }),
      msg('outbound', 3, { dateAdded: sameDay, id: 'b' }),
    ];
    expect(countUnansweredAttempts(messages)).toBe(1);
  });

  it('un inbound del cliente resetea los intentos', () => {
    const messages = [msg('outbound', 10), msg('outbound', 8), msg('inbound', 6)];
    expect(countUnansweredAttempts(messages)).toBe(0);
  });

  it('sin inbound jamás, cuentan todos los días con outbound', () => {
    const messages = [msg('outbound', 9), msg('outbound', 4)];
    expect(countUnansweredAttempts(messages)).toBe(2);
  });

  it('ignora mensajes de actividad y cuerpos vacíos', () => {
    const messages = [
      msg('outbound', 5, { messageType: 'TYPE_ACTIVITY_OPPORTUNITY' }),
      msg('outbound', 3, { body: '   ' }),
    ];
    expect(countUnansweredAttempts(messages)).toBe(0);
  });
});

// ─── decidePlaybookAction: guards ─────────────────────────────────────────────

describe('decidePlaybookAction — guards de coordinación', () => {
  it('ai-pausado gana a todo → no_tocar', () => {
    const deal = mkDeal({ contact: { id: 'c1', name: 'Cliente', tags: ['ai-pausado'] } });
    const d = decidePlaybookAction(deal, [], mkAnalysis());
    expect(d.action).toBe('no_tocar');
  });

  it('cliente esperando respuesta → escalar_a_humano', () => {
    const analysis = mkAnalysis({
      alerts: [
        {
          category: 'no_response',
          severity: 'critical',
          title: 'x',
          detail: 'x',
          metric: 'hours_since_inbound',
          currentValue: 6,
          threshold: 1,
          direction: 'above',
        },
      ],
      hoursSinceLastInbound: 6,
    });
    const d = decidePlaybookAction(mkDeal(), [msg('inbound', 1)], analysis);
    expect(d.action).toBe('escalar_a_humano');
    expect(d.rationale).toContain('esperando respuesta');
  });
});

// ─── decidePlaybookAction: rondas ─────────────────────────────────────────────

describe('decidePlaybookAction — consulta inicial (Ronda 4)', () => {
  it('0-2 intentos → contactar_cliente', () => {
    const messages = [msg('inbound', 9), msg('outbound', 7)];
    const d = decidePlaybookAction(mkDeal(), messages, mkAnalysis());
    expect(d.action).toBe('contactar_cliente');
    expect(d.attempts).toBe(1);
  });

  it('lead sin mensajes → contactar_cliente (primer contacto)', () => {
    const d = decidePlaybookAction(mkDeal(), [], mkAnalysis({ totalMessages: 0 }));
    expect(d.action).toBe('contactar_cliente');
    expect(d.rationale).toContain('sin primer contacto');
  });

  it('3-5 intentos → ultimo_intento', () => {
    const messages = [msg('inbound', 20), msg('outbound', 15), msg('outbound', 10), msg('outbound', 5)];
    const d = decidePlaybookAction(mkDeal(), messages, mkAnalysis());
    expect(d.action).toBe('ultimo_intento');
  });

  it('6+ intentos → mover_a_frio', () => {
    const messages = [
      msg('inbound', 30),
      ...[25, 20, 16, 12, 8, 4].map((n) => msg('outbound', n)),
    ];
    const d = decidePlaybookAction(mkDeal(), messages, mkAnalysis());
    expect(d.action).toBe('mover_a_frio');
  });
});

describe('decidePlaybookAction — cotización (Ronda 3)', () => {
  const deal = mkDeal({ pipelineStageName: 'Calificado' });

  it('sin gestión > 7d → crear_tarea_vendedor con vencimiento', () => {
    const d = decidePlaybookAction(deal, [], mkAnalysis({ daysSinceLastContact: 10 }));
    expect(d.action).toBe('crear_tarea_vendedor');
    expect(d.taskDueInDays).toBe(7);
  });

  it('sin gestión > 21d → mover_a_frio', () => {
    const d = decidePlaybookAction(deal, [], mkAnalysis({ daysSinceLastContact: 30 }));
    expect(d.action).toBe('mover_a_frio');
  });

  it('con gestión reciente → no_tocar', () => {
    const d = decidePlaybookAction(deal, [], mkAnalysis({ daysSinceLastContact: 2 }));
    expect(d.action).toBe('no_tocar');
  });
});

describe('decidePlaybookAction — demo (Rondas 1/2)', () => {
  it('< 7d en demo → contactar_cliente (activación)', () => {
    const deal = mkDeal({ pipelineStageName: 'Demo/Instalado', lastStageChangeAt: daysAgo(3) });
    const d = decidePlaybookAction(deal, [], mkAnalysis());
    expect(d.action).toBe('contactar_cliente');
    expect(d.rationale).toContain('acceso');
  });

  it('7-14d en demo → contactar_cliente (retención)', () => {
    const deal = mkDeal({ pipelineStageName: 'Demo/Plataforma', lastStageChangeAt: daysAgo(10) });
    const d = decidePlaybookAction(deal, [], mkAnalysis());
    expect(d.action).toBe('contactar_cliente');
    expect(d.rationale).toContain('reforzar uso');
  });

  it('> 14d en demo → crear_tarea_vendedor (empujar firma)', () => {
    const deal = mkDeal({ pipelineStageName: 'Demo/Plataforma', lastStageChangeAt: daysAgo(20) });
    const d = decidePlaybookAction(deal, [], mkAnalysis());
    expect(d.action).toBe('crear_tarea_vendedor');
    expect(d.rationale).toContain('firma');
  });
});

describe('decidePlaybookAction — cierre y frío', () => {
  it('negociación estancada → crear_tarea_vendedor', () => {
    const deal = mkDeal({ pipelineStageName: 'Registro Clientes' });
    const d = decidePlaybookAction(deal, [], mkAnalysis({ daysSinceLastContact: 12 }));
    expect(d.action).toBe('crear_tarea_vendedor');
  });

  it('cierre con gestión activa → no_tocar', () => {
    const deal = mkDeal({ pipelineStageName: 'Aceptado' });
    const d = decidePlaybookAction(deal, [], mkAnalysis({ daysSinceLastContact: 1 }));
    expect(d.action).toBe('no_tocar');
  });

  it('Frío → monitorear (reactivación es de Forense)', () => {
    const deal = mkDeal({ pipelineStageName: 'Frio' });
    const d = decidePlaybookAction(deal, [], mkAnalysis());
    expect(d.action).toBe('monitorear');
  });

  it('etapa sin mapeo → monitorear', () => {
    const deal = mkDeal({ pipelineStageName: 'Etapa Rarísima X' });
    const d = decidePlaybookAction(deal, [], mkAnalysis());
    expect(d.action).toBe('monitorear');
    expect(d.stage).toBeNull();
  });
});

// ─── AG-2: nota [AGENTE] y acciones ejecutables ───────────────────────────────

describe('formatAgentNote / EXECUTABLE_ACTIONS', () => {
  it('formatea la bitácora [AGENTE] fecha — acción — detalle', () => {
    const note = formatAgentNote('crear_tarea_vendedor', '10d sin gestión.');
    expect(note).toMatch(/^\[AGENTE\] \d{2}-\d{2}-\d{4} — Crear tarea — 10d sin gestión\.$/);
  });

  it('las acciones que tocan al cliente NO son ejecutables en AG-2', () => {
    expect(EXECUTABLE_ACTIONS).not.toContain('contactar_cliente');
    expect(EXECUTABLE_ACTIONS).not.toContain('ultimo_intento');
    expect(EXECUTABLE_ACTIONS).toContain('mover_a_frio');
    expect(EXECUTABLE_ACTIONS).toContain('crear_tarea_vendedor');
  });
});
