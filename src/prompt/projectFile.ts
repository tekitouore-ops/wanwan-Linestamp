import { STAMP_COUNT } from '../shared/lineSpec';
import {
  DEFAULT_PROMPT_SETTINGS,
  FONT_STYLE_PRESETS,
  createEmptyRow,
  type FontStylePreset,
  type PromptSettings,
  type StampRow,
} from './types';

export const PROJECT_FILE_VERSION = 1;

export interface PromptProjectFile {
  version: typeof PROJECT_FILE_VERSION;
  rows: StampRow[];
  settings: PromptSettings;
}

export type DeserializeResult =
  { ok: true; rows: StampRow[]; settings: PromptSettings } | { ok: false; error: string };

export function serializeProject(rows: StampRow[], settings: PromptSettings): string {
  const payload: PromptProjectFile = { version: PROJECT_FILE_VERSION, rows, settings };
  return JSON.stringify(payload, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeRows(value: unknown): StampRow[] {
  const source = Array.isArray(value) ? value : [];
  const rows: StampRow[] = [];
  for (let i = 0; i < STAMP_COUNT; i += 1) {
    const candidate = source[i];
    if (isRecord(candidate)) {
      rows.push({
        topic: typeof candidate.topic === 'string' ? candidate.topic : '',
        situation: typeof candidate.situation === 'string' ? candidate.situation : '',
        line: typeof candidate.line === 'string' ? candidate.line : '',
      });
    } else {
      rows.push(createEmptyRow());
    }
  }
  return rows;
}

function isFontStylePreset(value: unknown): value is FontStylePreset {
  return typeof value === 'string' && FONT_STYLE_PRESETS.some((preset) => preset.id === value);
}

function normalizeSettings(value: unknown): PromptSettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_PROMPT_SETTINGS };
  }
  return {
    characterNote:
      typeof value.characterNote === 'string'
        ? value.characterNote
        : DEFAULT_PROMPT_SETTINGS.characterNote,
    fontStylePreset: isFontStylePreset(value.fontStylePreset)
      ? value.fontStylePreset
      : DEFAULT_PROMPT_SETTINGS.fontStylePreset,
    fontStyleCustom:
      typeof value.fontStyleCustom === 'string'
        ? value.fontStyleCustom
        : DEFAULT_PROMPT_SETTINGS.fontStyleCustom,
    textColor:
      typeof value.textColor === 'string' ? value.textColor : DEFAULT_PROMPT_SETTINGS.textColor,
    textOutline:
      typeof value.textOutline === 'boolean'
        ? value.textOutline
        : DEFAULT_PROMPT_SETTINGS.textOutline,
    backgroundColor:
      typeof value.backgroundColor === 'string'
        ? value.backgroundColor
        : DEFAULT_PROMPT_SETTINGS.backgroundColor,
    instructWhiteOutlineInPrompt:
      typeof value.instructWhiteOutlineInPrompt === 'boolean'
        ? value.instructWhiteOutlineInPrompt
        : DEFAULT_PROMPT_SETTINGS.instructWhiteOutlineInPrompt,
    additionalInstructions:
      typeof value.additionalInstructions === 'string'
        ? value.additionalInstructions
        : DEFAULT_PROMPT_SETTINGS.additionalInstructions,
    cols:
      typeof value.cols === 'number' && value.cols > 0 ? value.cols : DEFAULT_PROMPT_SETTINGS.cols,
    rows:
      typeof value.rows === 'number' && value.rows > 0 ? value.rows : DEFAULT_PROMPT_SETTINGS.rows,
  };
}

/**
 * プロジェクトJSONを読み込む。ファイル境界からの入力のため、型を保証せず1項目ずつ検証する。
 * 壊れたフィールドは既定値で補い、致命的に形式が違う場合のみエラーを返す。
 */
export function deserializeProject(json: string): DeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSONの解析に失敗しました。ファイルの内容を確認してください。' };
  }

  if (!isRecord(parsed) || !('rows' in parsed)) {
    return { ok: false, error: 'プロジェクトファイルの形式が正しくありません。' };
  }

  return {
    ok: true,
    rows: normalizeRows(parsed.rows),
    settings: normalizeSettings(parsed.settings),
  };
}
