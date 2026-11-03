import { resizeImageDataLike } from '../shared/imageData';
import type { ImageDataLike, RGB } from '../shared/types';
import type { BackgroundMode, GlobalSettings, Rect, StampAdjust } from '../split/types';
import { keepOriginalAlpha, removeBackground } from './alpha';
import { applyEdgeFix } from './edge';
import { computeLayout, roundToEven, type LayoutResult } from './layout';
import { addWhiteOutline } from './outline';

/**
 * 範囲(frame)に余白を加えた範囲を元画像から切り出す。
 * 範囲の外側(余白部分)の画素は、隣のスタンプの混入を防ぐため強制的に背景として扱う
 * (`backgroundMode: 'color'` のときは不透明な`backgroundColor`、`'transparent'` のときは透明)。
 */
export function cropWithForcedBackground(
  source: ImageDataLike,
  frame: Rect,
  marginPx: number,
  backgroundColor: RGB,
  backgroundMode: BackgroundMode = 'color',
): ImageDataLike {
  const cropX = Math.round(frame.x) - marginPx;
  const cropY = Math.round(frame.y) - marginPx;
  const cropWidth = Math.max(1, Math.round(frame.width) + marginPx * 2);
  const cropHeight = Math.max(1, Math.round(frame.height) + marginPx * 2);

  const data = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  const forcedAlpha = backgroundMode === 'transparent' ? 0 : 255;

  for (let y = 0; y < cropHeight; y += 1) {
    const srcY = cropY + y;
    const outsideFrameY = y < marginPx || y >= marginPx + frame.height;
    for (let x = 0; x < cropWidth; x += 1) {
      const srcX = cropX + x;
      const outsideFrameX = x < marginPx || x >= marginPx + frame.width;
      const outsideImage = srcX < 0 || srcY < 0 || srcX >= source.width || srcY >= source.height;
      const i = (y * cropWidth + x) * 4;

      if (outsideFrameX || outsideFrameY || outsideImage) {
        data[i] = backgroundColor.r;
        data[i + 1] = backgroundColor.g;
        data[i + 2] = backgroundColor.b;
        data[i + 3] = forcedAlpha;
      } else {
        const si = (srcY * source.width + srcX) * 4;
        data[i] = source.data[si] ?? backgroundColor.r;
        data[i + 1] = source.data[si + 1] ?? backgroundColor.g;
        data[i + 2] = source.data[si + 2] ?? backgroundColor.b;
        data[i + 3] = source.data[si + 3] ?? 255;
      }
    }
  }

  return { width: cropWidth, height: cropHeight, data };
}

/** 透明なoutputWidth×outputHeightの土台に、画像を(offsetX, offsetY)の位置へ貼り付ける。 */
export function compositeOntoCanvas(
  image: ImageDataLike,
  outputWidth: number,
  outputHeight: number,
  offsetX: number,
  offsetY: number,
): ImageDataLike {
  const data = new Uint8ClampedArray(outputWidth * outputHeight * 4);

  for (let y = 0; y < image.height; y += 1) {
    const dy = y + offsetY;
    if (dy < 0 || dy >= outputHeight) {
      continue;
    }
    for (let x = 0; x < image.width; x += 1) {
      const dx = x + offsetX;
      if (dx < 0 || dx >= outputWidth) {
        continue;
      }
      const si = (y * image.width + x) * 4;
      const di = (dy * outputWidth + dx) * 4;
      data[di] = image.data[si] ?? 0;
      data[di + 1] = image.data[si + 1] ?? 0;
      data[di + 2] = image.data[si + 2] ?? 0;
      data[di + 3] = image.data[si + 3] ?? 0;
    }
  }

  return { width: outputWidth, height: outputHeight, data };
}

/** 検出枠(frame)に個別設定の切り抜き(crop)を適用した、実際に処理対象とする範囲(元画像px)を求める。 */
export function computeEffectiveFrame(frame: Rect, crop: StampAdjust['crop']): Rect {
  return {
    x: frame.x + crop.left,
    y: frame.y + crop.top,
    width: Math.max(1, frame.width - crop.left - crop.right),
    height: Math.max(1, frame.height - crop.top - crop.bottom),
  };
}

function computeStampLayout(
  frame: Rect,
  adjust: StampAdjust,
  globalSettings: GlobalSettings,
): LayoutResult {
  const effectiveFrame = computeEffectiveFrame(frame, adjust.crop);
  const outputWidth = Math.max(2, roundToEven(globalSettings.outputWidth));
  const outputHeight = Math.max(2, roundToEven(globalSettings.outputHeight));
  return computeLayout(effectiveFrame.width, effectiveFrame.height, {
    outputWidth,
    outputHeight,
    innerMargin: globalSettings.innerMargin,
    align: globalSettings.align,
    allowUpscale: globalSettings.allowUpscale,
    scalePercent: adjust.scale,
    offsetX: adjust.offsetX,
    offsetY: adjust.offsetY,
  });
}

/**
 * 1個のスタンプを、元画像・検出枠・全体設定・個別設定(解決済み)から規格サイズの
 * ImageDataLikeとして描画する。プレビューとZIP書き出しの両方でこの関数を使う。
 * パイプラインの詳細はdocs/architecture.mdを参照。
 */
export function renderStamp(
  sourceImage: ImageDataLike,
  frame: Rect,
  backgroundColor: RGB,
  globalSettings: GlobalSettings,
  adjust: StampAdjust,
  backgroundMode: BackgroundMode = 'color',
): ImageDataLike {
  const outputWidth = Math.max(2, roundToEven(globalSettings.outputWidth));
  const outputHeight = Math.max(2, roundToEven(globalSettings.outputHeight));
  const effectiveFrame = computeEffectiveFrame(frame, adjust.crop);

  const marginPx = globalSettings.featherPx + 2;
  const cropped = cropWithForcedBackground(
    sourceImage,
    effectiveFrame,
    marginPx,
    backgroundColor,
    backgroundMode,
  );
  const matted =
    backgroundMode === 'transparent'
      ? keepOriginalAlpha(cropped)
      : removeBackground(
          cropped,
          backgroundColor,
          globalSettings.alphaThreshold,
          globalSettings.featherPx,
        );
  const edgeFixed = applyEdgeFix(matted, adjust.edgeFix);

  const layout = computeStampLayout(frame, adjust, globalSettings);

  const fullDrawWidth = Math.max(1, Math.round(edgeFixed.width * layout.scale));
  const fullDrawHeight = Math.max(1, Math.round(edgeFixed.height * layout.scale));
  const fullDrawX = Math.round(layout.drawX - marginPx * layout.scale);
  const fullDrawY = Math.round(layout.drawY - marginPx * layout.scale);

  const resized = resizeImageDataLike(edgeFixed, fullDrawWidth, fullDrawHeight);
  const composed = compositeOntoCanvas(resized, outputWidth, outputHeight, fullDrawX, fullDrawY);

  // 縁フチは配置(リサイズ)の後、出力解像度で適用する(docs/decisions.md参照)。
  return addWhiteOutline(composed, adjust.outline);
}

export interface StampWarnings {
  /** 実効拡大率が1.3倍を超え、解像度不足でぼやける可能性がある場合true。 */
  isUpscaled: boolean;
  /** 配置の結果、被写体が出力キャンバスの外にはみ出して切れる場合true。 */
  isOverflowing: boolean;
}

/**
 * 実際に描画せず、解像度不足・はみ出しの警告だけを判定する(カードの警告バッジ用)。
 * はみ出し判定は、縁フチ(`adjust.outline`)で膨張する分も含めて行う(修正指示書 項目8参照)。
 * 縁フチ単体でキャンバス外へ出る場合も、既存の「配置がキャンバスからはみ出し」警告を使う
 * (縁フチ専用の別警告は増やさない)。
 */
export function computeStampWarnings(
  frame: Rect,
  adjust: StampAdjust,
  globalSettings: GlobalSettings,
): StampWarnings {
  const outputWidth = Math.max(2, roundToEven(globalSettings.outputWidth));
  const outputHeight = Math.max(2, roundToEven(globalSettings.outputHeight));
  const layout = computeStampLayout(frame, adjust, globalSettings);
  const outline = Math.max(0, adjust.outline);
  const isOverflowing =
    layout.isOverflowing ||
    layout.drawX - outline < 0 ||
    layout.drawY - outline < 0 ||
    layout.drawX + layout.drawWidth + outline > outputWidth ||
    layout.drawY + layout.drawHeight + outline > outputHeight;
  return { isUpscaled: layout.isUpscaled, isOverflowing };
}
