import { describe, expect, it } from 'vitest';
import { createEmptyRow, createEmptyRows, DEFAULT_PROMPT_SETTINGS, type StampRow } from './types';
import { buildPrompt } from './buildPrompt';

function makeRows(overrides: Partial<StampRow>[] = []): StampRow[] {
  const rows = createEmptyRows();
  overrides.forEach((override, index) => {
    const current = rows[index] ?? createEmptyRow();
    rows[index] = {
      topic: override.topic ?? current.topic,
      situation: override.situation ?? current.situation,
      line: override.line ?? current.line,
    };
  });
  return rows;
}

describe('buildPrompt', () => {
  it('24個すべてを列挙する', () => {
    const rows = makeRows(
      Array.from({ length: 24 }, (_, i) => ({ topic: `お題${i + 1}`, situation: `状況${i + 1}` })),
    );
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);
    expect(prompt).toContain('1番 お題:お題1 / 状況:状況1 / セリフ:「なし」');
    expect(prompt).toContain('24番 お題:お題24 / 状況:状況24 / セリフ:「なし」');
    expect(prompt).toContain('6列×4行、合計24個');
  });

  it('セリフが空の行は「なし」と表記する', () => {
    const rows = makeRows([{ topic: 'おはよう', situation: '手を振る', line: '' }]);
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);
    expect(prompt).toContain('1番 お題:おはよう / 状況:手を振る / セリフ:「なし」');
  });

  it('セリフがある行はそのまま表記する', () => {
    const rows = makeRows([{ topic: 'おはよう', situation: '手を振る', line: 'やっほー' }]);
    const prompt = buildPrompt(rows, DEFAULT_PROMPT_SETTINGS);
    expect(prompt).toContain('セリフ:「やっほー」');
  });

  it('背景色が#FFFFFFのときは「純白」と表記する', () => {
    const prompt = buildPrompt(createEmptyRows(), {
      ...DEFAULT_PROMPT_SETTINGS,
      backgroundColor: '#FFFFFF',
    });
    expect(prompt).toContain('純白(#FFFFFF)の単色');
  });

  it('背景色が白以外のときはHEX値をそのまま表記する', () => {
    const prompt = buildPrompt(createEmptyRows(), {
      ...DEFAULT_PROMPT_SETTINGS,
      backgroundColor: '#2E7D32',
    });
    expect(prompt).toContain('#2E7D32の単色');
    expect(prompt).not.toContain('純白');
  });

  it('白フチの指示はOFFのとき出力されない', () => {
    const prompt = buildPrompt(createEmptyRows(), {
      ...DEFAULT_PROMPT_SETTINGS,
      instructWhiteOutlineInPrompt: false,
    });
    expect(prompt).not.toContain('ステッカーのような白いフチ');
  });

  it('白フチの指示はONのとき出力される', () => {
    const prompt = buildPrompt(createEmptyRows(), {
      ...DEFAULT_PROMPT_SETTINGS,
      instructWhiteOutlineInPrompt: true,
    });
    expect(prompt).toContain('ステッカーのような白いフチを約6px付ける。');
  });

  it('キャラクター補足・追加指示が未入力なら行を出力しない', () => {
    const prompt = buildPrompt(createEmptyRows(), DEFAULT_PROMPT_SETTINGS);
    expect(prompt).not.toMatch(/^- $/m);
  });

  it('キャラクター補足・追加指示が入力されていれば反映する', () => {
    const prompt = buildPrompt(createEmptyRows(), {
      ...DEFAULT_PROMPT_SETTINGS,
      characterNote: 'フランスパンのキャラクター',
      additionalInstructions: '影は描かない',
    });
    expect(prompt).toContain('- フランスパンのキャラクター');
    expect(prompt).toContain('- 影は描かない');
  });

  it('文字の縁取り設定が反映される', () => {
    const withOutline = buildPrompt(createEmptyRows(), {
      ...DEFAULT_PROMPT_SETTINGS,
      textOutline: true,
    });
    const withoutOutline = buildPrompt(createEmptyRows(), {
      ...DEFAULT_PROMPT_SETTINGS,
      textOutline: false,
    });
    expect(withOutline).toContain('文字には白い縁取りを付ける。');
    expect(withoutOutline).toContain('文字に縁取りは付けない。');
  });

  it('カスタム書体は自由入力文字列をそのまま使う', () => {
    const prompt = buildPrompt(createEmptyRows(), {
      ...DEFAULT_PROMPT_SETTINGS,
      fontStylePreset: 'custom',
      fontStyleCustom: '絵本風の優しいフォント',
    });
    expect(prompt).toContain('書体は絵本風の優しいフォント。');
  });
});
