import { describe, expect, it } from 'vitest';
import {
  HANDLE_SIZE_SCREEN_PX,
  MIN_BOX_SIZE_PX,
  applyResize,
  computeVisibleHandles,
  cursorForHandle,
  getHandlePoints,
  hitTestHandle,
} from './boxResize';

const BOX = { x: 100, y: 100, width: 60, height: 40 };

describe('getHandlePoints', () => {
  it('8点を、枠の角・辺の中央として返す', () => {
    const points = getHandlePoints(BOX);
    expect(points.nw).toEqual({ x: 100, y: 100 });
    expect(points.se).toEqual({ x: 160, y: 140 });
    expect(points.n).toEqual({ x: 130, y: 100 });
    expect(points.w).toEqual({ x: 100, y: 120 });
  });
});

describe('computeVisibleHandles', () => {
  it('枠が十分大きければ8個すべて表示する', () => {
    const visible = computeVisibleHandles(200, 200, 10);
    expect(visible).toHaveLength(8);
  });

  it('横幅が狭いと、上下(水平方向の中央)ハンドルを非表示にする', () => {
    const visible = computeVisibleHandles(20, 200, 10);
    expect(visible).not.toContain('n');
    expect(visible).not.toContain('s');
    expect(visible).toContain('nw');
    expect(visible).toContain('se');
  });

  it('縦幅が狭いと、左右(垂直方向の中央)ハンドルを非表示にする', () => {
    const visible = computeVisibleHandles(200, 20, 10);
    expect(visible).not.toContain('w');
    expect(visible).not.toContain('e');
    expect(visible).toContain('ne');
  });

  it('角ハンドルは、どんなに小さくても常に表示する', () => {
    const visible = computeVisibleHandles(5, 5, 10);
    expect(visible).toEqual(['nw', 'ne', 'sw', 'se']);
  });
});

describe('hitTestHandle', () => {
  it('角ハンドルの近くをクリックすると、その角を返す', () => {
    const handle = hitTestHandle(BOX, 100, 100, 14, 60, 40);
    expect(handle).toBe('nw');
  });

  it('辺の中央ハンドルの近くをクリックすると、その辺を返す(枠が十分大きい場合)', () => {
    const handle = hitTestHandle(BOX, 130, 100, 14, 60, 40);
    expect(handle).toBe('n');
  });

  it('どのハンドルからも離れていれば null を返す', () => {
    const handle = hitTestHandle(BOX, 130, 120, 14, 60, 40);
    expect(handle).toBeNull();
  });

  it('角と辺のハンドルが同距離で重なる場合、角を優先する', () => {
    // 境界が極端に小さく、角と中央ハンドルがほぼ同じ位置にある状況を想定。
    const tinyBox = { x: 100, y: 100, width: 2, height: 40 };
    const handle = hitTestHandle(tinyBox, 100, 100, 14, 2, 40);
    expect(handle).toBe('nw');
  });

  it('非表示の辺ハンドル(枠が小さい)は当たり判定から除外される', () => {
    const narrowBox = { x: 100, y: 100, width: 5, height: 40 };
    // n/sは非表示になるはずの幅。中央付近をクリックしても角のどちらかが拾われるか、nullになる。
    const handle = hitTestHandle(narrowBox, 102, 100, 3, 5, 40);
    expect(handle).not.toBe('n');
  });
});

describe('cursorForHandle', () => {
  it('nw・se は nwse-resize', () => {
    expect(cursorForHandle('nw')).toBe('nwse-resize');
    expect(cursorForHandle('se')).toBe('nwse-resize');
  });
  it('ne・sw は nesw-resize', () => {
    expect(cursorForHandle('ne')).toBe('nesw-resize');
    expect(cursorForHandle('sw')).toBe('nesw-resize');
  });
  it('n・s は ns-resize', () => {
    expect(cursorForHandle('n')).toBe('ns-resize');
    expect(cursorForHandle('s')).toBe('ns-resize');
  });
  it('e・w は ew-resize', () => {
    expect(cursorForHandle('e')).toBe('ew-resize');
    expect(cursorForHandle('w')).toBe('ew-resize');
  });
});

describe('applyResize(修飾キーなし)', () => {
  it('seハンドルは右下を動かし、左上(アンカー)は固定する', () => {
    const result = applyResize(BOX, 'se', 200, 160);
    expect(result).toEqual({ x: 100, y: 100, width: 100, height: 60 });
  });

  it('nwハンドルは左上を動かし、右下(アンカー)は固定する', () => {
    const result = applyResize(BOX, 'nw', 80, 80);
    expect(result).toEqual({ x: 80, y: 80, width: 80, height: 60 });
  });

  it('eハンドルは右辺だけ動かす(上下は変化しない)', () => {
    const result = applyResize(BOX, 'e', 220, 999);
    expect(result).toEqual({ x: 100, y: 100, width: 120, height: 40 });
  });

  it('最小サイズを下回らない(右方向への過剰な縮小を防ぐ)', () => {
    const result = applyResize(BOX, 'e', -1000, 120);
    expect(result.width).toBe(MIN_BOX_SIZE_PX);
    expect(result.x).toBe(100);
  });

  it('最小サイズを下回らない(左ハンドルでの過剰な縮小)', () => {
    const result = applyResize(BOX, 'w', 1000, 120);
    expect(result.width).toBe(MIN_BOX_SIZE_PX);
  });
});

describe('applyResize(Shift押下: 縦横比維持)', () => {
  it('角ハンドルでは、元の縦横比を保ったまま拡縮する', () => {
    const result = applyResize(BOX, 'se', 220, 160, { shiftKey: true, altKey: false });
    // 幅の変化率(120/60=2倍)の方が高さの変化率(60/40=1.5倍)より大きいので、幅を優先し高さを追従させる。
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.width / result.height).toBeCloseTo(BOX.width / BOX.height, 5);
  });

  it('反対側の角(アンカー)は固定されたままになる', () => {
    const result = applyResize(BOX, 'nw', 50, 50, { shiftKey: true, altKey: false });
    expect(result.x + result.width).toBeCloseTo(BOX.x + BOX.width, 5);
    expect(result.y + result.height).toBeCloseTo(BOX.y + BOX.height, 5);
  });

  it('辺ハンドル(片方向のみ変化)では、縦横比の固定は適用しない', () => {
    const result = applyResize(BOX, 'e', 220, 999, { shiftKey: true, altKey: false });
    expect(result).toEqual({ x: 100, y: 100, width: 120, height: 40 });
  });
});

describe('applyResize(Alt押下: 中心固定)', () => {
  it('角ハンドルでは、元の中心を保ったまま、上下左右対称に広がる', () => {
    const result = applyResize(BOX, 'se', 200, 160, { shiftKey: false, altKey: true });
    const centerX = BOX.x + BOX.width / 2;
    const centerY = BOX.y + BOX.height / 2;
    expect(result.x + result.width / 2).toBeCloseTo(centerX, 5);
    expect(result.y + result.height / 2).toBeCloseTo(centerY, 5);
  });

  it('辺ハンドルでは、動かした方向の軸だけ中心固定で対称に広がる', () => {
    const result = applyResize(BOX, 'e', 220, 999, { shiftKey: false, altKey: true });
    const centerX = BOX.x + BOX.width / 2;
    expect(result.x + result.width / 2).toBeCloseTo(centerX, 5);
    // 高さ方向は変化しないので、元のまま。
    expect(result.y).toBe(BOX.y);
    expect(result.height).toBe(BOX.height);
  });

  it('Shift+Altを同時に押すと、中心固定かつ縦横比維持になる', () => {
    const result = applyResize(BOX, 'se', 220, 160, { shiftKey: true, altKey: true });
    const centerX = BOX.x + BOX.width / 2;
    const centerY = BOX.y + BOX.height / 2;
    expect(result.x + result.width / 2).toBeCloseTo(centerX, 5);
    expect(result.y + result.height / 2).toBeCloseTo(centerY, 5);
    expect(result.width / result.height).toBeCloseTo(BOX.width / BOX.height, 5);
  });
});

describe('HANDLE_SIZE_SCREEN_PX', () => {
  it('正の定数である', () => {
    expect(HANDLE_SIZE_SCREEN_PX).toBeGreaterThan(0);
  });
});
