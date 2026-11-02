import { describe, expect, it } from 'vitest';
import {
  addSheet,
  createSheetStore,
  getSheet,
  getSheetImage,
  removeSheet,
  renameSheet,
  reorderSheet,
  updateSheet,
} from './sheetStore';
import { DEFAULT_DETECTION_PARAMS } from './types';
import { createSolidImage } from './testUtils';

function makeImage() {
  return createSolidImage(10, 10, { r: 255, g: 255, b: 255 });
}

const DETECT_SETTINGS = { ...DEFAULT_DETECTION_PARAMS, cols: 6, rows: 4 };

describe('sheetStore', () => {
  it('addSheetはシートを追加し、画像をMapに保持する', () => {
    const store = createSheetStore();
    const { store: next, sheet } = addSheet(store, 'a.png', makeImage(), DETECT_SETTINGS);
    expect(next.sheets).toHaveLength(1);
    expect(next.sheets[0]?.name).toBe('a.png');
    expect(getSheetImage(next, sheet.id)).toBeDefined();
    expect(sheet.frames).toEqual([]);
  });

  it('異なるシートは異なるidを持つ', () => {
    let store = createSheetStore();
    const first = addSheet(store, 'a.png', makeImage(), DETECT_SETTINGS);
    store = first.store;
    const second = addSheet(store, 'b.png', makeImage(), DETECT_SETTINGS);
    expect(first.sheet.id).not.toBe(second.sheet.id);
  });

  it('removeSheetはシートと対応する画像を削除する', () => {
    let store = createSheetStore();
    const { store: afterAdd, sheet } = addSheet(store, 'a.png', makeImage(), DETECT_SETTINGS);
    store = afterAdd;
    store = removeSheet(store, sheet.id);
    expect(store.sheets).toHaveLength(0);
    expect(getSheetImage(store, sheet.id)).toBeUndefined();
  });

  it('renameSheetは指定したシートの名前だけ変更する', () => {
    let store = createSheetStore();
    const a = addSheet(store, 'a.png', makeImage(), DETECT_SETTINGS);
    store = a.store;
    const b = addSheet(store, 'b.png', makeImage(), DETECT_SETTINGS);
    store = b.store;

    store = renameSheet(store, a.sheet.id, '新しい名前');
    expect(getSheet(store, a.sheet.id)?.name).toBe('新しい名前');
    expect(getSheet(store, b.sheet.id)?.name).toBe('b.png');
  });

  it('reorderSheetはシートの並び順を1つ入れ替える', () => {
    let store = createSheetStore();
    const a = addSheet(store, 'a.png', makeImage(), DETECT_SETTINGS);
    store = a.store;
    const b = addSheet(store, 'b.png', makeImage(), DETECT_SETTINGS);
    store = b.store;

    store = reorderSheet(store, b.sheet.id, 'up');
    expect(store.sheets.map((s) => s.name)).toEqual(['b.png', 'a.png']);
  });

  it('reorderSheetは範囲外への移動では何もしない', () => {
    let store = createSheetStore();
    const a = addSheet(store, 'a.png', makeImage(), DETECT_SETTINGS);
    store = a.store;
    const afterUp = reorderSheet(store, a.sheet.id, 'up');
    expect(afterUp.sheets.map((s) => s.name)).toEqual(['a.png']);
  });

  it('updateSheetは指定したシートのメタ情報を部分更新する', () => {
    let store = createSheetStore();
    const a = addSheet(store, 'a.png', makeImage(), DETECT_SETTINGS);
    store = a.store;
    store = updateSheet(store, a.sheet.id, { frames: [{ x: 0, y: 0, width: 1, height: 1 }] });
    expect(getSheet(store, a.sheet.id)?.frames).toHaveLength(1);
  });
});
