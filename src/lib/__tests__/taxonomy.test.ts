import { describe, it, expect } from 'vitest';
import {
  LOSS_REASONS,
  FUNNEL_STAGES,
  RISK_SIGNALS,
  RISK_SEVERITIES,
  INTENT_SIGNALS,
  WIN_FACTORS,
  INTENT_CLASSES,
} from '../taxonomy';

describe('taxonomy', () => {
  const vocabs = {
    LOSS_REASONS,
    FUNNEL_STAGES,
    RISK_SIGNALS,
    RISK_SEVERITIES,
    INTENT_SIGNALS,
    WIN_FACTORS,
    INTENT_CLASSES,
  };

  it('cada vocabulario es no vacío y sin duplicados', () => {
    for (const [name, vocab] of Object.entries(vocabs)) {
      expect(vocab.length, name).toBeGreaterThan(0);
      expect(new Set(vocab).size, name).toBe(vocab.length);
    }
  });

  it('preserva las cadenas que ya usaban los motores (contratos externos)', () => {
    // Live Opp emite estas categorías de riesgo.
    expect(RISK_SIGNALS).toContain('no_response');
    expect(RISK_SIGNALS).toContain('competitor_risk');
    // Forense clasifica con estas razones de pérdida.
    expect(LOSS_REASONS).toContain('cliente_explorando');
    expect(LOSS_REASONS).toContain('desconocido');
    expect(RISK_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low', 'none']);
  });
});
