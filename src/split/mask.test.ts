import { describe, expect, it } from 'vitest';
import { buildForegroundMask, estimateBackgroundColor, removeNoise } from './mask';
import { createSolidImage, fillRect } from './testUtils';

describe('estimateBackgroundColor', () => {
  it('外周が単色なら、その色を背景として推定する', () => {
    const image = createSolidImage(100, 80, { r: 255, g: 255, b: 255 });
    fillRect(image, { x: 30, y: 25, width: 40, height: 30 }, { r: 10, g: 20, b: 30 });
    const bg = estimateBackgroundColor(image);
    expect(bg).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('外周の一部に被写体がはみ出していても中央値で頑健に推定する', () => {
    const image = createSolidImage(100, 80, { r: 255, g: 255, b: 255 });
    // 外周8px幅のごく一部だけを被写体色にする(中央値には影響しない程度)。
    fillRect(image, { x: 0, y: 0, width: 3, height: 3 }, { r: 0, g: 0, b: 0 });
    const bg = estimateBackgroundColor(image);
    expect(bg).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('buildForegroundMask', () => {
  it('背景色との差がしきい値を超える画素だけを前景とする', () => {
    const image = createSolidImage(10, 10, { r: 255, g: 255, b: 255 });
    fillRect(image, { x: 2, y: 2, width: 3, height: 3 }, { r: 0, g: 0, b: 0 });
    const mask = buildForegroundMask(image, { r: 255, g: 255, b: 255 }, 20);

    // (2,2)-(4,4) の9画素が前景、それ以外は背景
    let foregroundCount = 0;
    for (let i = 0; i < mask.length; i += 1) {
      foregroundCount += mask[i] ?? 0;
    }
    expect(foregroundCount).toBe(9);
    expect(mask[2 * 10 + 2]).toBe(1);
    expect(mask[0]).toBe(0);
  });

  it('しきい値以下の微妙な差は背景として扱う', () => {
    const image = createSolidImage(5, 5, { r: 250, g: 250, b: 250 });
    fillRect(image, { x: 1, y: 1, width: 1, height: 1 }, { r: 260, g: 250, b: 250 });
    const mask = buildForegroundMask(image, { r: 255, g: 255, b: 255 }, 20);
    expect(mask.every((v) => v === 0)).toBe(true);
  });
});

describe('removeNoise', () => {
  it('最小面積未満の孤立した成分を除去する', () => {
    const width = 20;
    const height = 20;
    const mask = new Uint8Array(width * height);
    // 大きな成分(5x5=25画素)
    for (let y = 2; y < 7; y += 1) {
      for (let x = 2; x < 7; x += 1) {
        mask[y * width + x] = 1;
      }
    }
    // 小さなノイズ(1画素)
    mask[15 * width + 15] = 1;

    const cleaned = removeNoise(mask, width, height, 10);

    expect(cleaned[2 * width + 2]).toBe(1);
    expect(cleaned[6 * width + 6]).toBe(1);
    expect(cleaned[15 * width + 15]).toBe(0);
  });

  it('面積が最小面積以上の成分は残す', () => {
    const width = 10;
    const height = 10;
    const mask = new Uint8Array(width * height);
    for (let y = 2; y < 5; y += 1) {
      for (let x = 2; x < 5; x += 1) {
        mask[y * width + x] = 1;
      }
    }
    const cleaned = removeNoise(mask, width, height, 9);
    let count = 0;
    for (let i = 0; i < cleaned.length; i += 1) {
      count += cleaned[i] ?? 0;
    }
    expect(count).toBe(9);
  });
});
