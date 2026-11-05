import type { ImageDataLike, RGB } from '../shared/types';

/**
 * 「白に近い」と判定するR/G/Bの最小値(0〜255)。AIが生成した半透明のにじみ(ビネット・光彩等)は
 * 白〜クリーム色に寄ることが多いため、この値以上ならゴミ除去の対象候補とする(追加修正指示書 第3弾 項目15)。
 */
export const GHOST_WHITE_MIN = 200;

/**
 * 背景色モードのとき、推定した背景色とのチャンネル差(R/G/Bそれぞれの絶対差の最大値)が
 * この値以内なら、「白に近い」判定と同様にゴミ除去の対象候補とする。
 * フラッドフィルで抜けきれなかった、背景色に近い半透明の縁を拾うため。
 */
export const GHOST_BACKGROUND_COLOR_DIFF_MAX = 40;

/** 前景の内側を保護する既定の範囲(px)。アンチエイリアスの縁を削りすぎないため。 */
export const GHOST_DEFAULT_PROTECT_EDGE_PX = 1;

export interface GhostRemovalOptions {
  /**
   * アルファ(0〜255換算)がこの値以下、かつ色が白(または背景色)に近い画素を除去対象にする。
   * 0以下なら何もしない(入力をそのまま返す)。
   */
  alphaMax: number;
  /** 白とみなすR/G/Bの最小値。省略時は`GHOST_WHITE_MIN`。 */
  whiteMin?: number;
  /** 背景色モードのとき、推定した背景色。渡すと、白判定に加えて背景色に近い画素も対象にする。 */
  backgroundColor?: RGB;
  /** 前景(確かな被写体)から保護する範囲(px)。省略時は`GHOST_DEFAULT_PROTECT_EDGE_PX`。 */
  protectEdgePx?: number;
}

function isWhiteLike(r: number, g: number, b: number, whiteMin: number): boolean {
  return r >= whiteMin && g >= whiteMin && b >= whiteMin;
}

function isNearBackgroundColor(r: number, g: number, b: number, backgroundColor: RGB): boolean {
  const diff = Math.max(
    Math.abs(r - backgroundColor.r),
    Math.abs(g - backgroundColor.g),
    Math.abs(b - backgroundColor.b),
  );
  return diff <= GHOST_BACKGROUND_COLOR_DIFF_MAX;
}

function isGhostColor(
  r: number,
  g: number,
  b: number,
  whiteMin: number,
  backgroundColor: RGB | undefined,
): boolean {
  if (isWhiteLike(r, g, b, whiteMin)) {
    return true;
  }
  return backgroundColor !== undefined && isNearBackgroundColor(r, g, b, backgroundColor);
}

/**
 * 半透明の白(ゴースト)を除去する。被写体(アルファ>`alphaMax`の「確かな前景」)の外側にある、
 * アルファが低く(0より大きく`alphaMax`以下)、色が白(または背景色)に近い画素だけを完全に透明にする。
 * 被写体の内部(前景に囲まれて外周から辿り着けない領域)は、同じ条件を満たしても保護する。
 * `protectEdgePx`で、前景から近い(アンチエイリアスの縁の)画素も保護する。
 */
export function removeGhost(image: ImageDataLike, options: GhostRemovalOptions): ImageDataLike {
  const alphaMax = Math.max(0, Math.round(options.alphaMax));
  if (alphaMax <= 0) {
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  }

  const whiteMin = options.whiteMin ?? GHOST_WHITE_MIN;
  const backgroundColor = options.backgroundColor;
  const protectEdgePx = Math.max(
    0,
    Math.round(options.protectEdgePx ?? GHOST_DEFAULT_PROTECT_EDGE_PX),
  );

  const { width, height, data } = image;
  const length = width * height;

  const isConfirmedForeground = (p: number): boolean => (data[p * 4 + 3] ?? 0) > alphaMax;
  const isGhostCandidate = (p: number): boolean => {
    const i = p * 4;
    const alpha = data[i + 3] ?? 0;
    if (alpha <= 0 || alpha > alphaMax) {
      return false;
    }
    return isGhostColor(
      data[i] ?? 0,
      data[i + 1] ?? 0,
      data[i + 2] ?? 0,
      whiteMin,
      backgroundColor,
    );
  };

  // 外周から、「確かな前景」ではない画素(アルファ0の透明も含む)だけを辿るBFS。
  // 辿り着いた範囲のうち、ゴースト候補の条件を満たす画素だけを除去対象としてマークする
  // (前景に囲まれて外周から辿り着けない内部のゴースト候補は、マークされず保護される)。
  const ghostMark = new Uint8Array(length);
  const visited = new Uint8Array(length);
  const queue = new Int32Array(length);
  let queueEnd = 0;

  const tryEnqueue = (p: number): void => {
    if (visited[p] === 1 || isConfirmedForeground(p)) {
      return;
    }
    visited[p] = 1;
    if (isGhostCandidate(p)) {
      ghostMark[p] = 1;
    }
    queue[queueEnd] = p;
    queueEnd += 1;
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

  // 前景からの距離を測り、protectEdgePx以内のゴースト候補は保護(マーク解除)する。
  if (protectEdgePx > 0) {
    const dist = new Int16Array(length).fill(-1);
    const edgeQueue = new Int32Array(length);
    let edgeQueueEnd = 0;
    for (let p = 0; p < length; p += 1) {
      if (isConfirmedForeground(p)) {
        dist[p] = 0;
        edgeQueue[edgeQueueEnd] = p;
        edgeQueueEnd += 1;
      }
    }
    let edgeQueueStart = 0;
    while (edgeQueueStart < edgeQueueEnd) {
      const p = edgeQueue[edgeQueueStart] ?? 0;
      edgeQueueStart += 1;
      const d = dist[p] ?? 0;
      if (d >= protectEdgePx) {
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
          edgeQueue[edgeQueueEnd] = n;
          edgeQueueEnd += 1;
        }
      }
    }
    for (let p = 0; p < length; p += 1) {
      const d = dist[p] ?? -1;
      if (ghostMark[p] === 1 && d !== -1 && d <= protectEdgePx) {
        ghostMark[p] = 0;
      }
    }
  }

  const out = new Uint8ClampedArray(data);
  for (let p = 0; p < length; p += 1) {
    if (ghostMark[p] === 1) {
      out[p * 4 + 3] = 0;
    }
  }

  return { width, height, data: out };
}
