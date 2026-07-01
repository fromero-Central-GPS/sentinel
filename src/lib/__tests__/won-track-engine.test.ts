import { describe, it, expect } from 'vitest';
import {
  extractCommunicationPatterns,
  extractBusinessFeatures,
  analyzeWonDeal,
  generateWonTrackOutput,
  DEFAULT_FIELD_MAP,
} from '../won-track-engine';
import type { CanonicalMessage, Deal } from '../types';

// Base de tiempo fija — los cálculos de Won Track no dependen de `now()`.
const T0 = new Date('2026-01-01T12:00:00.000Z').getTime();
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();

function msg(
  direction: 'inbound' | 'outbound',
  offsetMin: number,
  body = 'hola',
): CanonicalMessage {
  return {
    id: `${direction}-${offsetMin}`,
    direction,
    body,
    messageType: 'TYPE_WHATSAPP',
    dateAdded: iso(offsetMin),
  };
}

function baseDeal(id: string): Deal {
  return {
    id,
    name: id,
    status: 'won',
    monetaryValue: 1_000_000,
    pipelineName: 'Ventas',
    pipelineStageName: 'Ganado',
    createdAt: iso(0),
    updatedAt: iso(5 * 24 * 60), // +5 días
    contactId: `c-${id}`,
    contact: { id: `c-${id}`, name: id },
  };
}

/** Conversación con un único par inbound→outbound separado `rt` minutos. */
function dealWithResponse(id: string, rt: number) {
  const deal = baseDeal(id);
  const messages = [msg('inbound', 0), msg('outbound', rt)];
  return analyzeWonDeal(deal, messages);
}

describe('extractCommunicationPatterns — saneamiento de tiempos de respuesta', () => {
  it('mide el tiempo hasta la primera respuesta y deduplica inbounds consecutivos', () => {
    const messages = [
      msg('inbound', 0),
      msg('outbound', 10), // resp 10
      msg('inbound', 30),
      msg('inbound', 35), // consecutivo → no abre un nuevo pendiente
      msg('outbound', 50), // resp 20 (desde el primer inbound sin contestar)
    ];
    const p = extractCommunicationPatterns(messages);
    expect(p.avgResponseMinutes).toBe(15);
    expect(p.medianResponseMinutes).toBe(15);
    expect(p.maxResponseMinutes).toBe(20);
    expect(p.responseUnder30min).toBe(2);
  });

  it('descarta respuestas de 0min (timestamps idénticos) y outliers > 3 días', () => {
    const messages = [
      msg('inbound', 0),
      msg('outbound', 10), // resp 10 ✓
      msg('inbound', 60),
      msg('outbound', 60), // resp 0 → descartado
      msg('inbound', 120),
      msg('outbound', 120 + 5 * 24 * 60), // resp 5 días → outlier descartado
    ];
    const p = extractCommunicationPatterns(messages);
    expect(p.medianResponseMinutes).toBe(10);
    expect(p.maxResponseMinutes).toBe(10);
  });

  it('ignora mensajes con timestamps inválidos', () => {
    const messages = [
      { ...msg('inbound', 0), dateAdded: 'no-es-fecha' },
      msg('inbound', 5),
      msg('outbound', 25), // resp 20
    ];
    const p = extractCommunicationPatterns(messages);
    expect(p.medianResponseMinutes).toBe(20);
  });
});

describe('extractBusinessFeatures — custom fields configurables por tenant', () => {
  const dealWithFields = (planId: string, equiposId: string): Deal => ({
    ...baseDeal('CF'),
    customFields: [
      { id: planId, fieldValueString: 'Pro Anual', type: 'TEXT' },
      { id: equiposId, fieldValueNumber: 7, type: 'NUMERICAL' },
    ],
  });

  it('lee los custom fields según el fieldMap del tenant', () => {
    const f = extractBusinessFeatures(dealWithFields('tenantPlan', 'tenantEquipos'), {
      plan: 'tenantPlan',
      equipos: 'tenantEquipos',
    });
    expect(f.planType).toBe('Pro Anual');
    expect(f.planCategory).toBe('anual');
    expect(f.equipmentCount).toBe(7);
  });

  it('cae a los IDs default (CentralGPS) cuando no hay mapeo', () => {
    const f = extractBusinessFeatures(
      dealWithFields(DEFAULT_FIELD_MAP.plan!, DEFAULT_FIELD_MAP.equipos!),
    );
    expect(f.planType).toBe('Pro Anual');
    expect(f.equipmentCount).toBe(7);
  });

  it('resuelve por-campo: un mapa parcial usa el default en lo que falte', () => {
    const f = extractBusinessFeatures(dealWithFields('tenantPlan', DEFAULT_FIELD_MAP.equipos!), {
      plan: 'tenantPlan',
    });
    expect(f.planType).toBe('Pro Anual'); // del mapa
    expect(f.equipmentCount).toBe(7); // del default
  });
});

describe('analyzeWonDeal — factors (contrato WIN_FACTORS) 1:1 con winningFormula', () => {
  it('emite códigos de taxonomía derivados de las señales numéricas', () => {
    const deal: Deal = {
      ...baseDeal('WF'),
      updatedAt: iso(3 * 24 * 60), // cierre en 3d → fast_close
      contact: { id: 'c', name: 'Acme', tags: ['10 a 49 vehículos'] },
      attributions: [{ utmSessionSource: 'whatsapp', isFirst: true }], // preferred_channel
    };
    const d = analyzeWonDeal(deal, [msg('inbound', 0), msg('outbound', 5)]); // fast_response
    expect(d.factors).toContain('fast_close');
    expect(d.factors).toContain('fast_response');
    expect(d.factors).toContain('preferred_channel');
    // factors y winningFormula salen de la misma fuente → misma longitud.
    expect(d.factors).toHaveLength(d.winningFormula.length);
  });
});

describe('computeSuccessThresholds — thresholds acotados (regresión bug CentralGPS)', () => {
  it('clampa ideal/peligro aunque un deal tenga una mediana enorme', () => {
    // Medianas por deal: 15, 45, 2000 (33h, como el bug real, pero < 3 días).
    const deals = [
      dealWithResponse('A', 15),
      dealWithResponse('B', 45),
      dealWithResponse('C', 2000),
    ];
    const out = generateWonTrackOutput(
      deals,
      deals.map((d) => d.features),
      deals.map((d) => d.patterns),
    );
    const t = out.thresholds;
    // Ideal = p50 de medianas = 45 (acotado a [5,120]).
    expect(t.idealResponseThreshold).toBe(45);
    // Peligro = p90 (≈1609) pero capeado a 8h = 480 min — no las 94h del bug.
    expect(t.dangerResponseThreshold).toBe(480);
    expect(t.idealResponseThreshold).toBeLessThanOrEqual(120);
    expect(t.dangerResponseThreshold).toBeGreaterThan(t.idealResponseThreshold);
  });

  it('cae a defaults cuando no hay datos de respuesta utilizables', () => {
    const deal = analyzeWonDeal(baseDeal('Z'), []); // sin mensajes
    const out = generateWonTrackOutput([deal], [deal.features], [deal.patterns]);
    expect(out.thresholds.idealResponseThreshold).toBe(30);
    expect(out.thresholds.dangerResponseThreshold).toBe(120);
  });
});
