import type { ImageDataLike, RGB } from '../shared/types';

/**
 * 画像外周 `borderWidth` px幅の画素から、チャンネルごとの中央値を背景色として推定する。
 * 中央値を使うことで、外周に少し被写体がはみ出していても外れ値の影響を受けにくくする。
 */
export function estimateBackgroundColor(image: ImageDataLike, borderWidth = 8): RGB {
  const { width, height, data } = image;
  const w = Math.min(borderWidth, Math.ceil(width / 2));
  const h = Math.min(borderWidth, Math.ceil(height / 2));

  const rValues: number[] = [];
  const gValues: number[] = [];
  const bValues: number[] = [];

  const collect = (x: number, y: number): void => {
    const i = (y * width + x) * 4;
    rValues.push(data[i] ?? 0);
    gValues.push(data[i + 1] ?? 0);
    bValues.push(data[i + 2] ?? 0);
  };

  for (let y = 0; y < height; y += 1) {
    const isTopOrBottomBand = y < h || y >= height - h;
    if (isTopOrBottomBand) {
      for (let x = 0; x < width; x += 1) {
        collect(x, y);
      }
    } else {
      for (let x = 0; x < w; x += 1) {
        collect(x, y);
      }
      for (let x = Math.max(w, width - w); x < width; x += 1) {
        collect(x, y);
      }
    }
  }

  return { r: median(rValues), g: median(gValues), b: median(bValues) };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 255;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
  return Math.round(value);
}

/**
 * 背景色とのRGB各チャンネル差の最大値がしきい値を超える画素を前景(1)とする2値マスクを作る。
 * 返り値は `width*height` 長の配列で、1=前景、0=背景。
 */
export function buildForegroundMask(
  image: ImageDataLike,
  backgroundColor: RGB,
  threshold: number,
): Uint8Array {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);

  for (let p = 0; p < width * height; p += 1) {
    const i = p * 4;
    const dr = Math.abs((data[i] ?? 0) - backgroundColor.r);
    const dg = Math.abs((data[i + 1] ?? 0) - backgroundColor.g);
    const db = Math.abs((data[i + 2] ?? 0) - backgroundColor.b);
    const diff = Math.max(dr, dg, db);
    mask[p] = diff > threshold ? 1 : 0;
  }

  return mask;
}

/**
 * 連結成分ラベリング(4近傍、BFS)を行い、面積が `minArea` 未満の成分をノイズとして除去する。
 * 再帰を使わず、キューによる幅優先探索でスタックオーバーフローを避ける。
 */
export function removeNoise(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): Uint8Array {
  const result = new Uint8Array(mask);
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || visited[start] === 1) {
      continue;
    }

    let queueStart = 0;
    let queueEnd = 0;
    queue[queueEnd] = start;
    queueEnd += 1;
    visited[start] = 1;
    const component: number[] = [];

    while (queueStart < queueEnd) {
      const p = queue[queueStart] ?? 0;
      queueStart += 1;
      component.push(p);

      const x = p % width;
      const y = Math.floor(p / width);

      const neighbors = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y > 0 ? p - width : -1,
        y < height - 1 ? p + width : -1,
      ];

      for (const n of neighbors) {
        if (n >= 0 && mask[n] === 1 && visited[n] === 0) {
          visited[n] = 1;
          queue[queueEnd] = n;
          queueEnd += 1;
        }
      }
    }

    if (component.length < minArea) {
      for (const p of component) {
        result[p] = 0;
      }
    }
  }

  return result;
}
