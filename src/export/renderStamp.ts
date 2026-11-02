import { resizeImageDataLike } from '../shared/imageData';
import type { ImageDataLike, RGB } from '../shared/types';
import type { BBox } from '../split/types';
import { removeBackground } from './alpha';
import { computeLayout, roundToEven } from './layout';
import { addWhiteOutline } from './outline';
import type { RenderSettings } from './types';

/**
 * 枠(box)に白フチ分の余白を加えた範囲を元画像から切り出す。
 * 枠の外側(余白部分)の画素は、隣のスタンプの混入を防ぐため強制的に背景色として扱う。
 */
export function cropWithForcedBackground(
  source: ImageDataLike,
  box: BBox,
  marginPx: number,
  backgroundColor: RGB,
): ImageDataLike {
  const cropX = Math.round(box.x) - marginPx;
  const cropY = Math.round(box.y) - marginPx;
  const cropWidth = Math.max(1, Math.round(box.width) + marginPx * 2);
  const cropHeight = Math.max(1, Math.round(box.height) + marginPx * 2);

  const data = new Uint8ClampedArray(cropWidth * cropHeight * 4);

  for (let y = 0; y < cropHeight; y += 1) {
    const srcY = cropY + y;
    const outsideBoxY = y < marginPx || y >= marginPx + box.height;
    for (let x = 0; x < cropWidth; x += 1) {
      const srcX = cropX + x;
      const outsideBoxX = x < marginPx || x >= marginPx + box.width;
      const outsideImage = srcX < 0 || srcY < 0 || srcX >= source.width || srcY >= source.height;
      const i = (y * cropWidth + x) * 4;

      if (outsideBoxX || outsideBoxY || outsideImage) {
        data[i] = backgroundColor.r;
        data[i + 1] = backgroundColor.g;
        data[i + 2] = backgroundColor.b;
        data[i + 3] = 255;
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

/**
 * 1個のスタンプを、元画像・検出枠・設定から規格サイズのImageDataLikeとして描画する。
 * プレビューとZIP書き出しの両方でこの関数を使う。パイプラインの詳細はdocs/architecture.mdを参照。
 */
export function renderStamp(
  sourceImage: ImageDataLike,
  box: BBox,
  backgroundColor: RGB,
  settings: RenderSettings,
): ImageDataLike {
  const outputWidth = Math.max(2, roundToEven(settings.outputWidth));
  const outputHeight = Math.max(2, roundToEven(settings.outputHeight));

  const marginPx = settings.outlineWidthPx + settings.featherPx + 2;
  const cropped = cropWithForcedBackground(sourceImage, box, marginPx, backgroundColor);
  const matted = removeBackground(
    cropped,
    backgroundColor,
    settings.alphaThreshold,
    settings.featherPx,
  );

  const layout = computeLayout(box.width, box.height, { ...settings, outputWidth, outputHeight });

  const fullDrawWidth = Math.max(1, Math.round(matted.width * layout.scale));
  const fullDrawHeight = Math.max(1, Math.round(matted.height * layout.scale));
  const fullDrawX = Math.round(layout.drawX - marginPx * layout.scale);
  const fullDrawY = Math.round(layout.drawY - marginPx * layout.scale);

  const resized = resizeImageDataLike(matted, fullDrawWidth, fullDrawHeight);
  const composed = compositeOntoCanvas(resized, outputWidth, outputHeight, fullDrawX, fullDrawY);

  return addWhiteOutline(composed, settings.outlineWidthPx);
}

/** このスタンプが解像度不足で拡大されすぎていないか(ぼやける可能性があるか)を判定する。 */
export function isUpscaledTooMuch(box: BBox, settings: RenderSettings): boolean {
  const outputWidth = Math.max(2, roundToEven(settings.outputWidth));
  const outputHeight = Math.max(2, roundToEven(settings.outputHeight));
  return computeLayout(box.width, box.height, { ...settings, outputWidth, outputHeight })
    .isUpscaled;
}
