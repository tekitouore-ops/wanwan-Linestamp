import { grayscaleToPngDataUrl, pngDataUrlToGrayscale } from '../shared/imageData';
import type { EraseMask } from './types';

/**
 * 設定JSONに保存する形の消去マスク。`Uint8ClampedArray`をそのまま`JSON.stringify`すると
 * インデックスキーのオブジェクトになってしまい巨大化するため、PNG(1チャンネル、グレースケール)
 * をBase64のdata URLとして保存する(追加修正指示書 第5弾 項目19-c)。座標メタ情報
 * (`x`・`y`・`width`・`height`、シート絶対座標)はPNGの外に平テキストで持つ。
 */
export interface EncodedEraseMask {
  x: number;
  y: number;
  width: number;
  height: number;
  png: string;
}

/**
 * 消去マスクを保存用の形に変換する。すべて0(未編集)の場合は`undefined`を返す
 * (指示書どおり、空のマスクは保存しない)。
 */
export function encodeEraseMask(mask: EraseMask): EncodedEraseMask | undefined {
  if (!mask.data.some((v) => v > 0)) {
    return undefined;
  }
  return {
    x: mask.x,
    y: mask.y,
    width: mask.width,
    height: mask.height,
    png: grayscaleToPngDataUrl(mask.data, mask.width, mask.height),
  };
}

/**
 * `encodeEraseMask`の逆変換。デコードしたPNGのサイズが保存されていた`width`・`height`と
 * 一致しない場合は、壊れた/想定外のデータとみなし安全側に倒して`null`を返す(呼び出し側で
 * そのスタンプのマスクを破棄し、警告を出す)。
 */
export async function decodeEraseMask(value: EncodedEraseMask): Promise<EraseMask | null> {
  const decoded = await pngDataUrlToGrayscale(value.png);
  if (decoded.width !== value.width || decoded.height !== value.height) {
    return null;
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height, data: decoded.data };
}
