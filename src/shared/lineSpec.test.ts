import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRID,
  STAMP_COUNT,
  STAMP_MAX_HEIGHT,
  STAMP_MAX_WIDTH,
  stampFileName,
} from './lineSpec';

describe('lineSpec', () => {
  it('ファイル名は2桁ゼロ埋めのPNGになる', () => {
    expect(stampFileName(1)).toBe('01.png');
    expect(stampFileName(9)).toBe('09.png');
    expect(stampFileName(24)).toBe('24.png');
  });

  it('規格の最大サイズは370x320', () => {
    expect(STAMP_MAX_WIDTH).toBe(370);
    expect(STAMP_MAX_HEIGHT).toBe(320);
  });

  it('セット枚数は24', () => {
    expect(STAMP_COUNT).toBe(24);
  });

  it('既定のグリッドは6列×4行', () => {
    expect(DEFAULT_GRID).toEqual({ cols: 6, rows: 4 });
  });
});
