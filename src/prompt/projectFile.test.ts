import { describe, expect, it } from 'vitest';
import { STAMP_COUNT } from '../shared/lineSpec';
import { createEmptyRows, DEFAULT_PROMPT_SETTINGS } from './types';
import { deserializeProject, PROJECT_FILE_VERSION, serializeProject } from './projectFile';

describe('serializeProject / deserializeProject', () => {
  it('シリアライズしたJSONを読み込むと元のrows/settingsに戻る', () => {
    const rows = createEmptyRows();
    rows[0] = { line: 'やっほー', situation: '朝に手を振る' };
    const settings = { ...DEFAULT_PROMPT_SETTINGS, characterNote: 'フランスパンのキャラクター' };

    const json = serializeProject(rows, settings);
    const result = deserializeProject(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual(rows);
      expect(result.settings).toEqual(settings);
    }
  });

  it('versionフィールドは2を含む', () => {
    expect(PROJECT_FILE_VERSION).toBe(2);
    const json = serializeProject(createEmptyRows(), DEFAULT_PROMPT_SETTINGS);
    const parsed = JSON.parse(json) as { version: number };
    expect(parsed.version).toBe(2);
  });

  it('壊れたJSON文字列はエラーを返す', () => {
    const result = deserializeProject('{ this is not json');
    expect(result.ok).toBe(false);
  });

  it('rowsフィールドがないオブジェクトはエラーを返す', () => {
    const result = deserializeProject(JSON.stringify({ foo: 'bar' }));
    expect(result.ok).toBe(false);
  });

  it('settingsが欠けている場合は既定値で補う', () => {
    const result = deserializeProject(JSON.stringify({ version: 2, rows: [] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings).toEqual(DEFAULT_PROMPT_SETTINGS);
      expect(result.rows).toHaveLength(STAMP_COUNT);
    }
  });

  it('rowsが24行に満たない場合は空欄で補う', () => {
    const result = deserializeProject(
      JSON.stringify({ version: 2, rows: [{ line: 'A', situation: 'B' }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(STAMP_COUNT);
      expect(result.rows[0]).toEqual({ line: 'A', situation: 'B' });
      expect(result.rows[1]).toEqual({ line: '', situation: '' });
    }
  });

  it('v1(お題・書体・文字色等を含む旧形式)のデータを読み込んでも落ちず、セリフと状況だけ引き継ぐ', () => {
    const legacyJson = JSON.stringify({
      version: 1,
      rows: [{ topic: 'おはよう', situation: '朝に手を振る', line: 'やっほー' }],
      settings: {
        characterNote: 'フランスパンのキャラクター',
        fontStylePreset: 'pop-bold',
        fontStyleCustom: '',
        textColor: '#123456',
        textOutline: true,
        backgroundColor: '#FFFFFF',
        instructWhiteOutlineInPrompt: false,
        additionalInstructions: '影は描かない',
        cols: 6,
        rows: 4,
      },
    });
    const result = deserializeProject(legacyJson);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0]).toEqual({ line: 'やっほー', situation: '朝に手を振る' });
      expect(result.rows).toHaveLength(STAMP_COUNT);
      expect(result.settings).toEqual({
        characterNote: 'フランスパンのキャラクター',
        additionalInstructions: '影は描かない',
      });
      expect(result.settings).not.toHaveProperty('fontStylePreset');
      expect(result.settings).not.toHaveProperty('textColor');
      expect(result.settings).not.toHaveProperty('backgroundColor');
    }
  });

  it('不正な型のフィールドは既定値にフォールバックする', () => {
    const result = deserializeProject(
      JSON.stringify({ version: 2, rows: [], settings: { characterNote: 42 } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.characterNote).toBe(DEFAULT_PROMPT_SETTINGS.characterNote);
    }
  });
});
