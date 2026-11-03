import { describe, expect, it } from 'vitest';
import {
  compositeOntoCanvas,
  computeEffectiveFrame,
  computeStampWarnings,
  cropWithForcedBackground,
} from './renderStamp';
import { createSolidImage, fillRect } from '../split/testUtils';
import { DEFAULT_GLOBAL_SETTINGS, DEFAULT_STAMP_ADJUST } from '../split/types';

describe('cropWithForcedBackground', () => {
  it('枠の範囲+余白を切り出し、枠外(余白部分)は背景色で塗りつぶす', () => {
    const image = createSolidImage(40, 40, { r: 0, g: 0, b: 0 });
    fillRect(image, { x: 10, y: 10, width: 10, height: 10 }, { r: 200, g: 100, b: 50 });

    const cropped = cropWithForcedBackground(image, { x: 10, y: 10, width: 10, height: 10 }, 5, {
      r: 255,
      g: 255,
      b: 255,
    });

    expect(cropped.width).toBe(20);
    expect(cropped.height).toBe(20);

    // 中心(枠の中、=元の被写体色)はそのまま
    const centerIndex = (10 * 20 + 10) * 4;
    expect(cropped.data[centerIndex]).toBe(200);
    expect(cropped.data[centerIndex + 1]).toBe(100);
    expect(cropped.data[centerIndex + 2]).toBe(50);

    // 余白部分(枠外)は、元が黒でも強制的に背景色(白)になる
    const marginIndex = (1 * 20 + 1) * 4;
    expect(cropped.data[marginIndex]).toBe(255);
    expect(cropped.data[marginIndex + 1]).toBe(255);
    expect(cropped.data[marginIndex + 2]).toBe(255);
  });

  it('画像の外にはみ出す範囲も背景色で埋める', () => {
    const image = createSolidImage(10, 10, { r: 0, g: 0, b: 0 });
    const cropped = cropWithForcedBackground(image, { x: 0, y: 0, width: 10, height: 10 }, 5, {
      r: 255,
      g: 255,
      b: 255,
    });
    // 左上(画像の外)は背景色
    expect(cropped.data[0]).toBe(255);
    expect(cropped.data[1]).toBe(255);
    expect(cropped.data[2]).toBe(255);
  });

  it('backgroundMode: transparent のとき、枠外(余白部分)は透明にする', () => {
    const image = createSolidImage(40, 40, { r: 0, g: 0, b: 0, a: 255 });
    const cropped = cropWithForcedBackground(
      image,
      { x: 10, y: 10, width: 10, height: 10 },
      5,
      { r: 255, g: 255, b: 255 },
      'transparent',
    );
    const marginIndex = (1 * 20 + 1) * 4;
    expect(cropped.data[marginIndex + 3]).toBe(0);

    // 枠内(元の画素)のアルファはそのまま保持する
    const centerIndex = (10 * 20 + 10) * 4;
    expect(cropped.data[centerIndex + 3]).toBe(255);
  });
});

// renderStamp()自体はCanvas(resizeImageDataLike)に依存するためNode環境のVitestでは検証できない
// (DOM依存部分はPlaywrightで確認する、プロジェクトの既存方針)。backgroundModeの分岐ロジックは、
// 依存の少ないcropWithForcedBackground(上記)とexport/alpha.test.tsのkeepOriginalAlphaで検証する。

describe('compositeOntoCanvas', () => {
  it('指定した位置に画像を貼り付け、範囲外は透明のままにする', () => {
    const image = createSolidImage(4, 4, { r: 10, g: 20, b: 30, a: 255 });
    const result = compositeOntoCanvas(image, 10, 10, 2, 3);

    expect(result.width).toBe(10);
    expect(result.height).toBe(10);

    const pastedIndex = (3 * 10 + 2) * 4;
    expect(result.data[pastedIndex]).toBe(10);
    expect(result.data[pastedIndex + 1]).toBe(20);
    expect(result.data[pastedIndex + 2]).toBe(30);
    expect(result.data[pastedIndex + 3]).toBe(255);

    // 貼り付け範囲外は透明
    expect(result.data[3]).toBe(0);
  });

  it('負のオフセットではみ出す部分は切り詰める', () => {
    const image = createSolidImage(4, 4, { r: 1, g: 2, b: 3, a: 255 });
    const result = compositeOntoCanvas(image, 10, 10, -2, -2);
    // (0,0)は元画像の(2,2)に相当し、範囲内なので描画される
    expect(result.data[3]).toBe(255);
  });
});

describe('computeEffectiveFrame', () => {
  it('切り抜き量(上右下左)を枠から差し引いた範囲を返す', () => {
    const frame = { x: 10, y: 20, width: 100, height: 80 };
    const crop = { top: 5, right: 10, bottom: 15, left: 20 };
    const effective = computeEffectiveFrame(frame, crop);
    expect(effective).toEqual({ x: 30, y: 25, width: 70, height: 60 });
  });

  it('切り抜きがない場合は枠そのまま', () => {
    const frame = { x: 0, y: 0, width: 50, height: 50 };
    const effective = computeEffectiveFrame(frame, { top: 0, right: 0, bottom: 0, left: 0 });
    expect(effective).toEqual(frame);
  });

  it('切り抜きすぎても最小1pxは保つ', () => {
    const frame = { x: 0, y: 0, width: 10, height: 10 };
    const effective = computeEffectiveFrame(frame, {
      top: 100,
      right: 100,
      bottom: 100,
      left: 100,
    });
    expect(effective.width).toBeGreaterThanOrEqual(1);
    expect(effective.height).toBeGreaterThanOrEqual(1);
  });
});

describe('computeStampWarnings', () => {
  it('標準設定では警告が出ない', () => {
    const frame = { x: 0, y: 0, width: 350, height: 300 };
    const warnings = computeStampWarnings(frame, DEFAULT_STAMP_ADJUST, DEFAULT_GLOBAL_SETTINGS);
    expect(warnings.isUpscaled).toBe(false);
    expect(warnings.isOverflowing).toBe(false);
  });

  it('被写体が小さいと拡大率が高くなり解像度不足警告が出る', () => {
    const frame = { x: 0, y: 0, width: 50, height: 50 };
    const warnings = computeStampWarnings(frame, DEFAULT_STAMP_ADJUST, DEFAULT_GLOBAL_SETTINGS);
    expect(warnings.isUpscaled).toBe(true);
  });

  it('大きなオフセットを指定すると、はみ出し警告が出る', () => {
    const frame = { x: 0, y: 0, width: 350, height: 300 };
    const adjust = { ...DEFAULT_STAMP_ADJUST, offsetX: 100 };
    const warnings = computeStampWarnings(frame, adjust, DEFAULT_GLOBAL_SETTINGS);
    expect(warnings.isOverflowing).toBe(true);
  });

  it('被写体自体は安全領域にぴったり収まっていても、縁フチがキャンバス外まで膨張すればはみ出し警告が出る', () => {
    // 内側余白(既定10px)ぴったりに被写体を配置した状態(frame=安全領域と同サイズ)。
    const frame = { x: 0, y: 0, width: 350, height: 300 };
    const adjust = { ...DEFAULT_STAMP_ADJUST, outline: 12 };
    const warnings = computeStampWarnings(frame, adjust, DEFAULT_GLOBAL_SETTINGS);
    expect(warnings.isOverflowing).toBe(true);
  });

  it('縁フチが内側余白の範囲内に収まる程度なら、はみ出し警告は出ない', () => {
    const frame = { x: 0, y: 0, width: 350, height: 300 };
    const adjust = { ...DEFAULT_STAMP_ADJUST, outline: 2 };
    const warnings = computeStampWarnings(frame, adjust, DEFAULT_GLOBAL_SETTINGS);
    expect(warnings.isOverflowing).toBe(false);
  });
});
