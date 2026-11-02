/**
 * LINEスタンプ規格に関する定数。詳細は docs/line-spec.md を参照。
 * 値の変更はこのファイルに限定する(他の場所にマジックナンバーを書かない)。
 */

/** 本ツールが対象とするセット枚数。 */
export const STAMP_COUNT = 24;

/** LINE Creators Marketで選べるセット枚数の候補(将来拡張用。現状は24枚のみ対応)。 */
export const STAMP_SET_SIZE_OPTIONS = [8, 16, 24, 32, 40] as const;

/** スタンプ画像の最大サイズ(幅・高さともにこの値以下、かつ偶数)。 */
export const STAMP_MAX_WIDTH = 370;
export const STAMP_MAX_HEIGHT = 320;

/** 1枚あたりの容量上限(バイト)。 */
export const STAMP_MAX_FILE_SIZE_BYTES = 1024 * 1024;

/** 画像周囲の推奨余白(px)。 */
export const STAMP_RECOMMENDED_MARGIN_PX = 10;

/** 書き出し形式。 */
export const STAMP_MIME_TYPE = 'image/png';

/** デフォルトのシート画像グリッド(6列×4行)。将来の12枚×2シート対応に備え、cols/rowsは可変値として扱う。 */
export const DEFAULT_GRID = { cols: 6, rows: 4 } as const;

/** ChatGPTに生成を依頼する想定のシート画像サイズ(横長3:2)。 */
export const DEFAULT_SHEET_IMAGE_SIZE = { width: 1536, height: 1024 } as const;

/** 検出用に縮小するシート画像の最大辺の目安(px)。これを超える入力は縮小コピーで検出処理する。 */
export const DETECTION_MAX_DIMENSION_PX = 4096;

/**
 * メイン画像・タブ画像は本ツールの対象外(docs/backlog.md参照)。
 * 将来拡張時の参考値としてのみ保持する。
 */
export const MAIN_IMAGE_SIZE = { width: 240, height: 240 } as const;
export const TAB_IMAGE_SIZE = { width: 96, height: 74 } as const;

/**
 * 1-indexedの番号(1〜24)から、LINE規格のファイル名(01.png〜24.png)を生成する。
 */
export function stampFileName(index: number): string {
  return `${String(index).padStart(2, '0')}.png`;
}
