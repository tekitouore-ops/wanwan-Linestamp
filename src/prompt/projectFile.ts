import { STAMP_COUNT } from '../shared/lineSpec';
import {
  createEmptyRow,
  DEFAULT_PROMPT_SETTINGS,
  type PromptSettings,
  type StampRow,
} from './types';

export const PROJECT_FILE_VERSION = 2;

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

/**
 * `rows`を読み込む。v1(お題・状況・セリフ)のデータが来ても、line/situationフィールドは
 * 同じ名前のまま存在するため、お題は単に読み捨てる形で自然に移行できる。
 */
function normalizeRows(value: unknown): StampRow[] {
  const source = Array.isArray(value) ? value : [];
  const rows: StampRow[] = [];
  for (let i = 0; i < STAMP_COUNT; i += 1) {
    const candidate = source[i];
    if (isRecord(candidate)) {
      rows.push({
        line: typeof candidate.line === 'string' ? candidate.line : '',
        situation: typeof candidate.situation === 'string' ? candidate.situation : '',
      });
    } else {
      rows.push(createEmptyRow());
    }
  }
  return rows;
}

/**
 * `settings`を読み込む。v1には書体・文字色・縁取り・背景色などのフィールドもあるが、
 * 新しい`PromptSettings`はcharacterNote/additionalInstructionsしか読まないため、
 * それ以外は自動的に捨てられる(docs/decisions.md参照)。
 */
function normalizeSettings(value: unknown): PromptSettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_PROMPT_SETTINGS };
  }
  return {
    characterNote:
      typeof value.characterNote === 'string'
        ? value.characterNote
        : DEFAULT_PROMPT_SETTINGS.characterNote,
    additionalInstructions:
      typeof value.additionalInstructions === 'string'
        ? value.additionalInstructions
        : DEFAULT_PROMPT_SETTINGS.additionalInstructions,
  };
}

/**
 * プロジェクトJSONを読み込む。ファイル境界からの入力のため、型を保証せず1項目ずつ検証する。
 * v1(旧お題・書体・文字色等を含む形式)のデータも、rows/settingsとも壊れずに移行できる
 * (お題・書体・文字色・縁取り・白フチ・背景色は読み捨て、セリフと状況だけ引き継ぐ)。
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
