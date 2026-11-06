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
  return resizeImageDataLike(image, targetWidth, targetHeight);
}

function resizeCanvasOnce(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const ctx = createContext2D(width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.canvas;
}

/**
 * 高品質補間でImageDataLikeを指定サイズに変換する。大きな縮小(1/2未満への縮小)は、
 * 1回の`drawImage`では品質が落ちやすいため、2倍ずつの段階的な縮小を繰り返してから最終サイズに合わせる。
 */
export function resizeImageDataLike(
  image: ImageDataLike,
  targetWidth: number,
  targetHeight: number,
): ImageDataLike {
  const width = Math.max(1, Math.round(targetWidth));
  const height = Math.max(1, Math.round(targetHeight));

  let current: CanvasImageSource = imageDataLikeToCanvas(image);
  let currentWidth = image.width;
  let currentHeight = image.height;

  while (currentWidth > width * 2 || currentHeight > height * 2) {
    const nextWidth = Math.max(width, Math.round(currentWidth / 2));
    const nextHeight = Math.max(height, Math.round(currentHeight / 2));
    current = resizeCanvasOnce(current, nextWidth, nextHeight);
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  const ctx = createContext2D(width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { width: imageData.width, height: imageData.height, data: imageData.data };
}

/**
 * 1チャンネル(グレースケール)のUint8ClampedArrayを、PNG形式のdata URL(base64)に変換する。
 * 手動消しゴムのマスクを設定JSONへ保存する用途(`split/eraseMaskCodec.ts`)で使う。
 */
export function grayscaleToPngDataUrl(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  const ctx = createContext2D(width, height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    const v = data[p] ?? 0;
    const i = p * 4;
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return ctx.canvas.toDataURL('image/png');
}

/** `grayscaleToPngDataUrl`の逆変換。PNGのR成分を1チャンネルの値として読み出す。 */
export async function pngDataUrlToGrayscale(
  dataUrl: string,
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const ctx = createContext2D(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const data = new Uint8ClampedArray(bitmap.width * bitmap.height);
    for (let p = 0; p < data.length; p += 1) {
      data[p] = imageData.data[p * 4] ?? 0;
    }
    return { width: bitmap.width, height: bitmap.height, data };
  } finally {
    bitmap.close();
  }
}

/** ImageDataLikeをPNG形式のBlobに変換する(ZIP書き出し・個別ダウンロードで使う)。 */
export function imageDataLikeToPngBlob(image: ImageDataLike): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = imageDataLikeToCanvas(image);
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('PNGへの変換に失敗しました。'));
      }
    }, 'image/png');
  });
}
