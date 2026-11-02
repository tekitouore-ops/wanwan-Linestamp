import type { RenderSettings } from './types';

export interface LayoutResult {
  /** 基準倍率(余白内に収める倍率)× 設定の拡大率。 */
  scale: number;
  /** 出力キャンバス上で、被写体(拡大率適用後)の左上が来るべき位置。 */
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  /** 実効拡大率が1.3倍を超え、解像度不足でぼやける可能性がある場合true。 */
  isUpscaled: boolean;
}

const UPSCALE_WARNING_THRESHOLD = 1.3;

/** 出力サイズを偶数に切り下げる(LINE規格の「幅・高さは偶数」要件)。 */
export function roundToEven(value: number): number {
  const floored = Math.floor(value);
  return floored % 2 === 0 ? floored : floored - 1;
}

/**
 * 被写体(subjectWidth × subjectHeight)を、出力キャンバスの余白内に収める配置を計算する。
 * 余白を引いた内側の矩形に収まる最大倍率をベースとし、そこに設定の拡大率・オフセットを適用する。
 * 拡大率が大きく、内側の矩形からはみ出す場合でもクランプはしない(ユーザーが明示的に指定した拡大率のため)。
 */
export function computeLayout(
  subjectWidth: number,
  subjectHeight: number,
  settings: RenderSettings,
): LayoutResult {
  const innerWidth = Math.max(1, settings.outputWidth - settings.marginLeft - settings.marginRight);
  const innerHeight = Math.max(
    1,
    settings.outputHeight - settings.marginTop - settings.marginBottom,
  );

  const safeSubjectWidth = Math.max(1, subjectWidth);
  const safeSubjectHeight = Math.max(1, subjectHeight);

  const baseScale = Math.min(innerWidth / safeSubjectWidth, innerHeight / safeSubjectHeight);
  const uncappedScale = baseScale * settings.scale;
  // アップスケール許可がOFFの場合、被写体の原寸(1倍)を超えて引き伸ばさない。
  const scale = settings.allowUpscale ? uncappedScale : Math.min(uncappedScale, 1);

  const drawWidth = safeSubjectWidth * scale;
  const drawHeight = safeSubjectHeight * scale;

  const drawX = settings.marginLeft + (innerWidth - drawWidth) / 2 + settings.offsetX;
  const drawY =
    settings.align === 'bottom'
      ? settings.outputHeight - settings.marginBottom - drawHeight + settings.offsetY
      : settings.marginTop + (innerHeight - drawHeight) / 2 + settings.offsetY;

  return {
    scale,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
    isUpscaled: scale > UPSCALE_WARNING_THRESHOLD,
  };
}
