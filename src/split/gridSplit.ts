import type { ImageDataLike, RGB } from '../shared/types';
import { buildForegroundMask, estimateBackgroundColor, removeNoise } from './mask';
import type {
  BBox,
  CellWarning,
  DetectedCell,
  DetectionMethod,
  DetectionParams,
  DetectionResult,
} from './types';

interface BoundarySearchResult {
  ok: boolean;
  boundaries: number[];
}

/** `count-1`本の内部境界+両端(0, totalLength)からなる境界配列を、理想位置周辺の「空の帯」探索で求める。 */
function findBoundaries(
  densities: number[],
  totalLength: number,
  count: number,
  emptyThreshold: number,
): BoundarySearchResult {
  if (count <= 1) {
    return { ok: true, boundaries: [0, totalLength] };
  }

  const cellSize = totalLength / count;
  const boundaries: number[] = [0];

  for (let i = 1; i < count; i += 1) {
    const ideal = Math.round(i * cellSize);
    const radius = Math.max(1, Math.round(cellSize * 0.35));
    const previous = boundaries[boundaries.length - 1] ?? 0;
    const searchStart = Math.max(previous + 1, ideal - radius);
    const searchEnd = Math.min(totalLength - 1, ideal + radius);
    if (searchStart > searchEnd) {
      return { ok: false, boundaries: [] };
    }

    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    let curLen = 0;
    let minDensity = Number.POSITIVE_INFINITY;
    let minPos = searchStart;

    for (let p = searchStart; p <= searchEnd; p += 1) {
      const density = densities[p] ?? 0;
      if (density < minDensity) {
        minDensity = density;
        minPos = p;
      }
      if (density <= emptyThreshold) {
        if (curStart === -1) {
          curStart = p;
        }
        curLen += 1;
        if (curLen > bestLen) {
          bestLen = curLen;
          bestStart = curStart;
        }
      } else {
        curStart = -1;
        curLen = 0;
      }
    }

    const boundary = bestLen > 0 ? Math.round(bestStart + (bestLen - 1) / 2) : minPos;
    boundaries.push(boundary);
  }

  boundaries.push(totalLength);

  const minGap = cellSize * 0.3;
  for (let i = 1; i < boundaries.length; i += 1) {
    if ((boundaries[i] ?? 0) - (boundaries[i - 1] ?? 0) < minGap) {
      return { ok: false, boundaries: [] };
    }
  }

  return { ok: true, boundaries };
}

function rowDensities(mask: Uint8Array, width: number, height: number): number[] {
  const densities = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      sum += mask[rowStart + x] ?? 0;
    }
    densities[y] = sum;
  }
  return densities;
}

function colDensities(
  mask: Uint8Array,
  width: number,
  bandTop: number,
  bandBottom: number,
): number[] {
  const densities = new Array<number>(width).fill(0);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = bandTop; y < bandBottom; y += 1) {
      sum += mask[y * width + x] ?? 0;
    }
    densities[x] = sum;
  }
  return densities;
}

function equalBoundaries(totalLength: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.round((i * totalLength) / count));
}

interface CellRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function computeCellBox(
  mask: Uint8Array,
  width: number,
  region: CellRegion,
): { box: BBox; hasForeground: boolean } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = region.top; y < region.bottom; y += 1) {
    const rowStart = y * width;
    for (let x = region.left; x < region.right; x += 1) {
      if (mask[rowStart + x] === 1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX === Number.POSITIVE_INFINITY) {
    return {
      box: {
        x: region.left,
        y: region.top,
        width: region.right - region.left,
        height: region.bottom - region.top,
      },
      hasForeground: false,
    };
  }

  return {
    box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    hasForeground: true,
  };
}

const BOUNDARY_TOUCH_EPSILON_PX = 1;
const SIZE_OUTLIER_MIN_RATIO = 0.25;
const SIZE_OUTLIER_MAX_RATIO = 3;

function computeWarnings(
  box: BBox,
  region: CellRegion,
  hasForeground: boolean,
  medianArea: number,
): CellWarning[] {
  if (!hasForeground) {
    return ['empty'];
  }

  const warnings: CellWarning[] = [];
  const touchesLeft = box.x <= region.left + BOUNDARY_TOUCH_EPSILON_PX;
  const touchesTop = box.y <= region.top + BOUNDARY_TOUCH_EPSILON_PX;
  const touchesRight = box.x + box.width >= region.right - BOUNDARY_TOUCH_EPSILON_PX;
  const touchesBottom = box.y + box.height >= region.bottom - BOUNDARY_TOUCH_EPSILON_PX;
  if (touchesLeft || touchesTop || touchesRight || touchesBottom) {
    warnings.push('touchesBoundary');
  }

  const area = box.width * box.height;
  if (
    medianArea > 0 &&
    (area < medianArea * SIZE_OUTLIER_MIN_RATIO || area > medianArea * SIZE_OUTLIER_MAX_RATIO)
  ) {
    warnings.push('sizeOutlier');
  }

  return warnings;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function buildCells(
  mask: Uint8Array,
  width: number,
  rowBoundaries: number[],
  colBoundariesPerRow: number[][],
  cols: number,
  rows: number,
): DetectedCell[] {
  const regions: CellRegion[] = [];
  const computed: Array<{ box: BBox; hasForeground: boolean }> = [];

  for (let r = 0; r < rows; r += 1) {
    const top = rowBoundaries[r] ?? 0;
    const bottom = rowBoundaries[r + 1] ?? top;
    const colBoundaries = colBoundariesPerRow[r] ?? equalBoundaries(width, cols);
    for (let c = 0; c < cols; c += 1) {
      const left = colBoundaries[c] ?? 0;
      const right = colBoundaries[c + 1] ?? left;
      const region: CellRegion = { left, top, right, bottom };
      regions.push(region);
      computed.push(computeCellBox(mask, width, region));
    }
  }

  const areas = computed.filter((c) => c.hasForeground).map((c) => c.box.width * c.box.height);
  const medianArea = median(areas);

  return computed.map((c, index) => ({
    index,
    box: c.box,
    warnings: computeWarnings(
      c.box,
      regions[index] ?? { left: 0, top: 0, right: 0, bottom: 0 },
      c.hasForeground,
      medianArea,
    ),
  }));
}

function buildCleanedMask(
  image: ImageDataLike,
  params: DetectionParams,
): { mask: Uint8Array; backgroundColor: RGB } {
  const backgroundColor = params.backgroundColor ?? estimateBackgroundColor(image);
  const rawMask = buildForegroundMask(image, backgroundColor, params.backgroundThreshold);
  const minArea = Math.max(1, Math.round(image.width * image.height * params.minAreaRatio));
  const mask = removeNoise(rawMask, image.width, image.height, minArea);
  return { mask, backgroundColor };
}

function detectByEqualDivision(
  image: ImageDataLike,
  params: DetectionParams,
  mask: Uint8Array,
): DetectionResult {
  const rowBoundaries = equalBoundaries(image.height, params.rows);
  const colBoundaries = equalBoundaries(image.width, params.cols);
  const colBoundariesPerRow = Array.from({ length: params.rows }, () => colBoundaries);
  const cells = buildCells(
    mask,
    image.width,
    rowBoundaries,
    colBoundariesPerRow,
    params.cols,
    params.rows,
  );
  return { cells, method: 'equal' };
}

/**
 * 投影法でグリッド境界を検出し、セルごとのbboxを求める。検出に失敗した場合は等分割にフォールバックする。
 * アルゴリズムの詳細は docs/architecture.md を参照。
 */
export function detectGrid(image: ImageDataLike, params: DetectionParams): DetectionResult {
  const { mask } = buildCleanedMask(image, params);

  const rowEmptyThreshold = Math.max(1, Math.round(image.width * 0.01));
  const rowResult = findBoundaries(
    rowDensities(mask, image.width, image.height),
    image.height,
    params.rows,
    rowEmptyThreshold,
  );
  if (!rowResult.ok) {
    return detectByEqualDivision(image, params, mask);
  }

  const colBoundariesPerRow: number[][] = [];
  for (let r = 0; r < params.rows; r += 1) {
    const bandTop = rowResult.boundaries[r] ?? 0;
    const bandBottom = rowResult.boundaries[r + 1] ?? bandTop;
    const bandHeight = bandBottom - bandTop;
    const colEmptyThreshold = Math.max(1, Math.round(bandHeight * 0.01));
    const colResult = findBoundaries(
      colDensities(mask, image.width, bandTop, bandBottom),
      image.width,
      params.cols,
      colEmptyThreshold,
    );
    if (!colResult.ok) {
      return detectByEqualDivision(image, params, mask);
    }
    colBoundariesPerRow.push(colResult.boundaries);
  }

  const cells = buildCells(
    mask,
    image.width,
    rowResult.boundaries,
    colBoundariesPerRow,
    params.cols,
    params.rows,
  );
  return { cells, method: 'projection' };
}

/** ユーザーが明示的に「等分割」を選んだ場合に使う。 */
export function detectGridEqualDivision(
  image: ImageDataLike,
  params: DetectionParams,
): DetectionResult {
  const { mask } = buildCleanedMask(image, params);
  return detectByEqualDivision(image, params, mask);
}

/** 指定した矩形内の前景画素にぴったり合わせたbboxを求める(「内容にフィット」機能用)。 */
export function fitBoxToContent(image: ImageDataLike, region: BBox, params: DetectionParams): BBox {
  const backgroundColor = params.backgroundColor ?? estimateBackgroundColor(image);
  const mask = buildForegroundMask(image, backgroundColor, params.backgroundThreshold);
  const cellRegion: CellRegion = {
    left: Math.max(0, Math.round(region.x)),
    top: Math.max(0, Math.round(region.y)),
    right: Math.min(image.width, Math.round(region.x + region.width)),
    bottom: Math.min(image.height, Math.round(region.y + region.height)),
  };
  const { box } = computeCellBox(mask, image.width, cellRegion);
  return box;
}

export type { DetectionMethod };
