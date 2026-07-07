import { describe, it, expect } from 'vitest';
import { computeFactorLift } from '../comparative';
import type { WinFactor } from '../taxonomy';

describe('computeFactorLift', () => {
  it('marca lift > 1 para un factor más común en ganados que en perdidos', () => {
    // fast_response en 8/10 ganados y 2/10 perdidos → discrimina.
    const won: WinFactor[][] = Array.from({ length: 10 }, (_, i) =>
      i < 8 ? (['fast_response'] as WinFactor[]) : [],
    );
    const lost: WinFactor[][] = Array.from({ length: 10 }, (_, i) =>
      i < 2 ? (['fast_response'] as WinFactor[]) : [],
    );
    const lifts = computeFactorLift(won, lost);
    const fr = lifts.find((l) => l.factor === 'fast_response')!;
    expect(fr.wonRate).toBeCloseTo(0.8, 5);
    expect(fr.lostRate).toBeCloseTo(0.2, 5);
    expect(fr.lift).toBeGreaterThan(1.5);
  });

  it('lift ≈ 1 cuando el factor aparece igual en ganados y perdidos (no discrimina)', () => {
    const won: WinFactor[][] = Array.from({ length: 10 }, () => ['annual_plan'] as WinFactor[]);
    const lost: WinFactor[][] = Array.from({ length: 10 }, () => ['annual_plan'] as WinFactor[]);
    const lifts = computeFactorLift(won, lost);
    const ap = lifts.find((l) => l.factor === 'annual_plan')!;
    expect(ap.lift).toBeCloseTo(1, 1);
  });

  it('no divide por cero cuando el factor nunca aparece en perdidos', () => {
    const won: WinFactor[][] = Array.from({ length: 5 }, () => ['voice_notes'] as WinFactor[]);
    const lost: WinFactor[][] = Array.from({ length: 5 }, () => []);
    const lifts = computeFactorLift(won, lost);
    const vn = lifts.find((l) => l.factor === 'voice_notes')!;
    expect(Number.isFinite(vn.lift)).toBe(true);
    expect(vn.lift).toBeGreaterThan(1);
  });

  it('omite factores ausentes en ambos lados y ordena por lift desc', () => {
    const won: WinFactor[][] = [['fast_response'], ['high_engagement', 'fast_response']];
    const lost: WinFactor[][] = [['high_engagement']];
    const lifts = computeFactorLift(won, lost);
    // Solo aparecen los factores presentes en algún deal.
    expect(lifts.every((l) => l.wonCount > 0 || l.lostCount > 0)).toBe(true);
    // Orden descendente por lift.
    for (let i = 1; i < lifts.length; i++) {
      expect(lifts[i - 1].lift).toBeGreaterThanOrEqual(lifts[i].lift);
    }
  });
});
