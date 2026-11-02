import { describe, expect, it } from 'vitest';
import {
  applyAdjustToAll,
  confirmFrames,
  createEditorState,
  createEditorStateFromFrames,
  getCell,
  getResolvedStampAdjust,
  isStampAdjusted,
  replaceBoxes,
  resetAllCells,
  resetCell,
  resetStampAdjust,
  selectCell,
  setCoverIndex,
  setPreview,
  swapCells,
  updateCellBox,
  updateGlobalSettings,
  updateStampAdjust,
} from './editorState';
import { DEFAULT_GLOBAL_SETTINGS, type DetectionResult, type ProjectState, type Rect } from './types';

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

describe('createEditorStateFromFrames', () => {
  it('Rect[]から警告なしの状態を作る', () => {
    const frames: Rect[] = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 0, width: 10, height: 10 },
    ];
    const state = createEditorStateFromFrames(frames);
    expect(state.cells).toHaveLength(2);
    expect(state.cells.every((cell) => cell.warnings.length === 0)).toBe(true);
    expect(getCell(state, 1)?.box).toEqual({ x: 10, y: 0, width: 10, height: 10 });
    expect(state.selectedIndex).toBeNull();
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

function makeFrames(count: number): Rect[] {
  return Array.from({ length: count }, (_, i) => ({ x: i * 10, y: 0, width: 10, height: 10 }));
}

describe('confirmFrames', () => {
  it('初回確定では全スタンプの個別設定を空にする', () => {
    const state = confirmFrames(null, 'sheet.png', makeFrames(3));
    expect(state.frames).toEqual(makeFrames(3));
    expect(state.stamps).toEqual([{}, {}, {}]);
    expect(state.coverIndex).toBe(0);
    expect(state.globalSettings).toEqual(DEFAULT_GLOBAL_SETTINGS);
  });

  it('同じシート・同じ枠のスタンプは個別設定を引き継ぐ', () => {
    const first = confirmFrames(null, 'sheet.png', makeFrames(3));
    const withAdjust = updateStampAdjust(first, 1, { scale: 150 });

    const frames = makeFrames(3);
    // index 0 の枠だけ変更する
    frames[0] = { x: 999, y: 999, width: 10, height: 10 };
    const second = confirmFrames(withAdjust, 'sheet.png', frames);

    expect(second.stamps[0]).toEqual({}); // 枠が変わったのでリセット
    expect(second.stamps[1]).toEqual({ scale: 150 }); // 枠が同じなので維持
  });

  it('シート画像が変わった場合はすべての個別設定をリセットする', () => {
    const first = confirmFrames(null, 'sheet-a.png', makeFrames(2));
    const withAdjust = updateStampAdjust(first, 0, { scale: 150 });
    const second = confirmFrames(withAdjust, 'sheet-b.png', makeFrames(2));
    expect(second.stamps).toEqual([{}, {}]);
  });
});

describe('ProjectStateの個別設定・全体設定・表紙・プレビュー', () => {
  function makeProjectState(): ProjectState {
    return confirmFrames(null, 'sheet.png', makeFrames(3));
  }

  it('getResolvedStampAdjustは未設定項目を全体設定の既定値で補う', () => {
    const state = makeProjectState();
    const resolved = getResolvedStampAdjust(state, 0);
    expect(resolved).toEqual({
      edgeFix: 0,
      outline: state.globalSettings.defaultOutline,
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      scale: 100,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('updateStampAdjustは指定したスタンプだけ更新する', () => {
    const state = updateStampAdjust(makeProjectState(), 1, { scale: 120, offsetX: 5 });
    expect(state.stamps[1]).toEqual({ scale: 120, offsetX: 5 });
    expect(state.stamps[0]).toEqual({});
    expect(isStampAdjusted(state, 1)).toBe(true);
    expect(isStampAdjusted(state, 0)).toBe(false);
  });

  it('resetStampAdjustは個別設定を解除する', () => {
    const state = updateStampAdjust(makeProjectState(), 1, { scale: 120 });
    const reset = resetStampAdjust(state, 1);
    expect(reset.stamps[1]).toEqual({});
  });

  it('applyAdjustToAllは指定した項目だけ他スタンプへコピーする(cropは対象外)', () => {
    let state = makeProjectState();
    state = updateStampAdjust(state, 0, { scale: 130, offsetX: 7, crop: { top: 5, right: 0, bottom: 0, left: 0 } });
    state = applyAdjustToAll(state, 0, ['scale', 'offsetX']);

    expect(state.stamps[1]).toEqual({ scale: 130, offsetX: 7 });
    expect(state.stamps[2]).toEqual({ scale: 130, offsetX: 7 });
    // コピー元自身は変更しない
    expect(state.stamps[0]).toEqual({ scale: 130, offsetX: 7, crop: { top: 5, right: 0, bottom: 0, left: 0 } });
  });

  it('setCoverIndexは表紙番号を更新する', () => {
    const state = setCoverIndex(makeProjectState(), 2);
    expect(state.coverIndex).toBe(2);
  });

  it('updateGlobalSettingsは部分更新する', () => {
    const state = updateGlobalSettings(makeProjectState(), { defaultOutline: 6 });
    expect(state.globalSettings.defaultOutline).toBe(6);
    expect(state.globalSettings.outputWidth).toBe(DEFAULT_GLOBAL_SETTINGS.outputWidth);
  });

  it('setPreviewはプレビュー背景設定を更新する', () => {
    const state = setPreview(makeProjectState(), { mode: 'color', color: '#111111' });
    expect(state.preview).toEqual({ mode: 'color', color: '#111111' });
  });
});
