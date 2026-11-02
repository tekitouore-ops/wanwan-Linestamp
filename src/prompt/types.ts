import { STAMP_COUNT } from '../shared/lineSpec';

/** 24行の表の1行分(セリフ・状況)。セリフが先、状況が後(マスの番号順に対応)。 */
export interface StampRow {
  line: string;
  situation: string;
}

/**
 * タブ①の共通設定。プロンプト本文のほぼ全部を固定文にしたため、
 * 可変なのはキャラクター補足・追加指示(どちらも任意)のみ。
 * 書体・文字色・縁取り・背景色の設定は廃止した(docs/decisions.md参照)。
 */
export interface PromptSettings {
  characterNote: string;
  additionalInstructions: string;
}

export const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
  characterNote: '',
  additionalInstructions: '',
};

export function createEmptyRow(): StampRow {
  return { line: '', situation: '' };
}

export function createEmptyRows(count: number = STAMP_COUNT): StampRow[] {
  return Array.from({ length: count }, () => createEmptyRow());
}

/** 入力表のうち、セリフ・状況の両方が未入力の行番号(1始まり)を返す。 */
export function findIncompleteRowNumbers(rows: StampRow[]): number[] {
  const numbers: number[] = [];
  rows.forEach((row, index) => {
    if (row.line.trim() === '' && row.situation.trim() === '') {
      numbers.push(index + 1);
    }
  });
  return numbers;
}

/** セリフが未入力の行番号(1始まり)を返す(サマリー表示用)。 */
export function findEmptyLineRowNumbers(rows: StampRow[]): number[] {
  const numbers: number[] = [];
  rows.forEach((row, index) => {
    if (row.line.trim() === '') {
      numbers.push(index + 1);
    }
  });
  return numbers;
}

/** 状況が未入力の行番号(1始まり)を返す(サマリー表示用)。 */
export function findEmptySituationRowNumbers(rows: StampRow[]): number[] {
  const numbers: number[] = [];
  rows.forEach((row, index) => {
    if (row.situation.trim() === '') {
      numbers.push(index + 1);
    }
  });
  return numbers;
}

/** 入力済み(セリフ・状況のどちらかに入力がある)の行数(サマリー表示用)。 */
export function countFilledRows(rows: StampRow[]): number {
  return rows.filter((row) => row.line.trim() !== '' || row.situation.trim() !== '').length;
}
