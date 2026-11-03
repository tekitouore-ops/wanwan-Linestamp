import { describe, expect, it } from 'vitest';
import { countUnassignedSheets, matchSheetsByNameAndSize, remapProjectIds } from './sheetMatch';
import {
  createDefaultStampSetting,
  DEFAULT_DETECTION_PARAMS,
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_PREVIEW_SETTINGS,
  type ProjectState,
  type Sheet,
} from './types';

function makeSheet(id: string, name: string, width: number, height: number): Sheet {
  return {
    id,
    name,
    width,
    height,
    detectSettings: { ...DEFAULT_DETECTION_PARAMS, cols: 6, rows: 4 },
    frames: [],
    frameWarnings: [],
  };
}

describe('matchSheetsByNameAndSize', () => {
  it('名前・サイズの両方が一致すれば自動対応づけする', () => {
    const saved = [makeSheet('saved-1', 'a.png', 1536, 1024)];
    const current = [makeSheet('cur-1', 'a.png', 1536, 1024)];

    const result = matchSheetsByNameAndSize(saved, current);

    expect(result.idMap).toEqual({ 'saved-1': 'cur-1' });
    expect(result.needsAssignment).toEqual([]);
  });

  it('名前が一致してもサイズが違えば自動対応づけせず、候補として返す', () => {
    const saved = [makeSheet('saved-1', 'a.png', 1536, 1024)];
    const current = [makeSheet('cur-1', 'a.png', 800, 600)];

    const result = matchSheetsByNameAndSize(saved, current);

    expect(result.idMap).toEqual({});
    expect(result.needsAssignment).toEqual([
      { savedSheet: saved[0], suggestedSheetId: 'cur-1', sizeMismatch: true },
    ]);
  });

  it('名前が一致しなければ、候補なしの手動割り当て対象になる', () => {
    const saved = [makeSheet('saved-1', 'a.png', 1536, 1024)];
    const current = [makeSheet('cur-1', 'b.png', 1536, 1024)];

    const result = matchSheetsByNameAndSize(saved, current);

    expect(result.idMap).toEqual({});
    expect(result.needsAssignment).toEqual([
      { savedSheet: saved[0], suggestedSheetId: undefined, sizeMismatch: false },
    ]);
  });

  it('現在のシートが1枚もなければ、すべて手動割り当て対象になる', () => {
    const saved = [makeSheet('saved-1', 'a.png', 1536, 1024)];
    const result = matchSheetsByNameAndSize(saved, []);

    expect(result.idMap).toEqual({});
    expect(result.needsAssignment).toHaveLength(1);
    expect(result.needsAssignment[0]?.suggestedSheetId).toBeUndefined();
  });

  it('1枚の現在のシートは、1件の保存シートにしか自動対応づけされない(重複しない)', () => {
    const saved = [
      makeSheet('saved-1', 'a.png', 1536, 1024),
      makeSheet('saved-2', 'a.png', 1536, 1024),
    ];
    const current = [makeSheet('cur-1', 'a.png', 1536, 1024)];

    const result = matchSheetsByNameAndSize(saved, current);

    expect(result.idMap).toEqual({ 'saved-1': 'cur-1' });
    expect(result.needsAssignment).toHaveLength(1);
    expect(result.needsAssignment[0]?.savedSheet.id).toBe('saved-2');
    // 2件目は、現在のシートが1件目で消費済みのため「名前一致候補」としては見つからない
    // (サイズ一致での自動対応づけ候補探索のみが「使用済み除外」の対象であり、
    // 手動割り当ての既定候補〈suggestedSheetId〉は使用済みでも提示してよい)。
    expect(result.needsAssignment[0]?.suggestedSheetId).toBe('cur-1');
    expect(result.needsAssignment[0]?.sizeMismatch).toBe(true);
  });

  it('保存シートが複数あり、それぞれ別の現在のシートに自動対応づけされる', () => {
    const saved = [
      makeSheet('saved-1', 'a.png', 100, 100),
      makeSheet('saved-2', 'b.png', 200, 200),
    ];
    const current = [makeSheet('cur-1', 'a.png', 100, 100), makeSheet('cur-2', 'b.png', 200, 200)];

    const result = matchSheetsByNameAndSize(saved, current);

    expect(result.idMap).toEqual({ 'saved-1': 'cur-1', 'saved-2': 'cur-2' });
    expect(result.needsAssignment).toEqual([]);
  });
});

function makeProject(
  sheets: Sheet[],
  stamps: Array<{
    sourceSheetId: string;
    cropBySheet?: Record<string, { top: number; bottom: number; left: number; right: number }>;
  }>,
): ProjectState {
  return {
    version: 2,
    sheets,
    stamps: stamps.map((s) => ({
      ...createDefaultStampSetting(s.sourceSheetId),
      cropBySheet: s.cropBySheet ?? {},
    })),
    globalSettings: DEFAULT_GLOBAL_SETTINGS,
    coverIndex: 0,
    preview: DEFAULT_PREVIEW_SETTINGS,
  };
}

describe('remapProjectIds', () => {
  it('対応づけられたシート・スタンプのidを、現在のシートのidへ付け替える', () => {
    const savedSheet = makeSheet('saved-1', 'a.png', 1536, 1024);
    const currentSheet = makeSheet('cur-1', 'a.png', 1536, 1024);
    const parsed = makeProject(
      [savedSheet],
      [
        {
          sourceSheetId: 'saved-1',
          cropBySheet: { 'saved-1': { top: 1, bottom: 2, left: 3, right: 4 } },
        },
      ],
    );

    const result = remapProjectIds(parsed, new Map([['saved-1', 'cur-1']]), [currentSheet]);

    expect(result.sheets[0]?.id).toBe('cur-1');
    expect(result.stamps[0]?.sourceSheetId).toBe('cur-1');
    expect(result.stamps[0]?.cropBySheet).toEqual({
      'cur-1': { top: 1, bottom: 2, left: 3, right: 4 },
    });
  });

  it('割り当てなしのシートは、保存時のidのまま残す(現在のシートの画像を持たない)', () => {
    const savedSheet = makeSheet('saved-1', 'a.png', 1536, 1024);
    const parsed = makeProject([savedSheet], [{ sourceSheetId: 'saved-1' }]);

    const result = remapProjectIds(parsed, new Map(), []);

    // 現在のシート一覧(store.sheets相当)にこのidの画像が存在しないため、
    // 呼び出し側(previewView.ts の renderCard)は画像なし=「採用元のシートが見つかりません」として扱う。
    expect(result.sheets[0]?.id).toBe('saved-1');
    expect(result.stamps[0]?.sourceSheetId).toBe('saved-1');
  });

  it('複数シート・複数スタンプのidを、それぞれ独立して付け替える', () => {
    const savedA = makeSheet('saved-a', 'a.png', 100, 100);
    const savedB = makeSheet('saved-b', 'b.png', 200, 200);
    const curA = makeSheet('cur-a', 'a.png', 100, 100);
    const curB = makeSheet('cur-b', 'b.png', 200, 200);
    const parsed = makeProject(
      [savedA, savedB],
      [{ sourceSheetId: 'saved-a' }, { sourceSheetId: 'saved-b' }],
    );

    const result = remapProjectIds(
      parsed,
      new Map([
        ['saved-a', 'cur-a'],
        ['saved-b', 'cur-b'],
      ]),
      [curA, curB],
    );

    expect(result.sheets.map((s) => s.id)).toEqual(['cur-a', 'cur-b']);
    expect(result.stamps.map((s) => s.sourceSheetId)).toEqual(['cur-a', 'cur-b']);
  });
});

describe('countUnassignedSheets', () => {
  it('割り当てられなかった保存シートの数を返す', () => {
    const parsed = makeProject(
      [makeSheet('saved-1', 'a.png', 100, 100), makeSheet('saved-2', 'b.png', 200, 200)],
      [{ sourceSheetId: 'saved-1' }, { sourceSheetId: 'saved-2' }],
    );

    expect(countUnassignedSheets(parsed, new Map([['saved-1', 'cur-1']]))).toBe(1);
    expect(countUnassignedSheets(parsed, new Map())).toBe(2);
    expect(
      countUnassignedSheets(
        parsed,
        new Map([
          ['saved-1', 'cur-1'],
          ['saved-2', 'cur-2'],
        ]),
      ),
    ).toBe(0);
  });
});
