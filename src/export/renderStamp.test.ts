import { describe, expect, it } from 'vitest';
import { compositeOntoCanvas, cropWithForcedBackground } from './renderStamp';
import { createSolidImage, fillRect } from '../split/testUtils';

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
});

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
