import { describe, expect, it } from 'vitest';
import { applyEdgeFix } from './edge';
import type { ImageDataLike } from '../shared/types';

function createTransparentImage(width: number, height: number): ImageDataLike {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function fillOpaqueSquare(
  image: ImageDataLike,
  x: number,
  y: number,
  size: number,
  color: number,
): void {
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      const i = ((y + dy) * image.width + (x + dx)) * 4;
      image.data[i] = color;
      image.data[i + 1] = color;
      image.data[i + 2] = color;
      image.data[i + 3] = 255;
    }
  }
}

function alphaAt(image: ImageDataLike, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

describe('applyEdgeFix', () => {
  it('amountPxが0のときは変化しない', () => {
    const image = createTransparentImage(10, 10);
    fillOpaqueSquare(image, 3, 3, 4, 100);
    const result = applyEdgeFix(image, 0);
    expect(result).toEqual(image);
  });

  it('正の値で被写体を指定px分だけ収縮させる', () => {
    const image = createTransparentImage(20, 20);
    fillOpaqueSquare(image, 5, 5, 10, 100); // x:5-14, y:5-14 が不透明

    const result = applyEdgeFix(image, 2);

    // 外周2px分(境界からの距離<=2)は透明になる
    expect(alphaAt(result, 5, 5)).toBe(0); // 角(距離0)
    expect(alphaAt(result, 7, 5)).toBe(0); // 上端から距離0、左右には余裕があるが上端が近い
    // 中心部は不透明のまま残る
    expect(alphaAt(result, 9, 9)).toBe(255);
  });

  it('負の値で被写体を外側へ膨張させ、近傍の色を伝播する', () => {
    const image = createTransparentImage(20, 20);
    fillOpaqueSquare(image, 8, 8, 4, 123); // x:8-11, y:8-11

    const result = applyEdgeFix(image, -2);

    // 被写体の外側2px以内が不透明になる
    expect(alphaAt(result, 6, 9)).toBe(255); // 左に2px膨張
    expect(result.data[(9 * 20 + 6) * 4]).toBe(123); // 色も伝播する

    // 3px以上離れた位置は変化しない(透明のまま)
    expect(alphaAt(result, 4, 9)).toBe(0);
  });

  it('被写体そのものの画素は上書きしない', () => {
    const image = createTransparentImage(10, 10);
    fillOpaqueSquare(image, 3, 3, 4, 100);
    const result = applyEdgeFix(image, -1);
    const i = (4 * 10 + 4) * 4;
    expect(result.data[i]).toBe(100);
    expect(result.data[i + 3]).toBe(255);
  });
});
