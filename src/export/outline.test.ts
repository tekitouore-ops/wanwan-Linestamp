import { describe, expect, it } from 'vitest';
import { addWhiteOutline } from './outline';
import type { ImageDataLike } from '../shared/types';

function createTransparentImage(width: number, height: number): ImageDataLike {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function setOpaquePixel(image: ImageDataLike, x: number, y: number): void {
  const i = (y * image.width + x) * 4;
  image.data[i] = 10;
  image.data[i + 1] = 20;
  image.data[i + 2] = 30;
  image.data[i + 3] = 255;
}

function alphaAt(image: ImageDataLike, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

describe('addWhiteOutline', () => {
  it('widthPxが0以下のときは何もしない', () => {
    const image = createTransparentImage(10, 10);
    setOpaquePixel(image, 5, 5);
    const result = addWhiteOutline(image, 0);
    expect(result).toEqual(image);
  });

  it('被写体の外側を指定した半径(マンハッタン距離)だけ白く膨張させる', () => {
    const image = createTransparentImage(21, 21);
    setOpaquePixel(image, 10, 10);

    const result = addWhiteOutline(image, 3);

    // 中心(被写体そのもの)は変更されない
    expect(alphaAt(result, 10, 10)).toBe(255);
    expect(result.data[(10 * 21 + 10) * 4]).toBe(10);

    // 距離3以内は白・不透明
    expect(alphaAt(result, 13, 10)).toBe(255);
    expect(result.data[(10 * 21 + 13) * 4]).toBe(255);

    // 距離4(半径+1)は半透明の白
    const farAlpha = alphaAt(result, 14, 10);
    expect(farAlpha).toBeGreaterThan(0);
    expect(farAlpha).toBeLessThan(255);

    // 距離5以上は変化なし(透明のまま)
    expect(alphaAt(result, 16, 10)).toBe(0);
  });

  it('被写体自体のピクセルは上書きしない', () => {
    const image = createTransparentImage(10, 10);
    setOpaquePixel(image, 5, 5);
    const result = addWhiteOutline(image, 2);
    const i = (5 * 10 + 5) * 4;
    expect(result.data[i]).toBe(10);
    expect(result.data[i + 1]).toBe(20);
    expect(result.data[i + 2]).toBe(30);
  });

  it('キャラクターとセリフ文字など、離れた複数の被写体があっても1つの白フチで囲み、外側は完全に透明のままにする(修正指示書 項目8)', () => {
    const image = createTransparentImage(40, 20);
    // キャラクター(左)とセリフ文字(右)を別々の被写体として配置する。
    setOpaquePixel(image, 5, 10);
    setOpaquePixel(image, 30, 10);

    const result = addWhiteOutline(image, 2);

    // どちらの被写体の近くも白フチになる(それぞれの周囲を同じフチ幅で囲む)。
    expect(alphaAt(result, 7, 10)).toBe(255);
    expect(result.data[(10 * 40 + 7) * 4]).toBe(255);
    expect(alphaAt(result, 28, 10)).toBe(255);
    expect(result.data[(10 * 40 + 28) * 4]).toBe(255);

    // 両方の被写体から十分離れた外側は、完全に透明のまま。
    expect(alphaAt(result, 0, 0)).toBe(0);
    expect(alphaAt(result, 39, 0)).toBe(0);
    expect(alphaAt(result, 18, 10)).toBe(0); // 2つの被写体のちょうど中間(どちらからもフチ幅の外)
  });

  it('画像自体にすでに不透明な白フチが描かれている場合(透過画像モード想定)、widthPx=0ならそのフチを一切変更しない', () => {
    // AIが生成した透過PNGにありがちな「被写体の周りにすでに白フチが描かれている」状態を模す。
    const image = createTransparentImage(10, 10);
    setOpaquePixel(image, 5, 5);
    const outlineIndex = (4 * 10 + 5) * 4; // 被写体に隣接する、AI自身が描いた白フチの画素(想定)
    image.data[outlineIndex] = 255;
    image.data[outlineIndex + 1] = 255;
    image.data[outlineIndex + 2] = 255;
    image.data[outlineIndex + 3] = 255;

    const result = addWhiteOutline(image, 0);

    expect(result).toEqual(image);
    expect(result.data[outlineIndex]).toBe(255);
    expect(result.data[outlineIndex + 3]).toBe(255);
  });
});
