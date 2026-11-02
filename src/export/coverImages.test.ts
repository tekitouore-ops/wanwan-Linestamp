import { describe, expect, it } from 'vitest';
import { computeMarginForSize } from './coverImages';
import { DEFAULT_GLOBAL_SETTINGS } from '../split/types';

describe('computeMarginForSize', () => {
  it('出力幅に対する余白の比率を保って、別サイズの余白を計算する', () => {
    // DEFAULT_GLOBAL_SETTINGS: outputWidth=370, innerMargin=10 → 比率 10/370
    const marginForMain = computeMarginForSize(DEFAULT_GLOBAL_SETTINGS, 240);
    expect(marginForMain).toBe(Math.round((10 / 370) * 240));
  });

  it('比率がゼロなら余白もゼロ', () => {
    const settings = { ...DEFAULT_GLOBAL_SETTINGS, innerMargin: 0 };
    expect(computeMarginForSize(settings, 240)).toBe(0);
  });

  it('負の値にはならない', () => {
    const settings = { ...DEFAULT_GLOBAL_SETTINGS, innerMargin: 1 };
    expect(computeMarginForSize(settings, 1)).toBeGreaterThanOrEqual(0);
  });
});
