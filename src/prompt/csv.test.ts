import { describe, expect, it } from 'vitest';
import { STAMP_COUNT } from '../shared/lineSpec';
import { buildCsvTemplate, parseRows } from './csv';

function makeCsvRows(count: number): string {
  return Array.from({ length: count }, (_, i) => `せりふ${i + 1},状況${i + 1}`).join('\n');
}

describe('parseRows: セリフ,状況の2列形式', () => {
  it('ヘッダーなしのCSVを24行として解釈する', () => {
    const { rows, warnings } = parseRows(makeCsvRows(STAMP_COUNT));
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(rows[0]).toEqual({ line: 'せりふ1', situation: '状況1' });
    expect(rows[23]).toEqual({ line: 'せりふ24', situation: '状況24' });
    expect(warnings).toEqual([]);
  });

  it('ヘッダーありのCSVはヘッダー行を除外する', () => {
    const input = `セリフ,状況\n${makeCsvRows(STAMP_COUNT)}`;
    const { rows, warnings } = parseRows(input);
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(rows[0]).toEqual({ line: 'せりふ1', situation: '状況1' });
    expect(warnings).toEqual([]);
  });

  it('TSV(タブ区切り)にも対応する', () => {
    const input = Array.from(
      { length: STAMP_COUNT },
      (_, i) => `せりふ${i + 1}\t状況${i + 1}`,
    ).join('\n');
    const { rows } = parseRows(input);
    expect(rows[0]).toEqual({ line: 'せりふ1', situation: '状況1' });
  });

  it('カンマ・改行を含む引用符付きセルを正しく扱う', () => {
    const input = '"「やあ」","朝(自宅)で\n手を振る"';
    const { rows } = parseRows(input);
    expect(rows[0]).toEqual({ line: '「やあ」', situation: '朝(自宅)で\n手を振る' });
  });

  it('24行を超える分は無視して警告する', () => {
    const { rows, warnings } = parseRows(makeCsvRows(30));
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(rows[23]).toEqual({ line: 'せりふ24', situation: '状況24' });
    expect(warnings.some((w) => w.includes('超える'))).toBe(true);
  });

  it('24行に満たない場合は不足分を空欄にして警告する', () => {
    const { rows, warnings } = parseRows(makeCsvRows(5));
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(rows[4]).toEqual({ line: 'せりふ5', situation: '状況5' });
    expect(rows[5]).toEqual({ line: '', situation: '' });
    expect(warnings.some((w) => w.includes('満たない'))).toBe(true);
  });

  it('状況列が省略された行は空文字として扱う', () => {
    const { rows } = parseRows('やっほー');
    expect(rows[0]).toEqual({ line: 'やっほー', situation: '' });
  });

  it('空文字列の入力は24行すべて空欄になる', () => {
    const { rows, warnings } = parseRows('');
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(rows.every((row) => row.line === '' && row.situation === '')).toBe(true);
    expect(warnings).toEqual([]);
  });
});

describe('parseRows: 旧お題,状況,セリフの3列形式', () => {
  it('ヘッダーに「お題」があれば3列形式と判定し、お題の列を捨てて取り込む', () => {
    const input = 'お題,状況,セリフ\nおはよう,朝に手を振る,やっほー';
    const { rows, warnings } = parseRows(input);
    expect(rows[0]).toEqual({ line: 'やっほー', situation: '朝に手を振る' });
    expect(warnings.some((w) => w.includes('旧形式'))).toBe(true);
  });

  it('ヘッダーに「お題」がなければ2列形式として扱う(3列目は読まれない)', () => {
    const input = 'せりふ1,状況1,余分な列';
    const { rows } = parseRows(input);
    expect(rows[0]).toEqual({ line: 'せりふ1', situation: '状況1' });
  });
});

describe('parseRows: 『セリフ』｜状況の形式', () => {
  it('行頭が『で始まり』｜を含む行が過半数なら、この形式として取り込む', () => {
    const input = ['『やっほー』｜朝に手を振る', '『ありがとう』｜お礼を言う'].join('\n');
    const { rows, warnings } = parseRows(input);
    expect(rows[0]).toEqual({ line: 'やっほー', situation: '朝に手を振る' });
    expect(rows[1]).toEqual({ line: 'ありがとう', situation: 'お礼を言う' });
    expect(warnings.some((w) => w.includes('満たない'))).toBe(true);
  });

  it('セリフが『』(空)の行もそのまま空セリフとして取り込む', () => {
    const input = ['『』｜お弁当箱の中に詰め込まれている様子', '『やっほー』｜朝に手を振る'].join(
      '\n',
    );
    const { rows } = parseRows(input);
    expect(rows[0]).toEqual({ line: '', situation: 'お弁当箱の中に詰め込まれている様子' });
  });

  it('24行を超える分は無視して警告する', () => {
    const lines = Array.from({ length: 26 }, (_, i) => `『せりふ${i + 1}』｜状況${i + 1}`);
    const { rows, warnings } = parseRows(lines.join('\n'));
    expect(rows).toHaveLength(STAMP_COUNT);
    expect(warnings.some((w) => w.includes('超える'))).toBe(true);
  });
});

describe('buildCsvTemplate', () => {
  it('セリフ,状況のヘッダー行+24行の空欄を生成する', () => {
    const template = buildCsvTemplate();
    const lines = template.split('\n');
    expect(lines[0]).toBe('セリフ,状況');
    expect(lines).toHaveLength(STAMP_COUNT + 1);
    expect(lines.slice(1).every((line) => line === ',')).toBe(true);
  });
});
