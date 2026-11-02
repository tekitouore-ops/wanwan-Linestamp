import type { ImageDataLike } from '../shared/types';

/** 被写体(alpha>0)からのマンハッタン距離を `maxDist` までBFSで計算する(それ以降は-1)。 */
function distanceFromSubject(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  maxDist: number,
): Int16Array {
  const length = width * height;
  const dist = new Int16Array(length).fill(-1);
  const queue = new Int32Array(length);
  let queueEnd = 0;

  for (let p = 0; p < length; p += 1) {
    if ((alpha[p * 4 + 3] ?? 0) > 0) {
      dist[p] = 0;
      queue[queueEnd] = p;
      queueEnd += 1;
    }
  }

  let queueStart = 0;
  while (queueStart < queueEnd) {
    const p = queue[queueStart] ?? 0;
    queueStart += 1;
    const d = dist[p] ?? 0;
    if (d >= maxDist) {
      continue;
    }
    const x = p % width;
    const y = Math.floor(p / width);
    const neighbors = [
      x > 0 ? p - 1 : -1,
      x < width - 1 ? p + 1 : -1,
      y > 0 ? p - width : -1,
      y < height - 1 ? p + width : -1,
    ];
    for (const n of neighbors) {
      if (n >= 0 && dist[n] === -1) {
        dist[n] = d + 1;
        queue[queueEnd] = n;
        queueEnd += 1;
      }
    }
  }

  return dist;
}

/**
 * 被写体(アルファ>0の領域)の外側を、指定した半径(px)だけ白く膨張させる(ステッカー風の白フチ)。
 * `widthPx` が0以下の場合は入力をそのまま返す。
 * 境界の1px外側は半透明にして、エッジを少しなめらかにする。
 */
export function addWhiteOutline(image: ImageDataLike, widthPx: number): ImageDataLike {
  const radius = Math.max(0, Math.round(widthPx));
  if (radius <= 0) {
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  }

  const { width, height, data } = image;
  const dist = distanceFromSubject(data, width, height, radius + 1);
  const out = new Uint8ClampedArray(data);

  for (let p = 0; p < width * height; p += 1) {
    const i = p * 4;
    const originalAlpha = data[i + 3] ?? 0;
    if (originalAlpha > 0) {
      continue; // 被写体そのものには手を加えない
    }

    const d = dist[p] ?? -1;
    if (d === -1 || d > radius + 1) {
      continue; // 膨張範囲の外
    }

    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = d <= radius ? 255 : 128; // 最外周の1pxだけ半透明にしてエッジをなめらかにする
  }

  return { width, height, data: out };
}
