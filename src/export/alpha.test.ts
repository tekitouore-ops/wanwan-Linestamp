import { describe, expect, it } from 'vitest';
import { keepOriginalAlpha, removeBackground } from './alpha';
import { createSolidImage, fillRect } from '../split/testUtils';

describe('removeBackground', () => {
  it('外周から連結する背景色領域を透明にする', () => {
    const image = createSolidImage(10, 10, { r: 255, g: 255, b: 255 });
    fillRect(image, { x: 3, y: 3, width: 4, height: 4 }, { r: 0, g: 0, b: 0 });

    const result = removeBackground(image, { r: 255, g: 255, b: 255 }, 20, 0);

    // 外周(背景)は透明
    expect(result.data[3]).toBe(0);
    // 中心(被写体)は不透明
    const centerIndex = (5 * 10 + 5) * 4;
    expect(result.data[centerIndex + 3]).toBe(255);
  });

  it('外周と繋がっていない内部の背景色領域(被写体内部の白など)は保持する', () => {
    const image = createSolidImage(20, 20, { r: 255, g: 255, b: 255 });
    // 被写体(黒の輪)の内側に、外周と繋がらない白い穴を作る
    fillRect(image, { x: 5, y: 5, width: 10, height: 10 }, { r: 0, g: 0, b: 0 });
    fillRect(image, { x: 8, y: 8, width: 4, height: 4 }, { r: 255, g: 255, b: 255 });

    const result = removeBackground(image, { r: 255, g: 255, b: 255 }, 20, 0);

    const holeIndex = (10 * 20 + 10) * 4;
    expect(result.data[holeIndex + 3]).toBe(255); // 孤立した白い穴は透明にならない

    const outsideIndex = (1 * 20 + 1) * 4;
    expect(result.data[outsideIndex + 3]).toBe(0); // 外周の背景は透明になる
  });

  it('feather > 0 のとき、境界付近のアルファが段階的に変化する', () => {
    const image = createSolidImage(20, 20, { r: 255, g: 255, b: 255 });
    fillRect(image, { x: 5, y: 5, width: 10, height: 10 }, { r: 0, g: 0, b: 0 });

    const result = removeBackground(image, { r: 255, g: 255, b: 255 }, 20, 2);

    // 被写体の中心は完全不透明
    const centerIndex = (10 * 20 + 10) * 4;
    expect(result.data[centerIndex + 3]).toBe(255);

    // 被写体のすぐ内側のエッジ付近は、0より大きく255未満の半透明になる
    const edgeIndex = (5 * 20 + 5) * 4;
    const edgeAlpha = result.data[edgeIndex + 3] ?? 0;
    expect(edgeAlpha).toBeGreaterThan(0);
    expect(edgeAlpha).toBeLessThan(255);

    // 背景は完全に透明
    const bgIndex = (1 * 20 + 1) * 4;
    expect(result.data[bgIndex + 3]).toBe(0);
  });

  it('しきい値を超えない微妙な色差は背景として透明にする', () => {
    const image = createSolidImage(10, 10, { r: 250, g: 250, b: 250 });
    const result = removeBackground(image, { r: 255, g: 255, b: 255 }, 20, 0);
    expect(result.data[3]).toBe(0);
  });
});

describe('keepOriginalAlpha', () => {
  it('フラッドフィルを行わず、元のアルファ値をそのまま複製する(透過画像モード用)', () => {
    const image = createSolidImage(4, 4, { r: 10, g: 20, b: 30, a: 128 });
    fillRect(image, { x: 1, y: 1, width: 1, height: 1 }, { r: 0, g: 0, b: 0, a: 0 });

    const result = keepOriginalAlpha(image);

    expect(Array.from(result.data)).toEqual(Array.from(image.data));
    expect(result.data).not.toBe(image.data); // 複製であり、元の配列と同一参照ではない
  });
});
