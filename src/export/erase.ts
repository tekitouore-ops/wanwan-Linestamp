import type { EraseMask } from '../split/types';
import type { ImageDataLike } from '../shared/types';

/** 消去マスクが「実質的に空」(どこも消していない)かどうか判定する。 */
export function isEraseMaskEmpty(mask: EraseMask | null | undefined): boolean {
  if (!mask) {
    return true;
  }
  for (let i = 0; i < mask.data.length; i += 1) {
    if ((mask.data[i] ?? 0) > 0) {
      return false;
    }
  }
  return true;
}

/**
 * シート画像の絶対座標で保存されたマスクを、切り出し後の作業画像(`cropX`・`cropY`を左上とする
 * `cropWidth`×`cropHeight`の範囲)に合わせて配置し直す。マスクの範囲外にあたる画素は0(消去なし)
 * として扱う。マスクの座標系をシート絶対座標で保存しておくことで、切り抜き(crop)量を変えても
 * ずれに強くなる(追加修正指示書 第5弾 項目19参照)。
 */
export function alignEraseMaskToCrop(
  mask: EraseMask | null | undefined,
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number,
): EraseMask | null {
  if (!mask || isEraseMaskEmpty(mask)) {
    return null;
  }
  const data = new Uint8ClampedArray(cropWidth * cropHeight);
  for (let y = 0; y < cropHeight; y += 1) {
    const sy = cropY + y - mask.y;
    if (sy < 0 || sy >= mask.height) {
      continue;
    }
    for (let x = 0; x < cropWidth; x += 1) {
      const sx = cropX + x - mask.x;
      if (sx < 0 || sx >= mask.width) {
        continue;
      }
      data[y * cropWidth + x] = mask.data[sy * mask.width + sx] ?? 0;
    }
  }
  return { x: cropX, y: cropY, width: cropWidth, height: cropHeight, data };
}

/**
 * 消去マスクを画像に適用する(非破壊、`img`・`mask`は書き換えない)。`mask`は`img`と同じ
 * width・height(`alignEraseMaskToCrop`で位置を揃え済みのもの)を渡す。マスク値をアルファの
 * 減衰率として使う(255=完全に透明、0=変化なし、中間値は比例的に減衰させる。ブラシの縁を
 * なめらかにするため)。色(RGB)は変更しない。
 */
export function applyEraseMask(
  img: ImageDataLike,
  mask: EraseMask | null | undefined,
): ImageDataLike {
  if (!mask || isEraseMaskEmpty(mask)) {
    return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  }
  if (mask.width !== img.width || mask.height !== img.height) {
    // サイズが合っていない呼び出しは誤用(事前にalignEraseMaskToCropで揃える想定)。
    // 安全側に倒し、適用せずそのまま返す。
    return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  }

  const out = new Uint8ClampedArray(img.data);
  for (let p = 0; p < img.width * img.height; p += 1) {
    const erase = mask.data[p] ?? 0;
    if (erase <= 0) {
      continue;
    }
    const alphaIndex = p * 4 + 3;
    const originalAlpha = out[alphaIndex] ?? 0;
    const remaining = 1 - erase / 255;
    out[alphaIndex] = Math.round(originalAlpha * remaining);
  }

  return { width: img.width, height: img.height, data: out };
}
