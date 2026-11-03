/**
 * Undo/Redo用の汎用履歴(スナップショット方式)。ステップB(`ProjectState`)・ステップAの
 * 枠編集(`EditorState`)の両方で、別々のスタックとして使う(修正指示書 項目4参照)。
 * `T`に画像データを含めない型を渡すことで、履歴に画像本体を持たせない方針を保つ。
 */
export interface History<T> {
  /** 古い順。末尾が直前の状態。 */
  readonly past: T[];
  readonly present: T;
  readonly future: T[];
}

/** 保持する手数の上限。これを超えると古いものから捨てる。 */
export const HISTORY_CAP = 50;

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [] };
}

/**
 * 現在の状態を履歴に積み、`next`を新しい現在にする。
 * 新しい操作をコミットした時点でredo用のfutureは無効になる(消える)。
 */
export function push<T>(history: History<T>, next: T, cap: number = HISTORY_CAP): History<T> {
  const past = [...history.past, history.present];
  return {
    past: past.length > cap ? past.slice(past.length - cap) : past,
    present: next,
    future: [],
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) {
    return history;
  }
  const previous = history.past[history.past.length - 1] as T;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) {
    return history;
  }
  const next = history.future[0] as T;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}
