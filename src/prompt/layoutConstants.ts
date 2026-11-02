import { DEFAULT_GRID, DEFAULT_SHEET_IMAGE_SIZE } from '../shared/lineSpec';

/**
 * プロンプト本文(fixedText.ts)に埋め込む、画像サイズ・マス構成に関する定数。
 * 列数・行数・画像サイズは shared/lineSpec.ts の値と同じものを指すため、
 * マジックナンバーを重複させずそこから導出する。
 */
export const cols = DEFAULT_GRID.cols;
export const rows = DEFAULT_GRID.rows;
export const imageWidth = DEFAULT_SHEET_IMAGE_SIZE.width;
export const imageHeight = DEFAULT_SHEET_IMAGE_SIZE.height;
export const stampCount = cols * rows;

/** ユーザーが検証した最終プロンプトの数値(1マス256×256px)。 */
export const cellSize = imageWidth / cols;

/** 要素を各マスの四辺からこのpx以上内側に収める。 */
export const edgeMargin = 24;

/** 隣り合う文字・キャラクター・効果の間の最小すき間(px)。 */
export const minGap = 48;

/** 文字とキャラクターを収める、マス中央の安全領域のサイズ(px、正方形)。 */
export const safeAreaSize = cellSize - edgeMargin * 2;
