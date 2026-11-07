import type { Rect } from './types';

/**
 * ステップA(枠編集)のリサイズハンドルに関する、DOM非依存の純粋ロジック。
 * `detectView.ts`から呼ぶ(追加修正指示書 第6弾 項目22)。
 */

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** ハンドルの表示サイズ(画面px、ズームしても変わらない)。 */
export const HANDLE_SIZE_SCREEN_PX = 10;
/** ハンドルの当たり判定の半径(画面px)。表示サイズより広めに取り、つかみやすくする。 */
export const HANDLE_HIT_RADIUS_SCREEN_PX = 14;
/** 枠の最小サイズ(元画像px)。これより小さくはできない。 */
export const MIN_BOX_SIZE_PX = 8;

const CORNER_HANDLES: ResizeHandle[] = ['nw', 'ne', 'sw', 'se'];
const MID_HANDLES: ResizeHandle[] = ['n', 's', 'w', 'e'];

function isCornerHandle(handle: ResizeHandle): boolean {
  return handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se';
}

export function getHandlePoints(box: Rect): Record<ResizeHandle, { x: number; y: number }> {
  const { x, y, width, height } = box;
  return {
    nw: { x, y },
    n: { x: x + width / 2, y },
    ne: { x: x + width, y },
    w: { x, y: y + height / 2 },
    e: { x: x + width, y: y + height / 2 },
    sw: { x, y: y + height },
    s: { x: x + width / 2, y: y + height },
    se: { x: x + width, y: y + height },
  };
}

/**
 * 枠が小さく、辺の中央ハンドルが両端の角ハンドルと重なってしまう場合、中央ハンドルを非表示にする
 * (角を優先する)。`boxWidthScreenPx`・`boxHeightScreenPx`は、枠の画面上の大きさ(px、ズーム後)。
 */
export function computeVisibleHandles(
  boxWidthScreenPx: number,
  boxHeightScreenPx: number,
  handleSizeScreenPx: number = HANDLE_SIZE_SCREEN_PX,
): ResizeHandle[] {
  const hideHorizontalMid = boxWidthScreenPx < handleSizeScreenPx * 3;
  const hideVerticalMid = boxHeightScreenPx < handleSizeScreenPx * 3;
  const all: ResizeHandle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
  return all.filter((handle) => {
    if (handle === 'n' || handle === 's') return !hideHorizontalMid;
    if (handle === 'w' || handle === 'e') return !hideVerticalMid;
    return true;
  });
}

/**
 * 指定位置(元画像px)に最も近いハンドルを判定する。`toleranceImagePx`以内にあるものだけが対象。
 * 角(corner)ハンドルを優先し、距離が同じ(タイ)場合も角が勝つ(辺の中央ハンドルは、角より
 * 厳密に近い場合だけ採用する)。非表示のハンドル(`computeVisibleHandles`参照)は対象外。
 */
export function hitTestHandle(
  box: Rect,
  imageX: number,
  imageY: number,
  toleranceImagePx: number,
  boxWidthScreenPx: number,
  boxHeightScreenPx: number,
  handleSizeScreenPx: number = HANDLE_SIZE_SCREEN_PX,
): ResizeHandle | null {
  const visible = new Set(
    computeVisibleHandles(boxWidthScreenPx, boxHeightScreenPx, handleSizeScreenPx),
  );
  const points = getHandlePoints(box);

  let closest: ResizeHandle | null = null;
  let closestDist = toleranceImagePx;

  for (const handle of CORNER_HANDLES) {
    if (!visible.has(handle)) continue;
    const point = points[handle];
    const dist = Math.hypot(point.x - imageX, point.y - imageY);
    if (dist <= closestDist) {
      closestDist = dist;
      closest = handle;
    }
  }
  for (const handle of MID_HANDLES) {
    if (!visible.has(handle)) continue;
    const point = points[handle];
    const dist = Math.hypot(point.x - imageX, point.y - imageY);
    if (dist < closestDist) {
      closestDist = dist;
      closest = handle;
    }
  }
  return closest;
}

/** ハンドルの位置に応じた、マウスカーソルのCSS値。 */
export function cursorForHandle(handle: ResizeHandle): string {
  if (handle === 'nw' || handle === 'se') return 'nwse-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  if (handle === 'n' || handle === 's') return 'ns-resize';
  return 'ew-resize';
}

export interface ResizeModifiers {
  shiftKey: boolean;
  altKey: boolean;
}

interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function toEdges(box: Rect): Edges {
  return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
}

function toRect(edges: Edges): Rect {
  return {
    x: edges.left,
    y: edges.top,
    width: edges.right - edges.left,
    height: edges.bottom - edges.top,
  };
}

/** ドラッグ中のハンドルが動かす辺(上右下左)だけを、ポインタ位置に合わせて更新する(素の計算、修飾キーなし)。 */
function applyRawEdges(box: Rect, handle: ResizeHandle, imageX: number, imageY: number): Edges {
  const original = toEdges(box);
  const edges = { ...original };
  if (handle.includes('w')) {
    edges.left = Math.min(imageX, original.right - MIN_BOX_SIZE_PX);
  }
  if (handle.includes('e')) {
    edges.right = Math.max(imageX, original.left + MIN_BOX_SIZE_PX);
  }
  if (handle.includes('n')) {
    edges.top = Math.min(imageY, original.bottom - MIN_BOX_SIZE_PX);
  }
  if (handle.includes('s')) {
    edges.bottom = Math.max(imageY, original.top + MIN_BOX_SIZE_PX);
  }
  return edges;
}

/**
 * 角ハンドルのドラッグ結果に、元の縦横比を適用する(Shift押下時)。反対側の角(アンカー)は固定したまま、
 * 変化の大きい方の辺を優先してもう一方を追従させる。
 */
function applyAspectLock(original: Rect, handle: ResizeHandle, raw: Edges): Edges {
  if (original.width <= 0 || original.height <= 0) {
    return raw;
  }
  const ratio = original.width / original.height;
  const rawWidth = Math.max(MIN_BOX_SIZE_PX, raw.right - raw.left);
  const rawHeight = Math.max(MIN_BOX_SIZE_PX, raw.bottom - raw.top);
  const widthChangeRatio = Math.abs(rawWidth - original.width) / original.width;
  const heightChangeRatio = Math.abs(rawHeight - original.height) / original.height;

  let width = rawWidth;
  let height = rawHeight;
  if (widthChangeRatio >= heightChangeRatio) {
    height = Math.max(MIN_BOX_SIZE_PX, width / ratio);
  } else {
    width = Math.max(MIN_BOX_SIZE_PX, height * ratio);
  }

  // アンカー(動かない側)は、ドラッグしていない側の辺(反対側の角)。
  const anchorLeft = handle.includes('w') ? original.x + original.width : original.x;
  const anchorTop = handle.includes('n') ? original.y + original.height : original.y;

  const left = handle.includes('w') ? anchorLeft - width : anchorLeft;
  const top = handle.includes('n') ? anchorTop - height : anchorTop;
  return { left, top, right: left + width, bottom: top + height };
}

/** 元の中心を固定したまま、変化した辺の幅・高さを中心から左右(上下)対称に広げ直す(Alt押下時)。 */
function applyCenterAnchor(original: Rect, handle: ResizeHandle, edges: Edges): Edges {
  const centerX = original.x + original.width / 2;
  const centerY = original.y + original.height / 2;
  const result = { ...edges };

  if (handle.includes('w') || handle.includes('e')) {
    const width = Math.max(MIN_BOX_SIZE_PX, edges.right - edges.left);
    result.left = centerX - width / 2;
    result.right = centerX + width / 2;
  }
  if (handle.includes('n') || handle.includes('s')) {
    const height = Math.max(MIN_BOX_SIZE_PX, edges.bottom - edges.top);
    result.top = centerY - height / 2;
    result.bottom = centerY + height / 2;
  }
  return result;
}

/**
 * ハンドルドラッグによる枠のリサイズを計算する(純粋関数)。Shift押下中は縦横比を維持し
 * (角ハンドルのみ)、Alt押下中は中心を固定して拡縮する。画像範囲へのクランプは呼び出し側
 * (`clampBoxToImage`)で行う(ここでは最小サイズの制限のみ行う)。
 */
export function applyResize(
  box: Rect,
  handle: ResizeHandle,
  imageX: number,
  imageY: number,
  modifiers: ResizeModifiers = { shiftKey: false, altKey: false },
): Rect {
  let edges = applyRawEdges(box, handle, imageX, imageY);

  if (modifiers.shiftKey && isCornerHandle(handle)) {
    edges = applyAspectLock(box, handle, edges);
  }
  if (modifiers.altKey) {
    edges = applyCenterAnchor(box, handle, edges);
  }

  return toRect(edges);
}
