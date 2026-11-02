import { describe, expect, it } from 'vitest';
import {
  cellSize,
  cols,
  edgeMargin,
  imageHeight,
  imageWidth,
  rows,
  safeAreaSize,
  stampCount,
} from './layoutConstants';

describe('layoutConstants', () => {
  it('マス数は列数×行数で24になる', () => {
    expect(cols).toBe(6);
    expect(rows).toBe(4);
    expect(stampCount).toBe(24);
  });

  it('マスのサイズは画像サイズをグリッドで割った値と一致する(正方形)', () => {
    expect(cellSize).toBe(imageWidth / cols);
    expect(cellSize).toBe(imageHeight / rows);
    expect(cellSize).toBe(256);
  });

  it('安全領域のサイズはマスのサイズから外周余白を両側分引いた値になる', () => {
    expect(safeAreaSize).toBe(cellSize - edgeMargin * 2);
    expect(safeAreaSize).toBe(208);
  });
});
