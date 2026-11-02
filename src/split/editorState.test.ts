import { describe, expect, it } from 'vitest';
import {
  createEditorState,
  getCell,
  replaceBoxes,
  resetAllCells,
  resetCell,
  selectCell,
  swapCells,
  updateCellBox,
} from './editorState';
import type { DetectionResult } from './types';

function makeDetectionResult(): DetectionResult {
  return {
    method: 'projection',
    cells: Array.from({ length: 4 }, (_, index) => ({
      index,
      box: { x: index * 10, y: 0, width: 10, height: 10 },
      warnings: index === 1 ? (['empty'] as const) : [],
    })),
  };
}

describe('createEditorState', () => {
  it('検出結果からセル一覧を作り、未編集・未選択の状態にする', () => {
    const state = createEditorState(makeDetectionResult());
    expect(state.cells).toHaveLength(4);
    expect(state.selectedIndex).toBeNull();
    expect(state.cells.every((cell) => !cell.isManuallyEdited)).toBe(true);
    expect(getCell(state, 1)?.warnings).toEqual(['empty']);
  });
});

describe('selectCell', () => {
  it('選択中インデックスを更新する', () => {
    const state = selectCell(createEditorState(makeDetectionResult()), 2);
    expect(state.selectedIndex).toBe(2);
  });
});

describe('updateCellBox', () => {
  it('指定したセルの枠を更新し、手動編集マークを付け、警告をクリアする', () => {
    const state = updateCellBox(createEditorState(makeDetectionResult()), 1, {
      x: 5,
      y: 5,
      width: 20,
      height: 20,
    });
    const cell = getCell(state, 1);
    expect(cell?.box).toEqual({ x: 5, y: 5, width: 20, height: 20 });
    expect(cell?.isManuallyEdited).toBe(true);
    expect(cell?.warnings).toEqual([]);
  });

  it('他のセルには影響しない', () => {
    const state = updateCellBox(createEditorState(makeDetectionResult()), 1, {
      x: 5,
      y: 5,
      width: 20,
      height: 20,
    });
    expect(getCell(state, 0)?.isManuallyEdited).toBe(false);
  });
});

describe('swapCells', () => {
  it('2つの枠の位置と警告を入れ替える', () => {
    const state = swapCells(createEditorState(makeDetectionResult()), 0, 1);
    expect(getCell(state, 0)?.box).toEqual({ x: 10, y: 0, width: 10, height: 10 });
    expect(getCell(state, 0)?.warnings).toEqual(['empty']);
    expect(getCell(state, 1)?.box).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(getCell(state, 1)?.warnings).toEqual([]);
    expect(getCell(state, 0)?.isManuallyEdited).toBe(true);
    expect(getCell(state, 1)?.isManuallyEdited).toBe(true);
  });

  it('同じインデックスを指定した場合は何もしない', () => {
    const original = createEditorState(makeDetectionResult());
    const result = swapCells(original, 2, 2);
    expect(result).toBe(original);
  });
});

describe('resetCell / resetAllCells', () => {
  it('1枠だけ検出結果の内容に戻す', () => {
    let state = createEditorState(makeDetectionResult());
    state = updateCellBox(state, 0, { x: 999, y: 999, width: 1, height: 1 });
    state = resetCell(state, 0);
    expect(getCell(state, 0)?.box).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(getCell(state, 0)?.isManuallyEdited).toBe(false);
  });

  it('すべての枠を検出結果の内容に戻し、選択も解除する', () => {
    let state = createEditorState(makeDetectionResult());
    state = updateCellBox(state, 0, { x: 999, y: 999, width: 1, height: 1 });
    state = selectCell(state, 0);
    state = resetAllCells(state);
    expect(state.selectedIndex).toBeNull();
    expect(state.cells.every((cell) => !cell.isManuallyEdited)).toBe(true);
    expect(getCell(state, 0)?.box).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});

describe('replaceBoxes', () => {
  it('指定したインデックスの枠だけ置き換え、手動編集マークを付ける', () => {
    const state = replaceBoxes(createEditorState(makeDetectionResult()), {
      2: { x: 1, y: 2, width: 3, height: 4 },
    });
    expect(getCell(state, 2)?.box).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(getCell(state, 2)?.isManuallyEdited).toBe(true);
    expect(getCell(state, 2)?.warnings).toEqual([]);
  });

  it('指定しなかったインデックスの枠は変更しない', () => {
    const state = replaceBoxes(createEditorState(makeDetectionResult()), {
      2: { x: 1, y: 2, width: 3, height: 4 },
    });
    expect(getCell(state, 0)?.box).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(getCell(state, 0)?.isManuallyEdited).toBe(false);
  });
});
