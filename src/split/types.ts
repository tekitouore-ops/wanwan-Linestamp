import { STAMP_MAX_HEIGHT, STAMP_MAX_WIDTH, STAMP_RECOMMENDED_MARGIN_PX } from '../shared/lineSpec';
import type { RGB } from '../shared/types';

export interface Rect {
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
  box: Rect;
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

/** 検出枠からの切り抜き量(元画像px)。各辺を内側へ削る。 */
export interface CropAmount {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 1スタンプぶんの個別設定。ステップBの左パネルで調整する項目。 */
export interface StampAdjust {
  /** 縁補正(-5〜+10px)。正で収縮(削る)、負で膨張(戻す)。 */
  edgeFix: number;
  /** 縁フチの太さ(0〜16px)。 */
  outline: number;
  /** 検出枠からの切り抜き量(元画像px)。 */
  crop: CropAmount;
  /** 拡大率(%)。100 = 安全領域にフィットする倍率。 */
  scale: number;
  /** 横位置オフセット(出力px)。 */
  offsetX: number;
  /** 縦位置オフセット(出力px)。 */
  offsetY: number;
}

export const DEFAULT_CROP: CropAmount = { top: 0, right: 0, bottom: 0, left: 0 };

export const DEFAULT_STAMP_ADJUST: StampAdjust = {
  edgeFix: 0,
  outline: 0,
  crop: DEFAULT_CROP,
  scale: 100,
  offsetX: 0,
  offsetY: 0,
};

/** ステップBの全体設定(個別設定で上書きしていない項目の既定値)。 */
export interface GlobalSettings {
  outputWidth: number;
  outputHeight: number;
  /** 内側余白(四辺共通、px)。 */
  innerMargin: number;
  /** 縁フチの既定値(px)。個別設定で上書きしていないスタンプに使う。 */
  defaultOutline: number;
  /** 透過しきい値(1〜80)。 */
  alphaThreshold: number;
  /** エッジのぼかし幅(0〜3px)。 */
  featherPx: number;
  align: 'center' | 'bottom';
  allowUpscale: boolean;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  outputWidth: STAMP_MAX_WIDTH,
  outputHeight: STAMP_MAX_HEIGHT,
  innerMargin: STAMP_RECOMMENDED_MARGIN_PX,
  // 既定は0(AIに白フチを描かせない前提のため)。実運用では4〜6pxが使われる想定(docs/decisions.md参照)。
  defaultOutline: 0,
  alphaThreshold: 24,
  featherPx: 1,
  align: 'center',
  allowUpscale: true,
};

export interface PreviewSettings {
  mode: 'checker' | 'color';
  color: string;
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  mode: 'checker',
  color: '#ffffff',
};

/** タブ②ステップBの作業状態。設定JSONとして保存/読込できる(画像本体は含めない)。 */
export interface ProjectState {
  version: 1;
  sourceName: string;
  /** 確定した検出枠(ステップAで編集した結果)。番号順、24個。 */
  frames: Rect[];
  globalSettings: GlobalSettings;
  /** 24個。未設定の項目は全体設定の既定値を使う。 */
  stamps: Array<Partial<StampAdjust>>;
  /** 表紙に設定したスタンプの番号(0始まり)。 */
  coverIndex: number;
  preview: PreviewSettings;
}

/** 個別設定(`Partial<StampAdjust>`)を全体設定の既定値とマージし、実際に使う値を求める。 */
export function resolveStampAdjust(
  globalSettings: GlobalSettings,
  override: Partial<StampAdjust> | undefined,
): StampAdjust {
  return {
    edgeFix: override?.edgeFix ?? DEFAULT_STAMP_ADJUST.edgeFix,
    outline: override?.outline ?? globalSettings.defaultOutline,
    crop: override?.crop ?? DEFAULT_CROP,
    scale: override?.scale ?? DEFAULT_STAMP_ADJUST.scale,
    offsetX: override?.offsetX ?? DEFAULT_STAMP_ADJUST.offsetX,
    offsetY: override?.offsetY ?? DEFAULT_STAMP_ADJUST.offsetY,
  };
}

/** `stamps[i]` に何らかの上書き値が入っているか(カードのドット表示に使う)。 */
export function isStampOverridden(override: Partial<StampAdjust> | undefined): boolean {
  return Boolean(override) && Object.keys(override as Partial<StampAdjust>).length > 0;
}
