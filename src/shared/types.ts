/**
 * Canvas/DOMに依存しない、ImageData互換の画像表現。
 * 画像処理の中核ロジックはこの型を入出力とする純粋関数として書く。
 */
export interface ImageDataLike {
  width: number;
  height: number;
  /** RGBA、4バイト/画素、行優先(ImageData.dataと同じレイアウト)。 */
  data: Uint8ClampedArray;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}
