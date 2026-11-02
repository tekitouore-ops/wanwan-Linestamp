import type { RGB } from '../shared/types';

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * - `empty`: セル内に前景画素が見つからなかった。
 * - `touchesBoundary`: 前景がセル境界に接している(分割線で内容が切れている可能性)。
 * - `sizeOutlier`: 面積が他セルの中央値から大きく外れている。
 */
export type CellWarning = 'empty' | 'touchesBoundary' | 'sizeOutlier';

export interface DetectedCell {
  /** 0始まりのスタンプ番号(0 = No.1)。 */
  index: number;
  box: BBox;
  warnings: CellWarning[];
}

export type DetectionMethod = 'projection' | 'equal';

export interface DetectionResult {
  cells: DetectedCell[];
  method: DetectionMethod;
}

export interface DetectionParams {
  /** 未指定時は画像外周から自動推定する。 */
  backgroundColor?: RGB;
  /** 背景判定しきい値(1〜80)。 */
  backgroundThreshold: number;
  /** ノイズ除去の最小面積(画像全体に対する比率、0〜1)。 */
  minAreaRatio: number;
  cols: number;
  rows: number;
}

export const DEFAULT_DETECTION_PARAMS: Omit<DetectionParams, 'cols' | 'rows'> = {
  backgroundThreshold: 20,
  minAreaRatio: 0.00005,
};
