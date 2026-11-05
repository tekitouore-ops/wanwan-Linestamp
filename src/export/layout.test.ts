import { describe, expect, it } from 'vitest';
import { computeLayout, roundToEven, type LayoutSettings } from './layout';

const BASE_SETTINGS: LayoutSettings = {
  outputWidth: 370,
  outputHeight: 320,
  innerMargin: 10,
  align: 'center',
  allowUpscale: true,
  scalePercent: 100,
  offsetX: 0,
  offsetY: 0,
};

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
  it('余白を除いた内側に収まる最大倍率を基準に配置する(拡大率100%・中央揃え)', () => {
    // 出力370x320、余白10なので内側は350x300。被写体350x300ならちょうど収まる(倍率1)。
    const result = computeLayout(350, 300, BASE_SETTINGS);
    expect(result.scale).toBeCloseTo(1);
    expect(result.drawWidth).toBeCloseTo(350);
    expect(result.drawHeight).toBeCloseTo(300);
    expect(result.drawX).toBeCloseTo(10);
    expect(result.drawY).toBeCloseTo(10);
    expect(result.isOverflowing).toBe(false);
  });

  it('被写体が小さい場合は拡大して内側いっぱいに収める', () => {
    // 内側350x300、被写体100x100(正方形)なら、高さ制約(300)で頭打ちになり倍率3。
    const result = computeLayout(100, 100, BASE_SETTINGS);
    expect(result.scale).toBeCloseTo(3);
    expect(result.drawWidth).toBeCloseTo(300);
    expect(result.drawHeight).toBeCloseTo(300);
  });

  it('scalePercentをベース倍率に掛け合わせる', () => {
    const settings = { ...BASE_SETTINGS, scalePercent: 120 };
    const result = computeLayout(350, 300, settings);
    expect(result.scale).toBeCloseTo(1.2);
  });

  it('オフセットが配置位置にそのまま加算される', () => {
    const settings = { ...BASE_SETTINGS, offsetX: 15, offsetY: -5 };
    const base = computeLayout(350, 300, BASE_SETTINGS);
    const offset = computeLayout(350, 300, settings);
    expect(offset.drawX).toBeCloseTo(base.drawX + 15);
    expect(offset.drawY).toBeCloseTo(base.drawY - 5);
  });

  it('下揃えのとき、被写体の下端が下余白の位置に揃う', () => {
    const settings = { ...BASE_SETTINGS, align: 'bottom' as const };
    const result = computeLayout(100, 100, settings);
    expect(result.drawY + result.drawHeight).toBeCloseTo(
      settings.outputHeight - settings.innerMargin,
    );
  });

  it('大きな拡大率を指定すると内側の矩形からはみ出すことを許容する(クランプしない)', () => {
    const settings = { ...BASE_SETTINGS, scalePercent: 150 };
    const result = computeLayout(350, 300, settings);
    const innerWidth = settings.outputWidth - settings.innerMargin * 2;
    expect(result.drawWidth).toBeGreaterThan(innerWidth);
  });

  it('allowUpscaleがfalseのとき、原寸(1倍)を超えて拡大しない', () => {
    const settings = { ...BASE_SETTINGS, allowUpscale: false };
    const result = computeLayout(100, 100, settings);
    expect(result.scale).toBeCloseTo(1);
  });

  it('出力キャンバスの外にはみ出す場合isOverflowingがtrueになる', () => {
    const settings = { ...BASE_SETTINGS, offsetX: 100 };
    const result = computeLayout(350, 300, settings);
    expect(result.isOverflowing).toBe(true);
  });
});
