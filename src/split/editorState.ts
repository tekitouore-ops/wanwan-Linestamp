import type { BBox, CellWarning, DetectedCell, DetectionResult } from './types';

export interface EditorCell {
  index: number;
  box: BBox;
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
export function updateCellBox(state: EditorState, index: number, box: BBox): EditorState {
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
  boxes: Partial<Record<number, BBox>>,
): EditorState {
  return {
    ...state,
    cells: state.cells.map((cell) => {
      const box = boxes[cell.index];
      return box ? { ...cell, box, warnings: [], isManuallyEdited: true } : cell;
    }),
  };
}
