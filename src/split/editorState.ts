import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_PREVIEW_SETTINGS,
  resolveStampAdjust,
  type CellWarning,
  type DetectedCell,
  type DetectionResult,
  type GlobalSettings,
  type PreviewSettings,
  type ProjectState,
  type Rect,
  type StampAdjust,
} from './types';

// ============================================================
// ステップA: 検出枠の編集
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
 * すでに確定済みの枠(`Rect[]`)からエディタの状態を作る。ステップBから「枠を修正」で
 * 戻ってきた場合に使う(警告なしの状態として扱う。必要なら「再検出」で警告を再計算できる)。
 */
export function createEditorStateFromFrames(frames: Rect[]): EditorState {
  const cells: DetectedCell[] = frames.map((box, index) => ({ index, box, warnings: [] }));
  return {
    baseline: cells,
    cells: cells.map(toEditorCell),
    selectedIndex: null,
  };
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
export function replaceBoxes(state: EditorState, boxes: Partial<Record<number, Rect>>): EditorState {
  return {
    ...state,
    cells: state.cells.map((cell) => {
      const box = boxes[cell.index];
      return box ? { ...cell, box, warnings: [], isManuallyEdited: true } : cell;
    }),
  };
}

// ============================================================
// ステップB: プロジェクト状態(個別設定・表紙・プレビュー設定)
// ============================================================

function rectEquals(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * ステップAで確定した枠から`ProjectState`を作る。既存の状態(`previous`)があり、
 * 同じシート画像・同じ枠のスタンプについては、個別設定(`stamps[i]`)をそのまま引き継ぐ。
 * 枠が変わった、または新規のスタンプは個別設定をリセットする。
 */
export function confirmFrames(previous: ProjectState | null, sourceName: string, frames: Rect[]): ProjectState {
  const sameSource = previous !== null && previous.sourceName === sourceName;

  const stamps = frames.map((frame, index) => {
    if (!sameSource) {
      return {};
    }
    const previousFrame = previous?.frames[index];
    const previousStamp = previous?.stamps[index];
    return previousFrame && rectEquals(previousFrame, frame) ? (previousStamp ?? {}) : {};
  });

  return {
    version: 1,
    sourceName,
    frames,
    globalSettings: previous?.globalSettings ?? DEFAULT_GLOBAL_SETTINGS,
    stamps,
    coverIndex: previous && previous.coverIndex < frames.length ? previous.coverIndex : 0,
    preview: previous?.preview ?? DEFAULT_PREVIEW_SETTINGS,
  };
}

/** 選択中スタンプの、全体設定とマージ済みの実際の調整値を得る。 */
export function getResolvedStampAdjust(state: ProjectState, index: number): StampAdjust {
  return resolveStampAdjust(state.globalSettings, state.stamps[index]);
}

export function isStampAdjusted(state: ProjectState, index: number): boolean {
  const override = state.stamps[index];
  return Boolean(override) && Object.keys(override as Partial<StampAdjust>).length > 0;
}

/** 選択中スタンプの個別設定を部分更新する。 */
export function updateStampAdjust(state: ProjectState, index: number, patch: Partial<StampAdjust>): ProjectState {
  return {
    ...state,
    stamps: state.stamps.map((stamp, i) => (i === index ? { ...stamp, ...patch } : stamp)),
  };
}

/** 選択中スタンプの個別設定を解除し、全体設定の既定値に戻す。 */
export function resetStampAdjust(state: ProjectState, index: number): ProjectState {
  return {
    ...state,
    stamps: state.stamps.map((stamp, i) => (i === index ? {} : stamp)),
  };
}

/**
 * 選択中スタンプの「補正」「配置」の値を、他のすべてのスタンプへコピーする。
 * `fields` で指定した項目だけを対象にする(「切り抜き」はコピー対象外)。
 */
export function applyAdjustToAll(
  state: ProjectState,
  sourceIndex: number,
  fields: ReadonlyArray<Exclude<keyof StampAdjust, 'crop'>>,
): ProjectState {
  const resolved = getResolvedStampAdjust(state, sourceIndex);
  const patch: Partial<StampAdjust> = {};
  for (const field of fields) {
    (patch as Record<string, number>)[field] = resolved[field];
  }

  return {
    ...state,
    stamps: state.stamps.map((stamp, i) => (i === sourceIndex ? stamp : { ...stamp, ...patch })),
  };
}

export function setCoverIndex(state: ProjectState, index: number): ProjectState {
  return { ...state, coverIndex: index };
}

export function updateGlobalSettings(state: ProjectState, patch: Partial<GlobalSettings>): ProjectState {
  return { ...state, globalSettings: { ...state.globalSettings, ...patch } };
}

export function setPreview(state: ProjectState, preview: PreviewSettings): ProjectState {
  return { ...state, preview };
}
