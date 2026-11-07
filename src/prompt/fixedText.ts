import {
  cellSize,
  cols,
  edgeMargin,
  imageHeight,
  imageWidth,
  minGap,
  rows,
  safeAreaSize,
  stampCount,
} from './layoutConstants';

/**
 * プロンプト全文の固定文言。docs/prompt-template.md の「テンプレート全文」と一致させる。
 * 可変なのは、24行の内容と、任意の2項目(キャラクター補足・追加指示)だけ。
 * 文言はこのファイル以外に書かない(buildPrompt.ts は組み立てのみを行う)。
 */

export const INTRO_LINE =
  '添付した参照画像のキャラクターを主人公にして、LINEスタンプ用のイラストシートを、1枚の画像として作成してください。';

export const SECTION_LAYOUT = `【画像サイズと配置】
- 画像全体は${imageWidth}×${imageHeight}pxの横長
- 横${cols}列×縦${rows}行、合計${stampCount}マス
- 各マスは${cellSize}×${cellSize}px相当で、すべて同じ大きさ
- 左上から右へ、上の段から順に${stampCount}個を配置`;

/** キャラクター補足(任意)がある場合のみ、固定文の該当行の後に1行追加する。 */
export function buildCharacterSection(characterNote: string): string {
  const noteLine = characterNote.trim() ? `\n- ${characterNote.trim()}` : '';
  return `【キャラクター】
- 同じキャラクターとして認識できるよう、顔・体型・色・線・服装・小物を全マスで統一
- 各マスにキャラクターは1体だけ
- キャラクターの大きさをそろえ、各マスの中央に配置
- キャラクター、文字、頭・手・足・小物、ハート・汗・効果線・光など、すべての要素を各マスの四辺から${edgeMargin}px以上内側に収める
- 文字とキャラクターを合わせて各マスの中央${safeAreaSize}×${safeAreaSize}pxの範囲内だけを使い、周囲に透明な余白を残す
- 隣り合う文字・キャラクター・効果の間には、合計${minGap}px以上の透明なすき間を作る
- 隣のマスへはみ出さない、キャラクター同士を重ねない${noteLine}`;
}

export const SECTION_TEXT_RULES = `【文字のルール】
- 各項目の「」内の日本語を、対応するマスに一字一句そのまま入れる
- 誤字・文字化け・別の言葉への変更・文字の省略・余分な文字は禁止
- 文字は太く大きく、スマートフォンでも読みやすい手書き風にする
- 長い文言は2行までで改行し、文字を小さくしすぎない
- 白フチや濃い色のフチを付け、キャラクターと重ならない位置に配置する
- 吹き出しは使わず、文字をキャラクターの近くに直接配置する`;

export const SECTION_BACKGROUND = `【背景と禁止事項】
- 背景は本物の透明背景（アルファチャンネル付きPNG）にする
- 背景色・背景の影・模様・グラデーション・風景を入れない
- キャラクターや文字の周囲に、影・ぼかし・光彩・半透明のにじみを入れない
- 枠線・区切り線・番号・タイトル・ロゴを入れない
- 指定したスタンプ文言以外の文字を入れない
- 白背景や、透明を表す市松模様を描かない
- ${stampCount}個より多くも少なくもしない`;

/** 追加指示(任意)がある場合のみ、見出し付きブロック(末尾に空行を含む)を返す。ない場合は空文字。 */
export function buildAdditionalInstructionsBlock(additionalInstructions: string): string {
  const trimmed = additionalInstructions.trim();
  if (!trimmed) {
    return '';
  }
  return `【追加指示】\n- ${trimmed}\n\n`;
}

/**
 * こちらで補った見出し(元のサンプルには見出しがなかった)。
 * 固定文の他の定数とは別に切り出し、後で不要になった場合に消しやすくしてある。
 */
export const CONTENT_HEADING = `【各マスの内容(左上から順に${stampCount}個)】`;
