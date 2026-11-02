import {
  buildAdditionalInstructionsBlock,
  buildCharacterSection,
  CONTENT_HEADING,
  INTRO_LINE,
  SECTION_BACKGROUND,
  SECTION_LAYOUT,
  SECTION_TEXT_RULES,
} from './fixedText';
import { stampCount } from './layoutConstants';
import type { PromptSettings, StampRow } from './types';

/** 『…』または「…」で丸ごと囲まれている場合、外側の括弧を1組だけ取り除く(二重括弧の防止)。 */
function stripOuterBrackets(text: string): string {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['『', '』'],
    ['「', '」'],
  ];
  for (const [open, close] of pairs) {
    if (
      text.startsWith(open) &&
      text.endsWith(close) &&
      text.length >= open.length + close.length
    ) {
      return text.slice(open.length, text.length - close.length);
    }
  }
  return text;
}

/** 前後の空白を削り、セル内の改行は半角スペースに置き換える。 */
function normalizeCellText(value: string): string {
  return value.trim().replace(/\r\n|\r|\n/g, ' ');
}

/** 1マス分の行を `『セリフ』｜状況` 形式で組み立てる(状況が空なら `｜状況` 部分は出さない)。 */
function formatStampLine(row: StampRow): string {
  const line = stripOuterBrackets(normalizeCellText(row.line));
  const situation = normalizeCellText(row.situation);
  return situation ? `『${line}』｜${situation}` : `『${line}』`;
}

/**
 * 24行の入力と共通設定から、ChatGPT画像生成向けの日本語プロンプト全文を組み立てる。
 * 本文のほぼ全部は fixedText.ts の固定文で、可変なのはキャラクター補足・追加指示・24行の内容だけ。
 * テンプレートの正本は docs/prompt-template.md を参照。
 */
export function buildPrompt(rows: StampRow[], settings: PromptSettings): string {
  const stampLines = Array.from({ length: stampCount }, (_, index) =>
    formatStampLine(rows[index] ?? { line: '', situation: '' }),
  ).join('\n');

  const additionalBlock = buildAdditionalInstructionsBlock(settings.additionalInstructions);

  return [
    INTRO_LINE,
    '',
    SECTION_LAYOUT,
    '',
    buildCharacterSection(settings.characterNote),
    '',
    SECTION_TEXT_RULES,
    '',
    SECTION_BACKGROUND,
    '',
    additionalBlock ? `${additionalBlock}${CONTENT_HEADING}` : CONTENT_HEADING,
    stampLines,
  ].join('\n');
}
