import { DEFAULT_SHEET_IMAGE_SIZE } from '../shared/lineSpec';
import { resolveFontStyleLabel, type PromptSettings, type StampRow } from './types';

function formatBackgroundColor(hex: string): string {
  return hex.trim().toUpperCase() === '#FFFFFF' ? '純白(#FFFFFF)' : hex.trim();
}

function formatTextOutline(enabled: boolean): string {
  return enabled ? '文字には白い縁取りを付ける。' : '文字に縁取りは付けない。';
}

function formatLine(line: string): string {
  const trimmed = line.trim();
  return trimmed === '' ? 'なし' : trimmed;
}

/** 「1行目が1〜6番、2行目が7〜12番、…」のような行境界の説明文を作る。 */
function formatRowBoundaries(cols: number, rows: number): string {
  const parts: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    const start = r * cols + 1;
    const end = (r + 1) * cols;
    parts.push(`${r + 1}行目が${start}〜${end}番`);
  }
  return parts.join('、');
}

/** シート全体のサイズをグリッドで割った、1マスあたりのおおよそのサイズ(px)。 */
function formatCellSize(cols: number, rows: number): string {
  const width = Math.round(DEFAULT_SHEET_IMAGE_SIZE.width / cols);
  const height = Math.round(DEFAULT_SHEET_IMAGE_SIZE.height / rows);
  return `${width}×${height}`;
}

/**
 * 24行の入力と共通設定から、ChatGPT画像生成向けの日本語プロンプト全文を組み立てる。
 * テンプレートの設計意図は docs/prompt-template.md を参照。
 */
export function buildPrompt(rows: StampRow[], settings: PromptSettings): string {
  const { cols, rows: gridRows } = settings;
  const count = cols * gridRows;
  const targetRows = rows.slice(0, count);

  const characterNoteLine = settings.characterNote.trim()
    ? `- ${settings.characterNote.trim()}\n`
    : '';
  const additionalInstructionsLine = settings.additionalInstructions.trim()
    ? `- ${settings.additionalInstructions.trim()}\n`
    : '';
  const whiteOutlineBlock = settings.instructWhiteOutlineInPrompt
    ? '【スタンプの縁取り】\n- 各スタンプのキャラクターと文字の外側に、ステッカーのような白いフチを約6px付ける。\n\n'
    : '';

  const stampList = targetRows
    .map((row, index) => {
      const topic = row.topic.trim() || '(未入力)';
      const situation = row.situation.trim() || '(未入力)';
      return `${index + 1}番 お題:${topic} / 状況:${situation} / セリフ:「${formatLine(row.line)}」`;
    })
    .join('\n');

  return `添付した参照画像のキャラクターを主人公にして、LINEスタンプ用のイラストシートを、1枚の画像として作成してください。

【全体レイアウト】
- 画像は横長(3:2、${DEFAULT_SHEET_IMAGE_SIZE.width}×${DEFAULT_SHEET_IMAGE_SIZE.height}px)。
- ${cols}列×${gridRows}行、合計${count}個のスタンプイラストを並べる。順序は左上から右へ、上の行から下の行へ(${formatRowBoundaries(cols, gridRows)})。
- 各スタンプは、それぞれ約${formatCellSize(cols, gridRows)}pxの独立したマスの中に収める。隣のスタンプと重ならず、マスからはみ出さない。
- 各スタンプの周囲(マスの端)には十分な余白を残す。
- マス目の線、枠線、区切り線、番号、見出し、ロゴなど、スタンプ以外の要素は一切描かない。
- 背景は画像全体で${formatBackgroundColor(settings.backgroundColor)}の単色にする。影、グラデーション、地面、模様、テクスチャは背景に入れない。

【キャラクターと画風】
- 参照画像のキャラクターのデザイン、色、質感、線の太さ、画風を、${count}個すべてで統一する。顔つき・体の比率・色が変わらないようにする。
- 参照画像の背景や構図はまねせず、キャラクターだけを使う。
${characterNoteLine}- 表情やポーズ、小道具は、各スタンプの「お題」と「状況」に合わせて変える。ただし、同じキャラクターだとひと目で分かること。
- 小道具や背景の一部(木、かご、夕日など)が必要な場合は、そのスタンプのマスの中だけに描く。

【文字(セリフ)】
- セリフがあるスタンプには、キャラクターの近く(主に上側、難しければ横)に日本語の文字を入れる。
- 書体は${resolveFontStyleLabel(settings)}。太めで読みやすく、文字色は${settings.textColor}。${formatTextOutline(settings.textOutline)}
- 文字は、指定したとおりに一字一句正確に書く。誤字、欠字、文字化け、別の漢字や記号への置き換えは禁止。
- セリフが「なし」のスタンプには、文字を入れない。

${whiteOutlineBlock}【${count}個の内容】
${stampList}

【出力に関する最重要ルール】
- ${count}個すべてを、必ず1枚の画像の中に描く。数を減らしたり、同じ絵を繰り返したりしない。
- ${count}個の絵柄は、すべて異なる内容にする。
${additionalInstructionsLine}`;
}
