import type { ImageDataLike } from '../shared/types';

interface BfsResult {
  dist: Int16Array;
  /** 各画素が、BFS探索でどのシード画素から伝播してきたか(伝播元の画素インデックス)。 */
  source: Int32Array;
}

/** `isSeed(p)` を満たす画素を距離0として、`maxDist` までBFSで距離と伝播元を求める。 */
function bfsFrom(isSeed: (pixelIndex: number) => boolean, width: number, height: number, maxDist: number): BfsResult {
  const length = width * height;
  const dist = new Int16Array(length).fill(-1);
  const source = new Int32Array(length).fill(-1);
  const queue = new Int32Array(length);
  let queueEnd = 0;

  for (let p = 0; p < length; p += 1) {
    if (isSeed(p)) {
      dist[p] = 0;
      source[p] = p;
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
        source[n] = source[p] ?? n;
        queue[queueEnd] = n;
        queueEnd += 1;
      }
    }
  }

  return { dist, source };
}

function erode(image: ImageDataLike, radius: number): ImageDataLike {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data);
  const { dist } = bfsFrom((p) => (data[p * 4 + 3] ?? 0) === 0, width, height, radius);

  for (let p = 0; p < width * height; p += 1) {
    const i = p * 4;
    if ((data[i + 3] ?? 0) === 0) {
      continue;
    }
    const d = dist[p] ?? -1;
    if (d !== -1 && d <= radius) {
      out[i + 3] = 0;
    }
  }

  return { width, height, data: out };
}

function dilate(image: ImageDataLike, radius: number): ImageDataLike {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data);
  const { dist, source } = bfsFrom((p) => (data[p * 4 + 3] ?? 0) > 0, width, height, radius);

  for (let p = 0; p < width * height; p += 1) {
    const i = p * 4;
    if ((data[i + 3] ?? 0) > 0) {
      continue;
    }
    const d = dist[p] ?? -1;
    if (d === -1 || d > radius || d < 1) {
      continue;
    }
    const s = source[p] ?? -1;
    if (s < 0) {
      continue;
    }
    const si = s * 4;
    out[i] = data[si] ?? 0;
    out[i + 1] = data[si + 1] ?? 0;
    out[i + 2] = data[si + 2] ?? 0;
    out[i + 3] = data[si + 3] ?? 0;
  }

  return { width, height, data: out };
}

/**
 * 背景除去後のアルファマスクを補正する(縁補正)。
 * `amountPx` が正なら被写体を内側へ収縮させる(白いハロ・抜け残りを削る)。
 * 負なら外側へ膨張させる(削りすぎを戻す。近傍の被写体画素の色を伝播させる)。
 * 0の場合は入力をそのまま返す。
 */
export function applyEdgeFix(image: ImageDataLike, amountPx: number): ImageDataLike {
  const amount = Math.round(amountPx);
  if (amount === 0) {
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  }
  return amount > 0 ? erode(image, amount) : dilate(image, -amount);
}
