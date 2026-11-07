import { describe, expect, it } from 'vitest';
import {
  PngFormatError,
  canInspectPixels,
  decodePixels,
  extractAlphaChannel,
  hasAlphaChannel,
  parsePng,
} from './png.mjs';
import { encodeRgbaPng, makeOpaqueRgbPng } from './testFixtures/encodePng.mjs';

function makeGradientRgba(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    rgba[p * 4] = p % 256;
    rgba[p * 4 + 1] = (p * 3) % 256;
    rgba[p * 4 + 2] = (p * 7) % 256;
    rgba[p * 4 + 3] = (p * 5) % 256;
  }
  return rgba;
}

describe('PNGデコード(フィルタ種別ごとの展開結果)', () => {
  const width = 11;
  const height = 9;
  const rgba = makeGradientRgba(width, height);

  it.each([0, 1, 2, 3, 4])('フィルタタイプ%iで展開した結果が、元の画素データと一致する', (filterType) => {
    const buffer = encodeRgbaPng(width, height, rgba, filterType);
    const parsed = parsePng(buffer);
    const pixels = decodePixels(parsed);
    for (let p = 0; p < width * height; p += 1) {
      expect(pixels[p * 4]).toBe(rgba[p * 4]);
      expect(pixels[p * 4 + 1]).toBe(rgba[p * 4 + 1]);
      expect(pixels[p * 4 + 2]).toBe(rgba[p * 4 + 2]);
      expect(pixels[p * 4 + 3]).toBe(rgba[p * 4 + 3]);
    }
  });
});

describe('extractAlphaChannel', () => {
  it('カラータイプ6(RGBA)から、アルファ値だけを取り出せる', () => {
    const width = 4;
    const height = 3;
    const rgba = makeGradientRgba(width, height);
    const buffer = encodeRgbaPng(width, height, rgba, 0);
    const parsed = parsePng(buffer);
    const pixels = decodePixels(parsed);
    const alpha = extractAlphaChannel(parsed, pixels);
    for (let p = 0; p < width * height; p += 1) {
      expect(alpha[p]).toBe(rgba[p * 4 + 3]);
    }
  });
});

describe('hasAlphaChannel / canInspectPixels', () => {
  it('RGBA(カラータイプ6)は、アルファを持ち、ピクセル検査も可能', () => {
    const buffer = encodeRgbaPng(4, 4, makeGradientRgba(4, 4), 0);
    const parsed = parsePng(buffer);
    expect(hasAlphaChannel(parsed)).toBe(true);
    expect(canInspectPixels(parsed)).toBe(true);
  });

  it('RGB(カラータイプ2、tRNS無し)は、アルファを持たず、ピクセル検査も不可', () => {
    const buffer = makeOpaqueRgbPng(4, 4);
    const parsed = parsePng(buffer);
    expect(hasAlphaChannel(parsed)).toBe(false);
    expect(canInspectPixels(parsed)).toBe(false);
  });
});

describe('不正なPNGの扱い', () => {
  it('シグネチャが無いデータは、PngFormatErrorを投げる', () => {
    expect(() => parsePng(Buffer.from('not a png'))).toThrow(PngFormatError);
  });

  it('IHDRが無いデータは、PngFormatErrorを投げる', () => {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(() => parsePng(signature)).toThrow(PngFormatError);
  });
});
