export interface LayoutSettings {
  outputWidth: number;
  outputHeight: number;
  /** 内側余白(四辺共通、px)。 */
  innerMargin: number;
  align: 'center' | 'bottom';
  allowUpscale: boolean;
  /** 拡大率(%)。100 = 安全領域にフィットする倍率。 */
  scalePercent: number;
  offsetX: number;
  offsetY: number;
}

export interface LayoutResult {
  /** 安全領域にフィットする基準倍率 × (scalePercent/100)。 */
  scale: number;
  /** 出力キャンバス上で、被写体(拡大適用後)の左上が来るべき位置。 */
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  /** 実効倍率が1.3倍を超え、解像度不足でぼやける可能性がある場合true。 */
  isUpscaled: boolean;
  /** 配置の結果、被写体が出力キャンバスの外にはみ出して切れる場合true。 */
  isOverflowing: boolean;
}

const UPSCALE_WARNING_THRESHOLD = 1.3;

/** 出力サイズを偶数に切り下げる(LINE規格の「幅・高さは偶数」要件)。 */
export function roundToEven(value: number): number {
  const floored = Math.floor(value);
  return floored % 2 === 0 ? floored : floored - 1;
}

/**
 * 被写体(subjectWidth × subjectHeight)を、出力キャンバスの内側余白(安全領域)に収める配置を計算する。
 * 安全領域に収まる最大倍率を100%とし、そこに`scalePercent`・オフセットを適用する。
 * 安全領域や出力キャンバスからはみ出す場合でもクランプはしない(ユーザーが明示的に指定した拡大率のため)が、
 * `isOverflowing` でキャンバス外に出て切れることを呼び出し側に伝える。
 */
export function computeLayout(subjectWidth: number, subjectHeight: number, settings: LayoutSettings): LayoutResult {
  const innerWidth = Math.max(1, settings.outputWidth - settings.innerMargin * 2);
  const innerHeight = Math.max(1, settings.outputHeight - settings.innerMargin * 2);

  const safeSubjectWidth = Math.max(1, subjectWidth);
  const safeSubjectHeight = Math.max(1, subjectHeight);

  const baseScale = Math.min(innerWidth / safeSubjectWidth, innerHeight / safeSubjectHeight);
  const uncappedScale = baseScale * (settings.scalePercent / 100);
  // アップスケール許可がOFFの場合、被写体の原寸(1倍)を超えて引き伸ばさない。
  const scale = settings.allowUpscale ? uncappedScale : Math.min(uncappedScale, 1);

  const drawWidth = safeSubjectWidth * scale;
  const drawHeight = safeSubjectHeight * scale;

  const drawX = settings.innerMargin + (innerWidth - drawWidth) / 2 + settings.offsetX;
  const drawY =
    settings.align === 'bottom'
      ? settings.outputHeight - settings.innerMargin - drawHeight + settings.offsetY
      : settings.innerMargin + (innerHeight - drawHeight) / 2 + settings.offsetY;

  const isOverflowing =
    drawX < 0 || drawY < 0 || drawX + drawWidth > settings.outputWidth || drawY + drawHeight > settings.outputHeight;

  return {
    scale,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
    isUpscaled: scale > UPSCALE_WARNING_THRESHOLD,
    isOverflowing,
  };
}
