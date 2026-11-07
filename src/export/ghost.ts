import type { ImageDataLike } from '../shared/types';

/**
 * 「確かな前景」とみなすアルファの下限(0〜255)。キャラ・文字・不透明な白フチは、色を問わず
 * すべてここに含まれ、ゴミ除去の対象から外れる(追加修正指示書 第5弾 項目18。方針: 文字・キャラの
 * 白フチは絶対に消さない。色によらずアルファだけで前景かどうかを判定する)。
 */
export const GHOST_SOLID_ALPHA_MIN = 200;

/** 前景の内側を保護する既定の範囲(px)。アンチエイリアスの縁を削りすぎないため。 */
export const GHOST_DEFAULT_PROTECT_EDGE_PX = 1;

export interface GhostRemovalOptions {
  /**
   * アルファ(0〜255換算)がこの値以下の半透明画素を除去対象にする(色は問わない)。
   * 0以下なら何もしない(入力をそのまま返す)。
   */
  alphaMax: number;
  /** 「確かな前景」とみなすアルファの下限。省略時は`GHOST_SOLID_ALPHA_MIN`。 */
  solidAlphaMin?: number;
  /** 前景(確かな被写体)から保護する範囲(px)。省略時は`GHOST_DEFAULT_PROTECT_EDGE_PX`。 */
  protectEdgePx?: number;
}

/**
 * 半透明のもや(ゴースト)を、色によらず除去する。「確かな前景」(アルファ>=`solidAlphaMin`の画素。
 * 色を問わないため、白フチ・文字・キャラのどれでも前景であれば対象外)の外側にある、アルファが
 * 低い(0より大きく`alphaMax`以下)画素だけを完全に透明にする。前景は、アルファだけで判定するため、
 * 本体から離れた位置にある不透明な白フチ・文字も、連結の有無に関係なく保護される。
 * 被写体の内部(前景に囲まれて外周から辿り着けない領域)は、同じ条件を満たしても保護する。
 * `protectEdgePx`で、前景から近い(アンチエイリアスの縁の)画素も保護する。
 */
export function removeGhost(image: ImageDataLike, options: GhostRemovalOptions): ImageDataLike {
  const alphaMax = Math.max(0, Math.round(options.alphaMax));
  if (alphaMax <= 0) {
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  }

  const solidAlphaMin = options.solidAlphaMin ?? GHOST_SOLID_ALPHA_MIN;
  const protectEdgePx = Math.max(
    0,
    Math.round(options.protectEdgePx ?? GHOST_DEFAULT_PROTECT_EDGE_PX),
  );

  const { width, height, data } = image;
  const length = width * height;

  const isConfirmedForeground = (p: number): boolean => (data[p * 4 + 3] ?? 0) >= solidAlphaMin;
  const isGhostCandidate = (p: number): boolean => {
    const alpha = data[p * 4 + 3] ?? 0;
    return alpha > 0 && alpha <= alphaMax;
  };

  // 外周から、「確かな前景」ではない画素(アルファ0の透明や、前景未満の半透明も含む)だけを
  // 辿るBFS。辿り着いた範囲のうち、ゴースト候補の条件(alphaMax以下)を満たす画素だけを
  // 除去対象としてマークする(前景に囲まれて外周から辿り着けない内部のゴースト候補は、
  // マークされず保護される)。
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
