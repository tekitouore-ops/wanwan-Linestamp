import {
  createDefaultStampSetting,
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_PREVIEW_SETTINGS,
  isStampOverridden,
  resolveStampAdjust as resolveStampAdjustFromSetting,
  type CellWarning,
  type CropAmount,
  type DetectedCell,
  type DetectionResult,
  type GlobalSettings,
  type PreviewSettings,
  type ProjectState,
  type Rect,
  type Sheet,
  type StampAdjust,
  type StampAdjustFields,
  type StampSetting,
} from './types';

// ============================================================
// ステップA: 検出枠の編集(1シートぶん)
// ============================================================

export interface EditorCell {
  index: number;
  box: Rect;
  warnings: CellWarning[];
  /** 検出結果から手動で変更されたか(サムネイルのマーク表示に使う)。 */
  isManuallyEdited: boolean;
}

export interface EditorState {
  /** 直近の検出結果(「枠の編集内容をリセット」で戻す先)。 */
  baseline: DetectedCell[];
  cells: EditorCell[];
  selectedIndex: number | null;
}

function toEditorCell(cell: DetectedCell): EditorCell {
  return { index: cell.index, box: cell.box, warnings: cell.warnings, isManuallyEdited: false };
}

/** 検出結果からエディタの初期状態を作る(再検出時はこれで選択・編集状態をリセットする)。 */
export function createEditorState(detectionResult: DetectionResult): EditorState {
  return {
    baseline: detectionResult.cells,
    cells: detectionResult.cells.map(toEditorCell),
    selectedIndex: null,
  };
}

/**
 * すでに確定済みの枠(`Rect[]`)からエディタの状態を作る。シートタブの切り替えや、
 * ステップBから「枠を修正」で戻ってきた場合に使う(警告なしの状態として扱う。
 * 必要なら「再検出」で警告を再計算できる)。
 */
export function createEditorStateFromFrames(
  frames: Rect[],
  warnings: CellWarning[][] = [],
): EditorState {
  const cells: DetectedCell[] = frames.map((box, index) => ({
    index,
    box,
    warnings: warnings[index] ?? [],
  }));
  return {
    baseline: cells,
    cells: cells.map(toEditorCell),
    selectedIndex: null,
  };
}

/** 空(未検出)のシート用の初期エディタ状態。 */
export function createEmptyEditorState(): EditorState {
  return { baseline: [], cells: [], selectedIndex: null };
}

export function selectCell(state: EditorState, index: number | null): EditorState {
  return { ...state, selectedIndex: index };
}

export function getCell(state: EditorState, index: number): EditorCell | undefined {
  return state.cells.find((cell) => cell.index === index);
}

/**
 * 手動で枠を変更する。警告は再計算せずクリアする(ユーザーが内容を見て配置した枠は
 * 自動検出の警告基準をそのまま当てはめる意味が薄いため)。
 */
export function updateCellBox(state: EditorState, index: number, box: Rect): EditorState {
  return {
    ...state,
    cells: state.cells.map((cell) =>
      cell.index === index ? { ...cell, box, warnings: [], isManuallyEdited: true } : cell,
    ),
  };
}

/** 2つの枠の中身(位置・警告)を入れ替える。番号順がズレた場合の修正用。 */
export function swapCells(state: EditorState, indexA: number, indexB: number): EditorState {
  if (indexA === indexB) {
    return state;
  }
  const cellA = getCell(state, indexA);
  const cellB = getCell(state, indexB);
  if (!cellA || !cellB) {
    return state;
  }

  return {
    ...state,
    cells: state.cells.map((cell) => {
      if (cell.index === indexA) {
        return { index: indexA, box: cellB.box, warnings: cellB.warnings, isManuallyEdited: true };
      }
      if (cell.index === indexB) {
        return { index: indexB, box: cellA.box, warnings: cellA.warnings, isManuallyEdited: true };
      }
      return cell;
    }),
  };
}

/** 1枠だけ、直近の検出結果の内容に戻す。 */
export function resetCell(state: EditorState, index: number): EditorState {
  const original = state.baseline.find((cell) => cell.index === index);
  if (!original) {
    return state;
  }
  return {
    ...state,
    cells: state.cells.map((cell) => (cell.index === index ? toEditorCell(original) : cell)),
  };
}

/** すべての枠を、直近の検出結果の内容に戻す。 */
export function resetAllCells(state: EditorState): EditorState {
  return {
    ...state,
    cells: state.baseline.map(toEditorCell),
    selectedIndex: null,
  };
}

/**
 * 保存しておいた設定JSONなどから、複数の枠をまとめて置き換える。
 * `boxes` に含まれないインデックスの枠はそのまま維持する。
 */
export function replaceBoxes(
  state: EditorState,
  boxes: Partial<Record<number, Rect>>,
): EditorState {
  return {
    ...state,
    cells: state.cells.map((cell) => {
      const box = boxes[cell.index];
      return box ? { ...cell, box, warnings: [], isManuallyEdited: true } : cell;
    }),
  };
}

/** 編集中のエディタ状態を、そのシートの`frames`/`frameWarnings`へ書き戻す(番号順に整列)。 */
export function applyEditorStateToSheet(sheet: Sheet, editor: EditorState): Sheet {
  const sorted = [...editor.cells].sort((a, b) => a.index - b.index);
  const frames: Rect[] = [];
  const frameWarnings: CellWarning[][] = [];
  sorted.forEach((cell) => {
    frames[cell.index] = cell.box;
    frameWarnings[cell.index] = cell.warnings;
  });
  return { ...sheet, frames, frameWarnings };
}

// ============================================================
// ステップB: プロジェクト状態(複数シート・採用元・個別設定・表紙・プレビュー設定)
// ============================================================

function rectEquals(a: Rect | undefined, b: Rect | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * ステップAで確定した複数シートの枠から`ProjectState`を作る(「この枠で確定」で呼ぶ)。
 * 既存の状態(`previous`)があれば、スタンプごとの採用元・個別設定(`adjust`)はそのまま引き継ぐ。
 * 採用元シートの該当番号の枠が変わっていれば、そのシートぶんの`cropBySheet`だけリセットする
 * (crop は検出枠に対する相対値のため、枠が変わると意味を失う。他の調整値は引き継ぐ。B-2参照)。
 * 採用元シートが削除されていた場合は、先頭のシートにフォールバックする。
 * 新しく追加されたシートがあっても、既存スタンプの採用元は変更しない。
 */
export function confirmSheets(previous: ProjectState | null, sheets: Sheet[]): ProjectState {
  const firstSheetId = sheets[0]?.id ?? '';
  const stampCount = sheets.reduce((max, sheet) => Math.max(max, sheet.frames.length), 0);

  const stamps: StampSetting[] = Array.from({ length: stampCount }, (_, index) => {
    const previousSetting = previous?.stamps[index];
    const sourceStillExists =
      previousSetting && sheets.some((sheet) => sheet.id === previousSetting.sourceSheetId);
    const sourceSheetId = sourceStillExists
      ? (previousSetting?.sourceSheetId as string)
      : firstSheetId;

    if (!previousSetting) {
      return createDefaultStampSetting(sourceSheetId);
    }

    const previousSheet = previous?.sheets.find((sheet) => sheet.id === sourceSheetId);
    const currentSheet = sheets.find((sheet) => sheet.id === sourceSheetId);
    const frameChanged = !rectEquals(previousSheet?.frames[index], currentSheet?.frames[index]);

    const cropBySheet = { ...previousSetting.cropBySheet };
    if (frameChanged) {
      delete cropBySheet[sourceSheetId];
    }

    return { sourceSheetId, adjust: previousSetting.adjust, cropBySheet };
  });

  return {
    version: 2,
    sheets,
    stamps,
    globalSettings: previous?.globalSettings ?? DEFAULT_GLOBAL_SETTINGS,
    coverIndex: previous && previous.coverIndex < stampCount ? previous.coverIndex : 0,
    preview: previous?.preview ?? DEFAULT_PREVIEW_SETTINGS,
  };
}

export function getStampSetting(project: ProjectState, index: number): StampSetting | undefined {
  return project.stamps[index];
}

export function getSourceSheet(project: ProjectState, index: number): Sheet | undefined {
  const setting = project.stamps[index];
  return setting ? project.sheets.find((sheet) => sheet.id === setting.sourceSheetId) : undefined;
}

export function getStampFrame(project: ProjectState, index: number): Rect | undefined {
  return getSourceSheet(project, index)?.frames[index];
}

export function getStampFrameWarnings(project: ProjectState, index: number): CellWarning[] {
  return getSourceSheet(project, index)?.frameWarnings[index] ?? [];
}

/** 選択中スタンプの、全体設定とマージ済みの実際の調整値(採用元シートのcrop込み)を得る。 */
export function getResolvedStampAdjust(project: ProjectState, index: number): StampAdjust {
  return resolveStampAdjustFromSetting(project.globalSettings, project.stamps[index]);
}

export function isStampAdjusted(project: ProjectState, index: number): boolean {
  return isStampOverridden(project.stamps[index], project.sheets[0]?.id ?? '');
}

/** 選択中スタンプの個別設定(crop以外)を部分更新する。 */
export function updateStampAdjust(
  project: ProjectState,
  index: number,
  patch: Partial<StampAdjustFields>,
): ProjectState {
  return {
    ...project,
    stamps: project.stamps.map((setting, i) =>
      i === index ? { ...setting, adjust: { ...setting.adjust, ...patch } } : setting,
    ),
  };
}

/** 選択中スタンプの、現在の採用元シートに対するcropを更新する。 */
export function updateStampCrop(
  project: ProjectState,
  index: number,
  crop: CropAmount,
): ProjectState {
  return {
    ...project,
    stamps: project.stamps.map((setting, i) =>
      i === index
        ? { ...setting, cropBySheet: { ...setting.cropBySheet, [setting.sourceSheetId]: crop } }
        : setting,
    ),
  };
}

/** 選択中スタンプの採用元シートを切り替える(adjust・cropBySheetは保持するので、戻すと復元される)。 */
export function setStampSource(
  project: ProjectState,
  index: number,
  sheetId: string,
): ProjectState {
  return {
    ...project,
    stamps: project.stamps.map((setting, i) =>
      i === index ? { ...setting, sourceSheetId: sheetId } : setting,
    ),
  };
}

/** 選択中スタンプの個別設定を解除し、全体設定の既定値・先頭シート採用に戻す。 */
export function resetStampAdjust(project: ProjectState, index: number): ProjectState {
  const firstSheetId = project.sheets[0]?.id ?? '';
  return {
    ...project,
    stamps: project.stamps.map((setting, i) =>
      i === index ? createDefaultStampSetting(firstSheetId) : setting,
    ),
  };
}

/**
 * 選択中スタンプの「補正」「配置」の値を、他のすべてのスタンプへコピーする。
 * `fields` で指定した項目だけを対象にする(「切り抜き」「採用元」はコピー対象外)。
 */
export function applyAdjustToAll(
  project: ProjectState,
  sourceIndex: number,
  fields: ReadonlyArray<keyof StampAdjustFields>,
): ProjectState {
  const resolved = getResolvedStampAdjust(project, sourceIndex);
  const patch: Partial<StampAdjustFields> = {};
  for (const field of fields) {
    (patch as Record<string, number>)[field] = resolved[field];
  }

  return {
    ...project,
    stamps: project.stamps.map((setting, i) =>
      i === sourceIndex ? setting : { ...setting, adjust: { ...setting.adjust, ...patch } },
    ),
  };
}

// ---- 採用元の一括操作(B-2「採用元をまとめて設定…」) ----

/** すべてのスタンプの採用元を指定シートにする。 */
export function setSourceForAllStamps(project: ProjectState, sheetId: string): ProjectState {
  return {
    ...project,
    stamps: project.stamps.map((setting) => ({ ...setting, sourceSheetId: sheetId })),
  };
}

/** 奇数番(No.1,3,5...)または偶数番(No.2,4,6...)だけ、採用元を指定シートにする。 */
export function setSourceForParity(
  project: ProjectState,
  sheetId: string,
  parity: 'odd' | 'even',
): ProjectState {
  return {
    ...project,
    stamps: project.stamps.map((setting, index) => {
      const stampNumber = index + 1;
      const matches = parity === 'odd' ? stampNumber % 2 === 1 : stampNumber % 2 === 0;
      return matches ? { ...setting, sourceSheetId: sheetId } : setting;
    }),
  };
}

/** 現在の採用元の枠が「空」または何らかの警告ありのスタンプだけ、採用元を指定シートにする。 */
export function setSourceForWarningStamps(project: ProjectState, sheetId: string): ProjectState {
  return {
    ...project,
    stamps: project.stamps.map((setting, index) => {
      const warnings = getStampFrameWarnings(project, index);
      return warnings.length > 0 ? { ...setting, sourceSheetId: sheetId } : setting;
    }),
  };
}

export function setCoverIndex(project: ProjectState, index: number): ProjectState {
  return { ...project, coverIndex: index };
}

export function updateGlobalSettings(
  project: ProjectState,
  patch: Partial<GlobalSettings>,
): ProjectState {
  return { ...project, globalSettings: { ...project.globalSettings, ...patch } };
}

export function setPreview(project: ProjectState, preview: PreviewSettings): ProjectState {
  return { ...project, preview };
}
