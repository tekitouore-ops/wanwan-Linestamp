import { describe, expect, it } from 'vitest';
import { detectGrid, detectGridEqualDivision, fitBoxToContent } from './gridSplit';
import { createSolidImage, fillRect, type Rect } from './testUtils';
import type { DetectionParams } from './types';

const COLS = 6;
const ROWS = 4;
const CELL_W = 100;
const CELL_H = 100;

const BASE_PARAMS: DetectionParams = {
  backgroundThreshold: 20,
  minAreaRatio: 0.00001,
  cols: COLS,
  rows: ROWS,
};

function buildDriftedSheet(): {
  image: ReturnType<typeof createSolidImage>;
  expectedBoxes: Record<number, Rect>;
} {
  const image = createSolidImage(COLS * CELL_W, ROWS * CELL_H, { r: 255, g: 255, b: 255 });
  const expectedBoxes: Record<number, Rect> = {};

  for (let r = 0; r < ROWS; r += 1) {
    // AI生成シートにありがちな、行ごとの列位置のズレを模す。
    const offsetX = r * 4;
    for (let c = 0; c < COLS; c += 1) {
      const index = r * COLS + c;
      const rect: Rect = {
        x: c * CELL_W + 20 + offsetX,
        y: r * CELL_H + 20,
        width: 60,
        height: 60,
      };
      fillRect(image, rect, { r: 20, g: 30, b: 40 });
      expectedBoxes[index] = rect;
    }
  }

  return { image, expectedBoxes };
}

describe('detectGrid', () => {
  it('行ごとに列位置がズレたシートでも、24個のbboxを正しく検出する', () => {
    const { image, expectedBoxes } = buildDriftedSheet();
    const result = detectGrid(image, BASE_PARAMS);

    expect(result.method).toBe('projection');
    expect(result.cells).toHaveLength(COLS * ROWS);
    for (const cell of result.cells) {
      expect(cell.box).toEqual(expectedBoxes[cell.index]);
      expect(cell.warnings).toEqual([]);
    }
  });

  it('前景が全くないセルには empty 警告を付ける', () => {
    const image = createSolidImage(COLS * CELL_W, ROWS * CELL_H, { r: 255, g: 255, b: 255 });
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        if (r === 0 && c === 0) {
          continue; // No.1 のセルだけ空のままにする
        }
        fillRect(
          image,
          { x: c * CELL_W + 20, y: r * CELL_H + 20, width: 60, height: 60 },
          { r: 10, g: 10, b: 10 },
        );
      }
    }

    const result = detectGrid(image, BASE_PARAMS);
    const emptyCell = result.cells.find((cell) => cell.index === 0);
    expect(emptyCell?.warnings).toContain('empty');
  });

  it('境界候補が近すぎて単調増加にならない場合は等分割にフォールバックする', () => {
    // 行の理想境界(高さ40を4分割=10px間隔)の探索窓の端同士に「空の帯」を意図的に配置し、
    // 2本の境界候補の間隔が最小間隔を下回る状況を作る。
    const width = 50;
    const height = 40;
    const image = createSolidImage(width, height, { r: 255, g: 255, b: 255 });
    fillRect(image, { x: 0, y: 6, width, height: 7 }, { r: 0, g: 0, b: 0 }); // rows 6-12: 密
    // rows 13-14・16 は白(=背景)のまま残し、空の帯にする
    fillRect(image, { x: 0, y: 17, width, height: 8 }, { r: 0, g: 0, b: 0 }); // rows 17-24: 密

    const result = detectGrid(image, {
      backgroundThreshold: 20,
      minAreaRatio: 0.00001,
      cols: 1,
      rows: 4,
      backgroundColor: { r: 255, g: 255, b: 255 },
    });

    expect(result.method).toBe('equal');
    expect(result.cells).toHaveLength(4);
  });
});

describe('detectGridEqualDivision', () => {
  it('均等分割でセルを割り当て、境界に接する内容には touchesBoundary 警告を付ける', () => {
    const image = createSolidImage(COLS * CELL_W, ROWS * CELL_H, { r: 255, g: 255, b: 255 });
    // セル0の左端ぴったりまで届く矩形(境界に接する)
    fillRect(image, { x: 0, y: 20, width: 80, height: 60 }, { r: 0, g: 0, b: 0 });

    const result = detectGridEqualDivision(image, BASE_PARAMS);
    expect(result.method).toBe('equal');
    expect(result.cells).toHaveLength(COLS * ROWS);

    const cell0 = result.cells.find((cell) => cell.index === 0);
    expect(cell0?.warnings).toContain('touchesBoundary');
  });

  it('他と極端に面積が異なるセルには sizeOutlier 警告を付ける', () => {
    const image = createSolidImage(COLS * CELL_W, ROWS * CELL_H, { r: 255, g: 255, b: 255 });
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const index = r * COLS + c;
        // 1個だけ極端に小さい内容にする。
        const size = index === 10 ? 4 : 60;
        fillRect(
          image,
          { x: c * CELL_W + 20, y: r * CELL_H + 20, width: size, height: size },
          { r: 10, g: 10, b: 10 },
        );
      }
    }

    const result = detectGridEqualDivision(image, BASE_PARAMS);
    const outlierCell = result.cells.find((cell) => cell.index === 10);
    expect(outlierCell?.warnings).toContain('sizeOutlier');
  });
});

describe('fitBoxToContent', () => {
  it('指定した範囲内の前景にぴったり合わせたbboxを返す', () => {
    const image = createSolidImage(200, 200, { r: 255, g: 255, b: 255 });
    fillRect(image, { x: 50, y: 60, width: 40, height: 30 }, { r: 0, g: 0, b: 0 });

    const box = fitBoxToContent(image, { x: 0, y: 0, width: 200, height: 200 }, BASE_PARAMS);
    expect(box).toEqual({ x: 50, y: 60, width: 40, height: 30 });
  });
});
