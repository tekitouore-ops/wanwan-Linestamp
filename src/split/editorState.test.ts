import { describe, expect, it } from 'vitest';
import {
  applyAdjustToAll,
  applyEditorStateToSheet,
  confirmSheets,
  createEditorState,
  createEditorStateFromFrames,
  getCell,
  getResolvedStampAdjust,
  getSourceSheet,
  getStampFrame,
  getStampFrameWarnings,
  isStampAdjusted,
  replaceBoxes,
  resetAllCells,
  resetCell,
  resetStampAdjust,
  selectCell,
  setCoverIndex,
  setPreview,
  setSourceForAllStamps,
  setSourceForParity,
  setSourceForWarningStamps,
  setStampSource,
  swapCells,
  updateCellBox,
  updateGlobalSettings,
  updateStampAdjust,
  updateStampCrop,
} from './editorState';
import {
  DEFAULT_DETECTION_PARAMS,
  DEFAULT_GLOBAL_SETTINGS,
  type DetectionResult,
  type ProjectState,
  type Rect,
  type Sheet,
} from './types';

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

describe('applyEditorStateToSheet', () => {
  it('エディタの各セルを番号順に並べ、frames/frameWarningsへ書き戻す', () => {
    const sheet: Sheet = {
      id: 's1',
      name: 'sheet.png',
      width: 100,
      height: 100,
      detectSettings: { ...DEFAULT_DETECTION_PARAMS, cols: 2, rows: 2 },
      frames: [],
      frameWarnings: [],
    };
    const editor = createEditorState(makeDetectionResult());
    const updated = applyEditorStateToSheet(sheet, editor);
    expect(updated.frames).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 0, width: 10, height: 10 },
      { x: 20, y: 0, width: 10, height: 10 },
      { x: 30, y: 0, width: 10, height: 10 },
    ]);
    expect(updated.frameWarnings[1]).toEqual(['empty']);
    expect(updated.frameWarnings[0]).toEqual([]);
  });
});

function makeFrames(count: number): Rect[] {
  return Array.from({ length: count }, (_, i) => ({ x: i * 10, y: 0, width: 10, height: 10 }));
}

function makeSheet(id: string, name: string, frames: Rect[]): Sheet {
  return {
    id,
    name,
    width: 1000,
    height: 1000,
    detectSettings: { ...DEFAULT_DETECTION_PARAMS, cols: frames.length, rows: 1 },
    frames,
    frameWarnings: frames.map(() => []),
  };
}

describe('confirmSheets', () => {
  it('初回確定では全スタンプの個別設定を空にし、先頭シートを採用元にする', () => {
    const sheet = makeSheet('s1', 'sheet.png', makeFrames(3));
    const state = confirmSheets(null, [sheet]);
    expect(state.version).toBe(2);
    expect(state.sheets).toEqual([sheet]);
    expect(state.stamps).toEqual([
      { sourceSheetId: 's1', adjust: {}, cropBySheet: {} },
      { sourceSheetId: 's1', adjust: {}, cropBySheet: {} },
      { sourceSheetId: 's1', adjust: {}, cropBySheet: {} },
    ]);
    expect(state.coverIndex).toBe(0);
    expect(state.globalSettings).toEqual(DEFAULT_GLOBAL_SETTINGS);
  });

  it('同じシート・同じ枠のスタンプは個別設定(adjust)を引き継ぐ', () => {
    const sheet = makeSheet('s1', 'sheet.png', makeFrames(3));
    const first = confirmSheets(null, [sheet]);
    const withAdjust = updateStampAdjust(first, 1, { scale: 150 });

    const frames = makeFrames(3);
    frames[0] = { x: 999, y: 999, width: 10, height: 10 }; // index0の枠だけ変更する
    const changedSheet = makeSheet('s1', 'sheet.png', frames);
    const second = confirmSheets(withAdjust, [changedSheet]);

    expect(second.stamps[1]?.adjust).toEqual({ scale: 150 }); // 枠が同じなので維持
  });

  it('採用元シートの枠が変わったスタンプは、そのシートぶんのcropBySheetだけリセットする', () => {
    const sheet = makeSheet('s1', 'sheet.png', makeFrames(2));
    const first = confirmSheets(null, [sheet]);
    const withCrop = updateStampCrop(first, 0, { top: 5, right: 0, bottom: 0, left: 0 });

    const frames = makeFrames(2);
    frames[0] = { x: 999, y: 999, width: 10, height: 10 };
    const changedSheet = makeSheet('s1', 'sheet.png', frames);
    const second = confirmSheets(withCrop, [changedSheet]);

    expect(second.stamps[0]?.cropBySheet).toEqual({});
  });

  it('枠の変化がx・y・右端・下端すべて5px以内(=4px)ならcropを保持する', () => {
    const sheet = makeSheet('s1', 'sheet.png', makeFrames(1));
    const first = confirmSheets(null, [sheet]);
    const withCrop = updateStampCrop(first, 0, { top: 3, right: 0, bottom: 0, left: 0 });

    // 元は{x:0,y:0,width:10,height:10}。x,y,右端,下端をすべて4pxだけ動かす(右端・下端は幅/高さも変える)。
    const frames = [{ x: 4, y: 4, width: 10, height: 10 }]; // 右端14(+4)・下端14(+4)
    const changedSheet = makeSheet('s1', 'sheet.png', frames);
    const second = confirmSheets(withCrop, [changedSheet]);

    expect(second.stamps[0]?.cropBySheet).toEqual({ s1: { top: 3, right: 0, bottom: 0, left: 0 } });
  });

  it('1辺でも6px変化すればcropをリセットする', () => {
    const sheet = makeSheet('s1', 'sheet.png', makeFrames(1));
    const first = confirmSheets(null, [sheet]);
    const withCrop = updateStampCrop(first, 0, { top: 3, right: 0, bottom: 0, left: 0 });

    // xだけ6px動かす(他の辺は変化なし)。
    const frames = [{ x: 6, y: 0, width: 4, height: 10 }]; // 右端は0→10のまま維持(width調整済み)
    const changedSheet = makeSheet('s1', 'sheet.png', frames);
    const second = confirmSheets(withCrop, [changedSheet]);

    expect(second.stamps[0]?.cropBySheet).toEqual({});
  });

  it('右端・下端だけが5pxを超えて動いた場合もcropをリセットする(x,yは不動)', () => {
    const sheet = makeSheet('s1', 'sheet.png', makeFrames(1));
    const first = confirmSheets(null, [sheet]);
    const withCrop = updateStampCrop(first, 0, { top: 3, right: 0, bottom: 0, left: 0 });

    // x,yは0のまま、widthだけ+6(右端が+6動く)。
    const frames = [{ x: 0, y: 0, width: 16, height: 10 }];
    const changedSheet = makeSheet('s1', 'sheet.png', frames);
    const second = confirmSheets(withCrop, [changedSheet]);

    expect(second.stamps[0]?.cropBySheet).toEqual({});
  });

  it('複数シートがある場合、cropの保持/リセットはシートごとに別々に判定される', () => {
    const sheetA = makeSheet('a', 'a.png', makeFrames(2));
    const sheetB = makeSheet('b', 'b.png', makeFrames(2));
    let state = confirmSheets(null, [sheetA, sheetB]);
    // 番号0はシートA採用、番号1はシートB採用にし、それぞれcropを設定する。
    state = updateStampCrop(state, 0, { top: 2, right: 0, bottom: 0, left: 0 });
    state = setStampSource(state, 1, 'b');
    state = updateStampCrop(state, 1, { top: 4, right: 0, bottom: 0, left: 0 });

    // シートAの枠は4pxだけ動かす(保持される)、シートBの枠は999pxの大変化(リセットされる)。
    const framesA = makeFrames(2);
    framesA[0] = { x: 4, y: 0, width: 10, height: 10 };
    const framesB = makeFrames(2);
    framesB[1] = { x: 999, y: 999, width: 10, height: 10 };
    const confirmed = confirmSheets(state, [
      makeSheet('a', 'a.png', framesA),
      makeSheet('b', 'b.png', framesB),
    ]);

    expect(confirmed.stamps[0]?.cropBySheet).toEqual({
      a: { top: 2, right: 0, bottom: 0, left: 0 },
    });
    expect(confirmed.stamps[1]?.cropBySheet).toEqual({});
  });

  it('採用元シートが削除されていた場合は先頭シートにフォールバックする', () => {
    const sheetA = makeSheet('a', 'a.png', makeFrames(2));
    const sheetB = makeSheet('b', 'b.png', makeFrames(2));
    const first = confirmSheets(null, [sheetA, sheetB]);
    const withSource = setStampSource(first, 0, 'b');

    const second = confirmSheets(withSource, [sheetA]); // bが削除された
    expect(second.stamps[0]?.sourceSheetId).toBe('a');
  });

  it('新しく追加されたシートがあっても既存スタンプの採用元は変更しない', () => {
    const sheetA = makeSheet('a', 'a.png', makeFrames(2));
    const first = confirmSheets(null, [sheetA]);
    const sheetB = makeSheet('b', 'b.png', makeFrames(2));
    const second = confirmSheets(first, [sheetA, sheetB]);
    expect(second.stamps.every((s) => s.sourceSheetId === 'a')).toBe(true);
  });
});

describe('ProjectStateの個別設定・全体設定・表紙・プレビュー', () => {
  function makeProjectState(): ProjectState {
    return confirmSheets(null, [makeSheet('s1', 'sheet.png', makeFrames(3))]);
  }

  it('getResolvedStampAdjustは未設定項目を全体設定の既定値で補う', () => {
    const state = makeProjectState();
    const resolved = getResolvedStampAdjust(state, 0);
    expect(resolved).toEqual({
      edgeFix: 0,
      outline: state.globalSettings.defaultOutline,
      ghostRemoval: state.globalSettings.defaultGhostRemoval,
      ghostProtectEdgePx: state.globalSettings.defaultGhostProtectEdgePx,
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      scale: 100,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('getStampFrame/getStampFrameWarnings/getSourceSheetは採用元シートの値を返す', () => {
    const state = makeProjectState();
    expect(getStampFrame(state, 1)).toEqual({ x: 10, y: 0, width: 10, height: 10 });
    expect(getStampFrameWarnings(state, 1)).toEqual([]);
    expect(getSourceSheet(state, 1)?.id).toBe('s1');
  });

  it('updateStampAdjustは指定したスタンプのadjustだけ更新する', () => {
    const state = updateStampAdjust(makeProjectState(), 1, { scale: 120, offsetX: 5 });
    expect(state.stamps[1]?.adjust).toEqual({ scale: 120, offsetX: 5 });
    expect(state.stamps[0]?.adjust).toEqual({});
    expect(isStampAdjusted(state, 1)).toBe(true);
    expect(isStampAdjusted(state, 0)).toBe(false);
  });

  it('updateStampCropは現在の採用元シートぶんのcropBySheetだけ更新する', () => {
    const state = updateStampCrop(makeProjectState(), 1, { top: 3, right: 0, bottom: 0, left: 0 });
    expect(state.stamps[1]?.cropBySheet).toEqual({ s1: { top: 3, right: 0, bottom: 0, left: 0 } });
    expect(isStampAdjusted(state, 1)).toBe(true);
  });

  it('setStampSourceは採用元を切り替え、adjust・cropBySheetは保持する', () => {
    const sheetA = makeSheet('a', 'a.png', makeFrames(2));
    const sheetB = makeSheet('b', 'b.png', makeFrames(2));
    let state = confirmSheets(null, [sheetA, sheetB]);
    state = updateStampCrop(state, 0, { top: 1, right: 0, bottom: 0, left: 0 });
    state = setStampSource(state, 0, 'b');
    expect(state.stamps[0]?.sourceSheetId).toBe('b');
    expect(state.stamps[0]?.cropBySheet).toEqual({ a: { top: 1, right: 0, bottom: 0, left: 0 } });
    // 採用元を切り替えただけ(bには個別のcropがない)なので、変更済みにはならない(追加修正指示書 項目11)。
    expect(isStampAdjusted(state, 0)).toBe(false);

    const backToA = setStampSource(state, 0, 'a');
    expect(backToA.stamps[0]?.cropBySheet).toEqual({ a: { top: 1, right: 0, bottom: 0, left: 0 } });
    // aに戻すと、aぶんのcrop(非ゼロ)が再び有効になるため変更済みになる。
    expect(isStampAdjusted(backToA, 0)).toBe(true);
  });

  describe('isStampAdjusted(「個別設定あり」ドットの判定、追加修正指示書 項目11)', () => {
    it('採用元だけ変えたスタンプは変更済みにならない', () => {
      const sheetA = makeSheet('a', 'a.png', makeFrames(2));
      const sheetB = makeSheet('b', 'b.png', makeFrames(2));
      const state = setStampSource(confirmSheets(null, [sheetA, sheetB]), 0, 'b');
      expect(isStampAdjusted(state, 0)).toBe(false);
    });

    it('スライダー(adjust)を初期値から動かすと変更済みになる', () => {
      const state = updateStampAdjust(makeProjectState(), 0, { scale: 120 });
      expect(isStampAdjusted(state, 0)).toBe(true);
    });

    it('値を初期値に戻すと変更済みでなくなる(adjustのキー自体は残っていてもよい)', () => {
      let state = updateStampAdjust(makeProjectState(), 0, { scale: 120 });
      state = updateStampAdjust(state, 0, { scale: 100 });
      expect(state.stamps[0]?.adjust).toEqual({ scale: 100 }); // キーは残る
      expect(isStampAdjusted(state, 0)).toBe(false);
    });

    it('縁フチ(outline)は、全体設定の既定値と同じなら変更済みにならない', () => {
      const withGlobalOutline = updateGlobalSettings(makeProjectState(), { defaultOutline: 6 });
      const state = updateStampAdjust(withGlobalOutline, 0, { outline: 6 });
      expect(isStampAdjusted(state, 0)).toBe(false);
    });

    it('cropを設定すると変更済みになり、全辺を0に戻すと解除される', () => {
      let state = updateStampCrop(makeProjectState(), 0, {
        top: 3,
        right: 0,
        bottom: 0,
        left: 0,
      });
      expect(isStampAdjusted(state, 0)).toBe(true);

      state = updateStampCrop(state, 0, { top: 0, right: 0, bottom: 0, left: 0 });
      expect(isStampAdjusted(state, 0)).toBe(false);
    });
  });

  it('resetStampAdjustは個別設定を解除し、先頭シート採用に戻す', () => {
    const sheetA = makeSheet('a', 'a.png', makeFrames(2));
    const sheetB = makeSheet('b', 'b.png', makeFrames(2));
    let state = confirmSheets(null, [sheetA, sheetB]);
    state = updateStampAdjust(state, 1, { scale: 120 });
    state = setStampSource(state, 1, 'b');
    const reset = resetStampAdjust(state, 1);
    expect(reset.stamps[1]).toEqual({ sourceSheetId: 'a', adjust: {}, cropBySheet: {} });
  });

  it('applyAdjustToAllは指定した項目だけ他スタンプのadjustへコピーする(採用元・cropは対象外)', () => {
    let state = makeProjectState();
    state = updateStampAdjust(state, 0, { scale: 130, offsetX: 7 });
    state = updateStampCrop(state, 0, { top: 5, right: 0, bottom: 0, left: 0 });
    state = applyAdjustToAll(state, 0, ['scale', 'offsetX']);

    expect(state.stamps[1]?.adjust).toEqual({ scale: 130, offsetX: 7 });
    expect(state.stamps[2]?.adjust).toEqual({ scale: 130, offsetX: 7 });
    expect(state.stamps[1]?.cropBySheet).toEqual({});
    // コピー元自身は変更しない
    expect(state.stamps[0]?.adjust).toEqual({ scale: 130, offsetX: 7 });
  });

  it('setSourceForAllStampsはすべてのスタンプの採用元を切り替える', () => {
    const sheetA = makeSheet('a', 'a.png', makeFrames(2));
    const sheetB = makeSheet('b', 'b.png', makeFrames(2));
    let state = confirmSheets(null, [sheetA, sheetB]);
    state = setSourceForAllStamps(state, 'b');
    expect(state.stamps.every((s) => s.sourceSheetId === 'b')).toBe(true);
  });

  it('setSourceForParityは奇数番/偶数番だけ採用元を切り替える', () => {
    const sheetA = makeSheet('a', 'a.png', makeFrames(4));
    const sheetB = makeSheet('b', 'b.png', makeFrames(4));
    let state = confirmSheets(null, [sheetA, sheetB]);
    state = setSourceForParity(state, 'b', 'odd');
    expect(state.stamps.map((s) => s.sourceSheetId)).toEqual(['b', 'a', 'b', 'a']);
  });

  it('setSourceForWarningStampsは現在の採用元に警告のあるスタンプだけ切り替える', () => {
    const framesA = makeFrames(2);
    const sheetA: Sheet = { ...makeSheet('a', 'a.png', framesA), frameWarnings: [['empty'], []] };
    const sheetB = makeSheet('b', 'b.png', makeFrames(2));
    let state = confirmSheets(null, [sheetA, sheetB]);
    state = setSourceForWarningStamps(state, 'b');
    expect(state.stamps[0]?.sourceSheetId).toBe('b'); // 警告ありだったので切り替わる
    expect(state.stamps[1]?.sourceSheetId).toBe('a'); // 警告なしなので維持
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
