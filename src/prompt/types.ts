import { DEFAULT_GRID, STAMP_COUNT } from '../shared/lineSpec';

/** 24行の表の1行分(お題・状況・セリフ)。 */
export interface StampRow {
  topic: string;
  situation: string;
  line: string;
}

/** 書体イメージのプリセット。`custom` のときは `fontStyleCustom` の自由入力文字列を使う。 */
export type FontStylePreset = 'handwritten-round-gothic' | 'pop-bold' | 'mincho' | 'custom';

export const FONT_STYLE_PRESETS: ReadonlyArray<{ id: FontStylePreset; label: string }> = [
  { id: 'handwritten-round-gothic', label: '手書き風の太い丸ゴシック' },
  { id: 'pop-bold', label: 'ポップな太字' },
  { id: 'mincho', label: '明朝風' },
  { id: 'custom', label: 'その他(自由入力)' },
];

/** タブ①の共通設定。 */
export interface PromptSettings {
  characterNote: string;
  fontStylePreset: FontStylePreset;
  fontStyleCustom: string;
  textColor: string;
  textOutline: boolean;
  backgroundColor: string;
  /** プロンプト内で白フチ付与を指示するか(既定OFF。理由はdocs/decisions.md参照)。 */
  instructWhiteOutlineInPrompt: boolean;
  additionalInstructions: string;
  cols: number;
  rows: number;
}

export const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
  characterNote: '',
  fontStylePreset: 'handwritten-round-gothic',
  fontStyleCustom: '',
  textColor: '#5A3A22',
  textOutline: true,
  backgroundColor: '#FFFFFF',
  instructWhiteOutlineInPrompt: false,
  additionalInstructions: '',
  cols: DEFAULT_GRID.cols,
  rows: DEFAULT_GRID.rows,
};

/** 書体設定から、プロンプトに書き出す書体の文言を決定する。 */
export function resolveFontStyleLabel(settings: PromptSettings): string {
  if (settings.fontStylePreset === 'custom') {
    return settings.fontStyleCustom.trim() || 'お好みの書体';
  }
  const preset = FONT_STYLE_PRESETS.find((candidate) => candidate.id === settings.fontStylePreset);
  return preset ? preset.label : settings.fontStylePreset;
}

export function createEmptyRow(): StampRow {
  return { topic: '', situation: '', line: '' };
}

export function createEmptyRows(count: number = STAMP_COUNT): StampRow[] {
  return Array.from({ length: count }, () => createEmptyRow());
}

/** 入力表のうち「お題」「状況」のどちらかが未入力の行番号(1始まり)を返す。 */
export function findIncompleteRowNumbers(rows: StampRow[]): number[] {
  const numbers: number[] = [];
  rows.forEach((row, index) => {
    if (row.topic.trim() === '' || row.situation.trim() === '') {
      numbers.push(index + 1);
    }
  });
  return numbers;
}
