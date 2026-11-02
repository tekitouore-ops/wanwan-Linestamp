import type { ImageDataLike } from './types';

function createContext2D(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2Dコンテキストを取得できませんでした。');
  }
  return ctx;
}

function bitmapToImageDataLike(bitmap: ImageBitmap): ImageDataLike {
  const ctx = createContext2D(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: imageData.width, height: imageData.height, data: imageData.data };
}

/** ファイル(PNG/JPEG/WebP等)を読み込み、ImageDataLikeに変換する。 */
export async function loadImageDataFromFile(file: File): Promise<ImageDataLike> {
  const bitmap = await createImageBitmap(file);
  try {
    return bitmapToImageDataLike(bitmap);
  } finally {
    bitmap.close();
  }
}

/** ImageDataLikeを描画済みのCanvasに変換する(プレビュー描画やサイズ変換のソースとして使う)。 */
export function imageDataLikeToCanvas(image: ImageDataLike): HTMLCanvasElement {
  const ctx = createContext2D(image.width, image.height);
  // Uint8ClampedArrayの型定義上SharedArrayBuffer由来の可能性が排除できないため、
  // 通常のArrayBufferで裏付けされた配列にコピーしてからImageDataへ渡す。
  const data = new Uint8ClampedArray(image.data);
  ctx.putImageData(new ImageData(data, image.width, image.height), 0, 0);
  return ctx.canvas;
}

/**
 * 画像の長辺が `maxDimension` を超える場合、高品質補間で縮小したコピーを返す。
 * 超えない場合は入力をそのまま返す(不要なコピーを避ける)。
 */
export function downscaleImageData(image: ImageDataLike, maxDimension: number): ImageDataLike {
  const longestSide = Math.max(image.width, image.height);
  if (longestSide <= maxDimension) {
    return image;
  }

  const scale = maxDimension / longestSide;
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));

  const source = imageDataLikeToCanvas(image);
  const ctx = createContext2D(targetWidth, targetHeight);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  return { width: imageData.width, height: imageData.height, data: imageData.data };
}
