import { describe, expect, it } from 'vitest';
import expectedPrompt from './fixtures/expected-prompt.txt?raw';
import shibaOnigiriRows from '../../samples/shiba-onigiri-rows.txt?raw';
import { buildPrompt } from './buildPrompt';
import { parseRows } from './csv';
import { DEFAULT_PROMPT_SETTINGS, createEmptyRows, type StampRow } from './types';

function makeRows(overrides: Partial<StampRow>[] = []): StampRow[] {
  const rows = createEmptyRows();
  overrides.forEach((override, index) => {
    const current = rows[index];
    if (current) {
      rows[index] = {
        line: override.line ?? current.line,
        situation: override.situation ?? current.situation,
      };
    }
  });
  return rows;
}

describe('buildPrompt: ゴールデンテスト', () => {
  it('shiba-onigiriフィクスチャを取り込んで生成したプロンプトが、期待値の全文と完全一致する', () => {
    const { rows } = parseRows(shibaOnigiriRows);
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);

    expect(prompt).toBe(expectedPrompt);
  });
});

describe('buildPrompt', () => {
  it('24行すべてを『セリフ』｜状況の形式で列挙する', () => {
    const rows = makeRows(
      Array.from({ length: 24 }, (_, i) => ({ line: `せりふ${i + 1}`, situation: `状況${i + 1}` })),
    );
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);
    expect(prompt).toContain('『せりふ1』｜状況1');
    expect(prompt).toContain('『せりふ24』｜状況24');
    expect(prompt).toContain('横6列×縦4行、合計24マス');
  });

  it('状況が空の行は｜以降を出力しない', () => {
    const rows = makeRows([{ line: 'やっほー', situation: '' }]);
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);
    expect(prompt).toContain('『やっほー』\n');
    expect(prompt).not.toContain('『やっほー』｜');
  });

  it('セリフが空の行は『』として出力する(位置がずれない)', () => {
    const rows = makeRows([{ line: '', situation: '手を振る' }]);
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);
    expect(prompt).toContain('『』｜手を振る');
  });

  it('セリフ・状況の両方が空でも『』を出力する', () => {
    const rows = makeRows([{ line: '', situation: '' }]);
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);
    const lines = prompt.split('\n');
    expect(lines[lines.length - 24]).toBe('『』');
  });

  it('セリフを『…』で囲んで入力していた場合は外側の括弧を1組だけ取り除く', () => {
    const rows = makeRows([{ line: '『やっほー』', situation: '手を振る' }]);
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);
    expect(prompt).toContain('『やっほー』｜手を振る');
    expect(prompt).not.toContain('『『やっほー』』');
  });

  it('セリフを「…」で囲んで入力していた場合も外側の括弧を1組だけ取り除く', () => {
    const rows = makeRows([{ line: '「やっほー」', situation: '手を振る' }]);
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);
    expect(prompt).toContain('『やっほー』｜手を振る');
  });

  it('セル内の改行は半角スペースに置き換える', () => {
    const rows = makeRows([{ line: 'やっほー', situation: '朝(自宅)で\n手を振る' }]);
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);
    expect(prompt).toContain('『やっほー』｜朝(自宅)で 手を振る');
  });

  it('キャラクター補足が未入力なら行を出力しない', () => {
    const prompt = buildPrompt(createEmptyRows(), DEFAULT_PROMPT_SETTINGS);
    expect(prompt).not.toMatch(/^- $/m);
  });

  it('キャラクター補足が入力されていれば【キャラクター】節に反映する', () => {
    const prompt = buildPrompt(createEmptyRows(), {
      ...DEFAULT_PROMPT_SETTINGS,
      characterNote: 'フランスパンのキャラクター',
    });
    expect(prompt).toContain('- フランスパンのキャラクター');
    const characterSectionIndex = prompt.indexOf('【キャラクター】');
    const textRulesIndex = prompt.indexOf('【文字のルール】');
    const noteIndex = prompt.indexOf('- フランスパンのキャラクター');
    expect(noteIndex).toBeGreaterThan(characterSectionIndex);
    expect(noteIndex).toBeLessThan(textRulesIndex);
  });

  it('追加指示が未入力なら【追加指示】の見出しごと出力しない', () => {
    const prompt = buildPrompt(createEmptyRows(), DEFAULT_PROMPT_SETTINGS);
    expect(prompt).not.toContain('【追加指示】');
  });

  it('追加指示が入力されていれば【追加指示】の見出し付きで反映する', () => {
    const prompt = buildPrompt(createEmptyRows(), {
      ...DEFAULT_PROMPT_SETTINGS,
      additionalInstructions: '影は描かない',
    });
    expect(prompt).toContain('【追加指示】\n- 影は描かない');
  });

  it('「お題」の語が出力に含まれない', () => {
    const prompt = buildPrompt(createEmptyRows(), DEFAULT_PROMPT_SETTINGS);
    expect(prompt).not.toContain('お題');
  });

  it('画像サイズ・マス構成の既定値が仕様どおりに出力される', () => {
    const prompt = buildPrompt(createEmptyRows(), DEFAULT_PROMPT_SETTINGS);
    expect(prompt).toContain('画像全体は1536×1024pxの横長');
    expect(prompt).toContain('各マスは256×256px相当');
    expect(prompt).toContain('四辺から24px以上内側');
    expect(prompt).toContain('中央208×208pxの範囲内');
    expect(prompt).toContain('合計48px以上の透明なすき間');
  });
});
