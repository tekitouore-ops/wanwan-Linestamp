import { blobToPngBlob } from '../shared/imageData';

/** 参照画像(data URL)のクリップボードコピー・保存で使う変換・コピー処理(追加修正指示書 第7弾 項目24)。 */

function isPngDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith('data:image/png');
}

async function defaultFetchDataUrlAsBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

export interface ToPngBlobOptions {
  /** data URLをBlobに変換する処理(テスト用に差し替え可能)。既定は`fetch`経由。 */
  fetchDataUrl?: (dataUrl: string) => Promise<Blob>;
  /** PNG以外の画像形式をPNGへ変換する処理(テスト用に差し替え可能)。既定はCanvas経由(`blobToPngBlob`)。 */
  convertToPng?: (blob: Blob) => Promise<Blob>;
}

/**
 * 参照画像のdata URLを、PNG形式のBlobに変換する。すでにPNGならそのまま(再エンコードしない)、
 * JPEG/WebP等はCanvasに描いてPNGへ変換する(元の解像度のまま、縮小しない)。
 */
export async function toPngBlob(dataUrl: string, options: ToPngBlobOptions = {}): Promise<Blob> {
  const fetchDataUrl = options.fetchDataUrl ?? defaultFetchDataUrlAsBlob;
  const convertToPng = options.convertToPng ?? blobToPngBlob;

  const blob = await fetchDataUrl(dataUrl);
  if (isPngDataUrl(dataUrl)) {
    return blob;
  }
  return convertToPng(blob);
}

/**
 * 画像のクリップボードコピーに対応しているか(`navigator.clipboard.write`・`ClipboardItem`の存在)。
 * `file://`で開いた場合や、対応していないブラウザではfalseになる。
 */
export function isClipboardImageSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  );
}

/** 画像(PNG Blob)をクリップボードへコピーする。例外は投げず、失敗時は`false`を返す。 */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  if (!isClipboardImageSupported()) {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
