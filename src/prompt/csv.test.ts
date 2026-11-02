import { describe, expect, it } from 'vitest';
import { STAMP_COUNT } from '../shared/lineSpec';
import { buildCsvTemplate, parseRows } from './csv';

function makeCsvRows(count: number): string {
  return Array.from({ length: count }, (_, i) => `お題${i + 1},状況${i + 1},セリフ${i + 1}`).join(
    '\n',
  );
}

describe('parseRows', () => {
  it('ヘッダーなしのCSVを24行として解釈する', () => {
    const { rows, warnings } = parseRows(makeCsvRows(STAMP_COUNT));
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(rows[0]).toEqual({ topic: 'お題1', situation: '状況1', line: 'セリフ1' });
    expect(rows[23]).toEqual({ topic: 'お題24', situation: '状況24', line: 'セリフ24' });
    expect(warnings).toEqual([]);
  });

  it('ヘッダーありのCSVはヘッダー行を除外する', () => {
    const input = `お題,状況,セリフ\n${makeCsvRows(STAMP_COUNT)}`;
    const { rows, warnings } = parseRows(input);
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(rows[0]).toEqual({ topic: 'お題1', situation: '状況1', line: 'セリフ1' });
    expect(warnings).toEqual([]);
  });

  it('TSV(タブ区切り)にも対応する', () => {
    const input = Array.from(
      { length: STAMP_COUNT },
      (_, i) => `お題${i + 1}\t状況${i + 1}\tセリフ${i + 1}`,
    ).join('\n');
    const { rows } = parseRows(input);
    expect(rows[0]).toEqual({ topic: 'お題1', situation: '状況1', line: 'セリフ1' });
  });

  it('カンマ・改行を含む引用符付きセルを正しく扱う', () => {
    const input = '"おはよう、こんにちは","朝(自宅)で\n手を振る","「やあ」"';
    const { rows } = parseRows(input);
    expect(rows[0]).toEqual({
      topic: 'おはよう、こんにちは',
      situation: '朝(自宅)で\n手を振る',
      line: '「やあ」',
    });
  });

  it('24行を超える分は無視して警告する', () => {
    const { rows, warnings } = parseRows(makeCsvRows(30));
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(rows[23]).toEqual({ topic: 'お題24', situation: '状況24', line: 'セリフ24' });
    expect(warnings.some((w) => w.includes('超える'))).toBe(true);
  });

  it('24行に満たない場合は不足分を空欄にして警告する', () => {
    const { rows, warnings } = parseRows(makeCsvRows(5));
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(rows[4]).toEqual({ topic: 'お題5', situation: '状況5', line: 'セリフ5' });
    expect(rows[5]).toEqual({ topic: '', situation: '', line: '' });
    expect(warnings.some((w) => w.includes('満たない'))).toBe(true);
  });

  it('セリフ列が省略された行は空文字として扱う', () => {
    const { rows } = parseRows('おはよう,朝に手を振る');
    expect(rows[0]).toEqual({ topic: 'おはよう', situation: '朝に手を振る', line: '' });
  });

  it('空文字列の入力は24行すべて空欄になる', () => {
    const { rows, warnings } = parseRows('');
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(rows.every((row) => row.topic === '' && row.situation === '' && row.line === '')).toBe(
      true,
    );
    expect(warnings).toEqual([]);
  });
});

describe('buildCsvTemplate', () => {
  it('ヘッダー行+24行の空欄を生成する', () => {
    const template = buildCsvTemplate();
    const lines = template.split('\n');
    expect(lines[0]).toBe('お題,状況,セリフ');
    expect(lines).toHaveLength(STAMP_COUNT + 1);
    expect(lines.slice(1).every((line) => line === ',,')).toBe(true);
  });
});
