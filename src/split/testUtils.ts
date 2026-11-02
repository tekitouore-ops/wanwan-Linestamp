import type { ImageDataLike } from '../shared/types';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/** テスト用に、単色で塗りつぶしたImageDataLikeを合成する。 */
export function createSolidImage(width: number, height: number, color: RGBA): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    const i = p * 4;
    data[i] = color.r;
    data[i + 1] = color.g;
    data[i + 2] = color.b;
    data[i + 3] = color.a ?? 255;
  }
  return { width, height, data };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 画像上の矩形領域を指定色で塗る(画像外にはみ出す部分は無視する)。 */
export function fillRect(image: ImageDataLike, rect: Rect, color: RGBA): void {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(image.width, rect.x + rect.width);
  const bottom = Math.min(image.height, rect.y + rect.height);

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const i = (y * image.width + x) * 4;
      image.data[i] = color.r;
      image.data[i + 1] = color.g;
      image.data[i + 2] = color.b;
      image.data[i + 3] = color.a ?? 255;
    }
  }
}
