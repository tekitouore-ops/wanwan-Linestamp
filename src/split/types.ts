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

/** 背景の扱い。`color`=背景色推定+色差方式(白背景などへのフォールバック)、`transparent`=元のアルファをそのまま使う。 */
export type BackgroundMode = 'color' | 'transparent';

export interface DetectionParams {
  /** `backgroundMode: 'color'` のとき、未指定なら画像外周から自動推定する。 */
  backgroundColor?: RGB;
  /** 背景判定しきい値(1〜80、`backgroundMode: 'color'` のときのみ使う)。 */
  backgroundThreshold: number;
  /** ノイズ除去の最小面積(画像全体に対する比率、0〜1)。 */
  minAreaRatio: number;
  cols: number;
  rows: number;
  backgroundMode: BackgroundMode;
  /** 前景判定しきい値(alpha、1〜80、`backgroundMode: 'transparent'` のときのみ使う)。 */
  alphaThreshold: number;
}

export const DEFAULT_DETECTION_PARAMS: Omit<DetectionParams, 'cols' | 'rows'> = {
  backgroundThreshold: 20,
  minAreaRatio: 0.00005,
  backgroundMode: 'color',
  alphaThreshold: 16,
};

/** 検出枠からの切り抜き量(元画像px)。各辺を内側へ削る。採用元シートごとに別々に保持する。 */
export interface CropAmount {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_CROP: CropAmount = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * 1スタンプぶんの描画用の調整値(解決済み・フラット形式)。`export/renderStamp.ts` 等、
 * 実際に描画する側はこの形で受け取る(採用元シートごとの出し分けは呼び出し側で解決済みとする)。
 */
export interface StampAdjust {
  /** 縁補正(-5〜+10px)。正で収縮(削る)、負で膨張(戻す)。 */
  edgeFix: number;
  /** 縁フチの太さ(0〜16px)。 */
  outline: number;
  /** 検出枠からの切り抜き量(元画像px、採用元シートの枠に対する値)。 */
  crop: CropAmount;
  /** 拡大率(%)。100 = 安全領域にフィットする倍率。 */
  scale: number;
  /** 横位置オフセット(出力px)。 */
  offsetX: number;
  /** 縦位置オフセット(出力px)。 */
  offsetY: number;
}

export const DEFAULT_STAMP_ADJUST: StampAdjust = {
  edgeFix: 0,
  outline: 0,
  crop: DEFAULT_CROP,
  scale: 100,
  offsetX: 0,
  offsetY: 0,
};

/** `StampAdjust` のうち、採用元シートを切り替えても引き継ぐ項目(crop以外)。 */
export type StampAdjustFields = Omit<StampAdjust, 'crop'>;

/** ステップBの全体設定(個別設定で上書きしていない項目の既定値)。プロジェクト全体で共通。 */
export interface GlobalSettings {
  outputWidth: number;
  outputHeight: number;
  /** 内側余白(四辺共通、px)。 */
  innerMargin: number;
  /** 縁フチの既定値(px)。個別設定で上書きしていないスタンプに使う。 */
  defaultOutline: number;
  /** 透過しきい値(1〜80、書き出し時の背景除去〈`export/alpha.ts`〉で使う)。 */
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

/**
 * 1枚のシート(読み込んだ画像1つぶん)のメタ情報。画像データ本体(ImageDataLike)は
 * `split/sheetStore.ts` が別途Mapで保持し、`ProjectState`・設定JSONには含めない。
 */
export interface Sheet {
  id: string;
  /** 表示名(初期値はファイル名)。変更可。 */
  name: string;
  width: number;
  height: number;
  detectSettings: DetectionParams;
  /** 確定した検出枠(ステップAで編集した結果)。番号順、24個。 */
  frames: Rect[];
  /** `frames` と同じ並びの警告一覧。 */
  frameWarnings: CellWarning[][];
}

/**
 * スタンプ番号ごとの個別設定。`sourceSheetId` でどのシートの同じ番号の枠を採用するかを指し、
 * `adjust`(crop以外)は採用元を切り替えても引き継ぎ、`cropBySheet` は採用元シートごとに別々に持つ。
 */
export interface StampSetting {
  sourceSheetId: string;
  adjust: Partial<StampAdjustFields>;
  cropBySheet: Record<string, CropAmount>;
}

export function createDefaultStampSetting(sourceSheetId: string): StampSetting {
  return { sourceSheetId, adjust: {}, cropBySheet: {} };
}

/** タブ②ステップBの作業状態。設定JSONとして保存/読込できる(画像本体は含めない)。 */
export interface ProjectState {
  version: 2;
  sheets: Sheet[];
  /** 24個。番号順。 */
  stamps: StampSetting[];
  globalSettings: GlobalSettings;
  /** 表紙に設定したスタンプの番号(0始まり)。 */
  coverIndex: number;
  preview: PreviewSettings;
}

/**
 * スタンプ設定(`StampSetting`)と全体設定から、実際に描画へ渡す `StampAdjust`(解決済み・フラット形式)
 * を求める。`crop` は `setting.sourceSheetId` に対応する値(なければ既定値)を使う。
 */
export function resolveStampAdjust(
  globalSettings: GlobalSettings,
  setting: StampSetting | undefined,
): StampAdjust {
  const crop = (setting && setting.cropBySheet[setting.sourceSheetId]) ?? DEFAULT_CROP;
  return {
    edgeFix: setting?.adjust.edgeFix ?? DEFAULT_STAMP_ADJUST.edgeFix,
    outline: setting?.adjust.outline ?? globalSettings.defaultOutline,
    crop,
    scale: setting?.adjust.scale ?? DEFAULT_STAMP_ADJUST.scale,
    offsetX: setting?.adjust.offsetX ?? DEFAULT_STAMP_ADJUST.offsetX,
    offsetY: setting?.adjust.offsetY ?? DEFAULT_STAMP_ADJUST.offsetY,
  };
}

/**
 * 個別設定が変更済みか(カードのドット表示用)。採用元(`sourceSheetId`)が既定と異なるだけでは
 * 変更済みとしない(採用元はS1/S2等のバッジで見分けられるため。追加修正指示書 項目11の不具合修正)。
 * `adjust` は、キーがあっても値が初期値(`outline`はグローバル設定の既定値)と同じなら変更済みに
 * 含めない。`cropBySheet` は、現在の採用元シートぶんの値が実際に非ゼロの場合だけ変更済みとする
 * (`resolveStampAdjust` が使う値と同じ基準)。
 */
export function isStampModified(
  setting: StampSetting | undefined,
  globalSettings: GlobalSettings,
): boolean {
  if (!setting) {
    return false;
  }

  const adjustDefaults: StampAdjustFields = {
    edgeFix: DEFAULT_STAMP_ADJUST.edgeFix,
    outline: globalSettings.defaultOutline,
    scale: DEFAULT_STAMP_ADJUST.scale,
    offsetX: DEFAULT_STAMP_ADJUST.offsetX,
    offsetY: DEFAULT_STAMP_ADJUST.offsetY,
  };
  const adjustKeys = Object.keys(setting.adjust) as Array<keyof StampAdjustFields>;
  if (adjustKeys.some((key) => setting.adjust[key] !== adjustDefaults[key])) {
    return true;
  }

  const activeCrop = setting.cropBySheet[setting.sourceSheetId] ?? DEFAULT_CROP;
  if (
    activeCrop.top !== 0 ||
    activeCrop.right !== 0 ||
    activeCrop.bottom !== 0 ||
    activeCrop.left !== 0
  ) {
    return true;
  }

  return false;
}
