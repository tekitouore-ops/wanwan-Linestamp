import { describe, expect, it } from 'vitest';
import { applyBrushStamp, interpolateBrushPoints } from './eraseBrush';

function makeMask(width: number, height: number, fill = 0): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height).fill(fill);
}

describe('applyBrushStamp', () => {
  it('erase: 中心付近(内側硬さの範囲)は強さ1(255)で塗る', () => {
    const mask = makeMask(10, 10);
    applyBrushStamp(mask, 10, 10, 5, 5, 3, 1, 'erase');
    expect(mask[5 * 10 + 5]).toBe(255);
  });

  it('erase: 半径の外側は変化しない', () => {
    const mask = makeMask(10, 10);
    applyBrushStamp(mask, 10, 10, 5, 5, 2, 1, 'erase');
    expect(mask[0]).toBe(0);
    expect(mask[9 * 10 + 9]).toBe(0);
  });

  it('erase: hardnessが低いほど縁が滑らかに減衰する(縁の値が中心より小さい)', () => {
    const mask = makeMask(10, 10);
    applyBrushStamp(mask, 10, 10, 5, 5, 5, 0, 'erase');
    const center = mask[5 * 10 + 5] ?? 0;
    const edge = mask[5 * 10 + 9] ?? 0;
    expect(center).toBe(255);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(center);
  });

  it('erase: 既存値より弱いスタンプを重ねても値が下がらない(Math.maxで合成)', () => {
    const mask = makeMask(10, 10, 200);
    applyBrushStamp(mask, 10, 10, 5, 5, 5, 0, 'erase');
    expect(mask[5 * 10 + 9]).toBe(200);
  });

  it('restore: 範囲内を0へ戻す(Math.minで合成)', () => {
    const mask = makeMask(10, 10, 255);
    applyBrushStamp(mask, 10, 10, 5, 5, 3, 1, 'restore');
    expect(mask[5 * 10 + 5]).toBe(0);
    expect(mask[0]).toBe(255);
  });

  it('restore: 既存値より強い(すでに低い)値は変化しない', () => {
    const mask = makeMask(10, 10, 10);
    applyBrushStamp(mask, 10, 10, 5, 5, 3, 1, 'restore');
    expect(mask[5 * 10 + 5]).toBe(0);
  });
});

describe('interpolateBrushPoints', () => {
  it('距離がstepPx以下なら終点のみを返す', () => {
    const points = interpolateBrushPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, 5);
    expect(points).toEqual([{ x: 1, y: 0 }]);
  });

  it('距離が長い場合、stepPx間隔で補間した点(終点含む)を返す', () => {
    const points = interpolateBrushPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 2);
    expect(points.length).toBeGreaterThanOrEqual(5);
    const last = points[points.length - 1];
    expect(last).toEqual({ x: 10, y: 0 });
    points.forEach((p) => {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(10);
    });
  });

  it('始点は結果に含まれない(呼び出し側が重複して塗らないようにする)', () => {
    const points = interpolateBrushPoints({ x: 0, y: 0 }, { x: 20, y: 0 }, 4);
    expect(points.some((p) => p.x === 0 && p.y === 0)).toBe(false);
  });
});
