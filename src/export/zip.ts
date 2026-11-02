import JSZip from 'jszip';
import { imageDataLikeToPngBlob } from '../shared/imageData';
import { stampFileName } from '../shared/lineSpec';
import type { ImageDataLike } from '../shared/types';

/** あらかじめPNG化したBlob配列から、01.png〜24.pngを含むZIPのBlobを作る。 */
export async function buildStampZipFromBlobs(blobs: Blob[]): Promise<Blob> {
  const zip = new JSZip();
  blobs.forEach((blob, i) => {
    zip.file(stampFileName(i + 1), blob);
  });
  return zip.generateAsync({ type: 'blob' });
}

/**
 * 01.png〜24.pngに加えて、main.png・tab.pngなど任意の名前のファイルも含めたZIPを作る。
 * `extraFiles` はファイル名をキーにしたBlobのマップ(例: `{ 'main.png': blob, 'tab.png': blob }`)。
 */
export async function buildFullZipFromBlobs(
  stampBlobs: Blob[],
  extraFiles: Record<string, Blob>,
): Promise<Blob> {
  const zip = new JSZip();
  stampBlobs.forEach((blob, i) => {
    zip.file(stampFileName(i + 1), blob);
  });
  Object.entries(extraFiles).forEach(([name, blob]) => {
    zip.file(name, blob);
  });
  return zip.generateAsync({ type: 'blob' });
}

/** 24枚のImageDataLikeから、01.png〜24.pngを含むZIPのBlobを作る。 */
export async function buildStampZipBlob(images: ImageDataLike[]): Promise<Blob> {
  const blobs: Blob[] = [];
  for (const image of images) {
    blobs.push(await imageDataLikeToPngBlob(image));
  }
  return buildStampZipFromBlobs(blobs);
}

export function formatZipFileName(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `stamps_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}.zip`;
}
