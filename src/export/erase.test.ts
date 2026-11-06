import { describe, expect, it } from 'vitest';
import { alignEraseMaskToCrop, applyEraseMask, isEraseMaskEmpty } from './erase';
import { addWhiteOutline } from './outline';
import { createSolidImage, fillRect } from '../split/testUtils';
import type { EraseMask } from '../split/types';

function makeMask(x: number, y: number, width: number, height: number, fill = 0): EraseMask {
  return { x, y, width, height, data: new Uint8ClampedArray(width * height).fill(fill) };
}

function setMaskValue(mask: EraseMask, x: number, y: number, value: number): void {
  mask.data[(y - mask.y) * mask.width + (x - mask.x)] = value;
}

function alphaAt(image: ReturnType<typeof createSolidImage>, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

describe('isEraseMaskEmpty', () => {
  it('undefined・nullは空とみなす', () => {
    expect(isEraseMaskEmpty(undefined)).toBe(true);
    expect(isEraseMaskEmpty(null)).toBe(true);
  });

  it('全画素0なら空とみなす', () => {
    expect(isEraseMaskEmpty(makeMask(0, 0, 4, 4, 0))).toBe(true);
  });

  it('1画素でも0より大きければ空ではない', () => {
    const mask = makeMask(0, 0, 4, 4, 0);
    setMaskValue(mask, 2, 2, 1);
    expect(isEraseMaskEmpty(mask)).toBe(false);
  });
});

describe('applyEraseMask(追加修正指示書 第5弾 項目19)', () => {
  it('マスク255の画素はアルファが0(完全に透明)になる', () => {
    const image = createSolidImage(10, 10, { r: 200, g: 100, b: 50, a: 255 });
    const mask = makeMask(0, 0, 10, 10, 0);
    setMaskValue(mask, 5, 5, 255);

    const result = applyEraseMask(image, mask);

    expect(alphaAt(result, 5, 5)).toBe(0);
    // 色(RGB)は変更しない。
    const i = (5 * 10 + 5) * 4;
    expect(result.data[i]).toBe(200);
    expect(result.data[i + 1]).toBe(100);
    expect(result.data[i + 2]).toBe(50);
  });

  it('マスク0の画素は変化しない', () => {
    const image = createSolidImage(10, 10, { r: 200, g: 100, b: 50, a: 255 });
    const mask = makeMask(0, 0, 10, 10, 0);
    setMaskValue(mask, 5, 5, 255);

    const result = applyEraseMask(image, mask);

    expect(alphaAt(result, 0, 0)).toBe(255);
  });

  it('中間値は比例的に減衰する(ブラシの縁のなめらかさ)', () => {
    const image = createSolidImage(10, 10, { r: 0, g: 0, b: 0, a: 200 });
    const mask = makeMask(0, 0, 10, 10, 0);
    setMaskValue(mask, 5, 5, 128); // 約50%

    const result = applyEraseMask(image, mask);

    const alpha = alphaAt(result, 5, 5);
    expect(alpha).toBeGreaterThan(80);
    expect(alpha).toBeLessThan(120);
  });

  it('マスクがない・空のときは、入力と同じ内容を返す(非破壊)', () => {
    const image = createSolidImage(5, 5, { r: 1, g: 2, b: 3, a: 255 });
    const result = applyEraseMask(image, undefined);
    expect(result).toEqual(image);
    expect(result).not.toBe(image); // 複製であり、同じ参照ではない
  });

  it('元の画像データは書き換えない', () => {
    const image = createSolidImage(10, 10, { r: 200, g: 100, b: 50, a: 255 });
    const original = new Uint8ClampedArray(image.data);
    const mask = makeMask(0, 0, 10, 10, 255);

    applyEraseMask(image, mask);

    expect(image.data).toEqual(original);
  });
});

describe('alignEraseMaskToCrop', () => {
  it('シート絶対座標のマスクを、切り出し範囲のローカル座標に変換する', () => {
    const mask = makeMask(100, 50, 10, 10, 0);
    setMaskValue(mask, 105, 55, 255); // シート絶対座標(105,55)

    // 切り出し範囲: シート絶対座標(102,52)を起点に20x20。
    const aligned = alignEraseMaskToCrop(mask, 102, 52, 20, 20);

    expect(aligned).not.toBeNull();
    // ローカル座標では (105-102, 55-52) = (3,3) に対応する。
    expect(aligned?.data[3 * 20 + 3]).toBe(255);
  });

  it('マスクの範囲外にあたる部分は0(消去なし)として扱う', () => {
    const mask = makeMask(0, 0, 4, 4, 255); // 全面消去の小さいマスク
    const aligned = alignEraseMaskToCrop(mask, -10, -10, 10, 10);
    expect(aligned).not.toBeNull();
    // マスクの(0,0)-(4,4)は、ローカル座標(10,10)-(14,14)に対応するが、
    // 切り出し範囲は10x10(ローカル0-9)なので範囲外になり、何も残らない。
    expect(aligned?.data.some((v) => v > 0)).toBe(false);
  });

  it('マスクが空ならnullを返す', () => {
    expect(alignEraseMaskToCrop(undefined, 0, 0, 10, 10)).toBeNull();
    expect(alignEraseMaskToCrop(makeMask(0, 0, 4, 4, 0), 0, 0, 10, 10)).toBeNull();
  });
});

describe('消しゴムで消した範囲は、縁フチの膨張で復元されない(処理順: 消しゴム→縁フチ)', () => {
  it('被写体から離れた位置の半透明のもやを消去してから縁フチを適用しても、消去した範囲は透明のまま', () => {
    const image = createSolidImage(40, 40, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(image, { x: 15, y: 15, width: 10, height: 10 }, { r: 200, g: 100, b: 50, a: 255 }); // 被写体
    // 被写体から離れた(縁フチの半径が届かない)位置の半透明のもや。
    fillRect(image, { x: 2, y: 2, width: 4, height: 4 }, { r: 255, g: 255, b: 255, a: 80 });

    const mask = makeMask(0, 0, 40, 40, 0);
    for (let y = 2; y < 6; y += 1) {
      for (let x = 2; x < 6; x += 1) {
        setMaskValue(mask, x, y, 255);
      }
    }
    const erased = applyEraseMask(image, mask);
    const outlined = addWhiteOutline(erased, 3); // 半径3pxの縁フチ

    // 消去した範囲(被写体から十分離れている)は、縁フチでも復元されず透明のまま。
    expect(alphaAt(outlined, 3, 3)).toBe(0);
    // 被写体自体の縁には、きちんと白フチが付く(メカニズム自体は健在)。
    expect(alphaAt(outlined, 15, 20)).toBeGreaterThan(0);
  });
});
