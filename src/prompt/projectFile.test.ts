import { describe, expect, it } from 'vitest';
import { STAMP_COUNT } from '../shared/lineSpec';
import { createEmptyRows, DEFAULT_PROMPT_SETTINGS } from './types';
import { deserializeProject, serializeProject } from './projectFile';

describe('serializeProject / deserializeProject', () => {
  it('シリアライズしたJSONを読み込むと元のrows/settingsに戻る', () => {
    const rows = createEmptyRows();
    rows[0] = { topic: 'おはよう', situation: '朝に手を振る', line: 'やっほー' };
    const settings = { ...DEFAULT_PROMPT_SETTINGS, backgroundColor: '#2E7D32' };

    const json = serializeProject(rows, settings);
    const result = deserializeProject(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual(rows);
      expect(result.settings).toEqual(settings);
    }
  });

  it('versionフィールドを含む', () => {
    const json = serializeProject(createEmptyRows(), DEFAULT_PROMPT_SETTINGS);
    const parsed = JSON.parse(json) as { version: number };
    expect(parsed.version).toBe(1);
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
    const result = deserializeProject(JSON.stringify({ version: 1, rows: [] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings).toEqual(DEFAULT_PROMPT_SETTINGS);
      expect(result.rows).toHaveLength(STAMP_COUNT);
    }
  });

  it('rowsが24行に満たない場合は空欄で補う', () => {
    const result = deserializeProject(
      JSON.stringify({ version: 1, rows: [{ topic: 'A', situation: 'B', line: 'C' }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(STAMP_COUNT);
      expect(result.rows[0]).toEqual({ topic: 'A', situation: 'B', line: 'C' });
      expect(result.rows[1]).toEqual({ topic: '', situation: '', line: '' });
    }
  });

  it('不正な型のフィールドは既定値にフォールバックする', () => {
    const result = deserializeProject(
      JSON.stringify({ version: 1, rows: [], settings: { textOutline: 'yes', cols: 'six' } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.textOutline).toBe(DEFAULT_PROMPT_SETTINGS.textOutline);
      expect(result.settings.cols).toBe(DEFAULT_PROMPT_SETTINGS.cols);
    }
  });
});
