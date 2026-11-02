import type { ImageDataLike, RGB } from '../shared/types';

function colorDiff(data: Uint8ClampedArray, pixelIndex: number, backgroundColor: RGB): number {
  const i = pixelIndex * 4;
  const dr = Math.abs((data[i] ?? 0) - backgroundColor.r);
  const dg = Math.abs((data[i + 1] ?? 0) - backgroundColor.g);
  const db = Math.abs((data[i + 2] ?? 0) - backgroundColor.b);
  return Math.max(dr, dg, db);
}

/**
 * 画像の外周から、背景色に近い画素を連結領域としてBFSで探索し、その領域を背景とみなす。
 * 色キー方式(画像全体から背景色相当を一律で抜く)ではないため、内部の背景色に近い領域
 * (キャラクター内部の白い部分など)が、外周と繋がっていなければ保持される。
 */
function findConnectedBackground(
  image: ImageDataLike,
  backgroundColor: RGB,
  threshold: number,
): Uint8Array {
  const { width, height, data } = image;
  const bg = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueEnd = 0;

  const tryEnqueue = (p: number): void => {
    if (visited[p] === 1) {
      return;
    }
    visited[p] = 1;
    if (colorDiff(data, p, backgroundColor) <= threshold) {
      bg[p] = 1;
      queue[queueEnd] = p;
      queueEnd += 1;
    }
  };

  for (let x = 0; x < width; x += 1) {
    tryEnqueue(x);
    tryEnqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    tryEnqueue(y * width);
    tryEnqueue(y * width + (width - 1));
  }

  let queueStart = 0;
  while (queueStart < queueEnd) {
    const p = queue[queueStart] ?? 0;
    queueStart += 1;
    const x = p % width;
    const y = Math.floor(p / width);

    const neighbors = [
      x > 0 ? p - 1 : -1,
      x < width - 1 ? p + 1 : -1,
      y > 0 ? p - width : -1,
      y < height - 1 ? p + width : -1,
    ];

    for (const n of neighbors) {
      if (n >= 0) {
        tryEnqueue(n);
      }
    }
  }

  return bg;
}

/** 背景(bg===1)からのマンハッタン距離を、`maxDist` までBFSで計算する(それ以降は-1のまま)。 */
function distanceFromBackground(
  bg: Uint8Array,
  width: number,
  height: number,
  maxDist: number,
): Int16Array {
  const dist = new Int16Array(bg.length).fill(-1);
  const queue = new Int32Array(bg.length);
  let queueEnd = 0;

  for (let p = 0; p < bg.length; p += 1) {
    if (bg[p] === 1) {
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
 * 透過画像モード用。フラッドフィルによる背景除去を行わず、元のアルファをそのまま使う
 * (B-1仕様: 透過画像のときはAIが出力したアルファを信頼し、誤って内部を透明にしない)。
 * 呼び出し側の配列を書き換えないよう複製を返す。
 */
export function keepOriginalAlpha(image: ImageDataLike): ImageDataLike {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

/**
 * 画像外周から連結する背景色領域を透明にする。内部の背景色に近い孤立領域(ご飯の白など)は保持する。
 * `featherPx` > 0 の場合、背景との境界付近のアルファを緩やかに変化させる。
 */
export function removeBackground(
  image: ImageDataLike,
  backgroundColor: RGB,
  threshold: number,
  featherPx: number,
): ImageDataLike {
  const { width, height, data } = image;
  const bg = findConnectedBackground(image, backgroundColor, threshold);
  const feather = Math.max(0, Math.round(featherPx));
  const dist = feather > 0 ? distanceFromBackground(bg, width, height, feather) : null;

  const out = new Uint8ClampedArray(data.length);
  for (let p = 0; p < width * height; p += 1) {
    const i = p * 4;
    out[i] = data[i] ?? 0;
    out[i + 1] = data[i + 1] ?? 0;
    out[i + 2] = data[i + 2] ?? 0;
    const originalAlpha = data[i + 3] ?? 255;

    if (bg[p] === 1) {
      out[i + 3] = 0;
      continue;
    }

    const d = dist ? (dist[p] ?? -1) : -1;
    if (feather > 0 && d >= 1 && d <= feather) {
      out[i + 3] = Math.round((d / (feather + 1)) * originalAlpha);
    } else {
      out[i + 3] = originalAlpha;
    }
  }

  return { width, height, data: out };
}
