import { STAMP_MAX_HEIGHT, STAMP_MAX_WIDTH, STAMP_RECOMMENDED_MARGIN_PX } from '../shared/lineSpec';

/** 1枚のスタンプを描画する際の全体設定。 */
export interface RenderSettings {
  outputWidth: number;
  outputHeight: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  /** 0.5〜1.5。自動計算した基準倍率にさらに掛ける拡大率。 */
  scale: number;
  offsetX: number;
  offsetY: number;
  align: 'center' | 'bottom';
  /** 背景判定しきい値(1〜80程度)。 */
  alphaThreshold: number;
  /** エッジのぼかし幅(0〜3px)。 */
  featherPx: number;
  /** 白フチの太さ(0〜16px、0でOFF)。 */
  outlineWidthPx: number;
  allowUpscale: boolean;
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  outputWidth: STAMP_MAX_WIDTH,
  outputHeight: STAMP_MAX_HEIGHT,
  marginTop: STAMP_RECOMMENDED_MARGIN_PX,
  marginRight: STAMP_RECOMMENDED_MARGIN_PX,
  marginBottom: STAMP_RECOMMENDED_MARGIN_PX,
  marginLeft: STAMP_RECOMMENDED_MARGIN_PX,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  align: 'center',
  alphaThreshold: 24,
  featherPx: 1,
  outlineWidthPx: 6,
  allowUpscale: true,
};

/** 個別設定で上書きできる項目(全体設定のサブセット)。 */
export interface CellOverride {
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  outlineWidthPx?: number;
}

export function mergeRenderSettings(
  global: RenderSettings,
  override: CellOverride | undefined,
): RenderSettings {
  return override ? { ...global, ...override } : global;
}
