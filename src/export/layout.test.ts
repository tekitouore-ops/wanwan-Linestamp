import { describe, expect, it } from 'vitest';
import { computeLayout, roundToEven } from './layout';
import { DEFAULT_RENDER_SETTINGS } from './types';

describe('roundToEven', () => {
  it('奇数は1つ下の偶数に切り下げる', () => {
    expect(roundToEven(371)).toBe(370);
    expect(roundToEven(321)).toBe(320);
  });

  it('偶数はそのまま', () => {
    expect(roundToEven(370)).toBe(370);
  });

  it('小数は切り捨ててから偶数に揃える', () => {
    expect(roundToEven(369.8)).toBe(368);
  });
});

describe('computeLayout', () => {
  it('余白を除いた内側に収まる最大倍率を基準に配置する(拡大率1.0・中央揃え)', () => {
    // 出力370x320、余白10なので内側は350x300。被写体350x300ならちょうど収まる(倍率1)。
    const result = computeLayout(350, 300, DEFAULT_RENDER_SETTINGS);
    expect(result.scale).toBeCloseTo(1);
    expect(result.drawWidth).toBeCloseTo(350);
    expect(result.drawHeight).toBeCloseTo(300);
    expect(result.drawX).toBeCloseTo(10);
    expect(result.drawY).toBeCloseTo(10);
    expect(result.isUpscaled).toBe(false);
  });

  it('被写体が小さい場合は拡大して内側いっぱいに収める', () => {
    // 内側350x300、被写体100x100(正方形)なら、高さ制約(300)で頭打ちになり倍率3。
    const result = computeLayout(100, 100, DEFAULT_RENDER_SETTINGS);
    expect(result.scale).toBeCloseTo(3);
    expect(result.drawWidth).toBeCloseTo(300);
    expect(result.drawHeight).toBeCloseTo(300);
  });

  it('設定の拡大率(settings.scale)をベース倍率に掛け合わせる', () => {
    const settings = { ...DEFAULT_RENDER_SETTINGS, scale: 1.2 };
    const result = computeLayout(350, 300, settings);
    expect(result.scale).toBeCloseTo(1.2);
  });

  it('オフセットが配置位置にそのまま加算される', () => {
    const settings = { ...DEFAULT_RENDER_SETTINGS, offsetX: 15, offsetY: -5 };
    const base = computeLayout(350, 300, DEFAULT_RENDER_SETTINGS);
    const offset = computeLayout(350, 300, settings);
    expect(offset.drawX).toBeCloseTo(base.drawX + 15);
    expect(offset.drawY).toBeCloseTo(base.drawY - 5);
  });

  it('下揃えのとき、被写体の下端が下余白の位置に揃う', () => {
    const settings = { ...DEFAULT_RENDER_SETTINGS, align: 'bottom' as const };
    const result = computeLayout(100, 100, settings);
    expect(result.drawY + result.drawHeight).toBeCloseTo(
      settings.outputHeight - settings.marginBottom,
    );
  });

  it('拡大率が1.3倍を超えるとisUpscaledがtrueになる', () => {
    const settings = { ...DEFAULT_RENDER_SETTINGS, scale: 1.5 };
    // 内側350x300の正方形被写体なら基準倍率は300/100=3のような大きな値になってしまうため、
    // 基準倍率がちょうど1になるよう被写体を350x300にして、設定scale=1.5をそのまま掛ける。
    const result = computeLayout(350, 300, settings);
    expect(result.scale).toBeCloseTo(1.5);
    expect(result.isUpscaled).toBe(true);
  });

  it('大きな拡大率を指定すると内側の矩形からはみ出すことを許容する(クランプしない)', () => {
    const settings = { ...DEFAULT_RENDER_SETTINGS, scale: 1.5 };
    const result = computeLayout(350, 300, settings);
    const innerWidth = settings.outputWidth - settings.marginLeft - settings.marginRight;
    expect(result.drawWidth).toBeGreaterThan(innerWidth);
  });
});
