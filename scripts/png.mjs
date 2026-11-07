// PNGの最小限のデコーダ(追加修正指示書 第7弾 項目25)。
// 依存はNode標準の `node:zlib` のみ(ライブラリを追加しない)。
// 非インターレース・ビット深度8のカラータイプ0/2/3/4/6を対象とする。
// ピクセル(アルファチャンネル)の取り出しは、カラータイプ4(グレー+アルファ)・6(RGBA)のみ対応し、
// それ以外は「対象外」として呼び出し側でスキップできるようにする(失敗扱いにしない)。
// CRC32の検証は行わない(このツールは「読めるかどうか」の検査が目的で、改ざん検知は目的外のため)。

import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class PngFormatError extends Error {}

/** PNGのバイト列から、先頭のPNGシグネチャを除いた一連のチャンク({type, data})を取り出す。 */
export function parseChunks(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new PngFormatError('PNGシグネチャが見つかりません。');
  }
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      throw new PngFormatError(`チャンク「${type}」のデータがファイル末尾を超えています。`);
    }
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4; // CRCの4バイトは検証せず読み飛ばす
    if (type === 'IEND') {
      break;
    }
  }
  return chunks;
}

function parseIHDR(data) {
  if (data.length < 13) {
    throw new PngFormatError('IHDRチャンクの長さが不正です。');
  }
  return {
    width: data.readUInt32BE(0),
    height: data.readUInt32BE(4),
    bitDepth: data.readUInt8(8),
    colorType: data.readUInt8(9),
    compressionMethod: data.readUInt8(10),
    filterMethod: data.readUInt8(11),
    interlaceMethod: data.readUInt8(12),
  };
}

/** カラータイプ・ビット深度8における、1画素あたりのバイト数。 */
function bytesPerPixelFor(colorType) {
  switch (colorType) {
    case 0:
      return 1; // グレースケール
    case 2:
      return 3; // RGB
    case 3:
      return 1; // パレット(インデックス)
    case 4:
      return 2; // グレースケール+アルファ
    case 6:
      return 4; // RGBA
    default:
      return null;
  }
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * フィルタ解除後の生スキャンライン列(各行にフィルタタイプ1バイトが先頭に付く形式)を、
 * 画素データ(フィルタ解除済み、連続バイト列)へ変換する。None/Sub/Up/Average/Paethに対応する。
 */
export function unfilterScanlines(filtered, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const expectedLength = (stride + 1) * height;
  if (filtered.length < expectedLength) {
    throw new PngFormatError(
      `展開後のデータ長が不足しています(期待: ${expectedLength}バイト、実際: ${filtered.length}バイト)。`,
    );
  }
  const out = Buffer.alloc(stride * height);
  let srcPos = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = filtered[srcPos];
    srcPos += 1;
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = filtered[srcPos + x];
      const a = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
      const b = y > 0 ? out[prevRowStart + x] : 0;
      const c = y > 0 && x >= bytesPerPixel ? out[prevRowStart + x - bytesPerPixel] : 0;
      let value;
      switch (filterType) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + a;
          break;
        case 2:
          value = rawByte + b;
          break;
        case 3:
          value = rawByte + Math.floor((a + b) / 2);
          break;
        case 4:
          value = rawByte + paethPredictor(a, b, c);
          break;
        default:
          throw new PngFormatError(`未対応のフィルタタイプです(${filterType})。`);
      }
      out[rowStart + x] = value & 0xff;
    }
    srcPos += stride;
  }
  return out;
}

/**
 * PNGファイルのバイト列を解析する。IHDR・IDAT(結合して展開)・tRNSの有無を返す。
 * ピクセル(フィルタ解除済み画素データ)は、`decodePixels`を呼ぶまで計算しない(コストが高いため)。
 */
export function parsePng(buffer) {
  const chunks = parseChunks(buffer);
  const ihdrChunk = chunks.find((c) => c.type === 'IHDR');
  if (!ihdrChunk) {
    throw new PngFormatError('IHDRチャンクが見つかりません。');
  }
  const ihdr = parseIHDR(ihdrChunk.data);
  const idatChunks = chunks.filter((c) => c.type === 'IDAT');
  if (idatChunks.length === 0) {
    throw new PngFormatError('IDATチャンクが見つかりません。');
  }
  const hasTrns = chunks.some((c) => c.type === 'tRNS');
  const idatBuffer = Buffer.concat(idatChunks.map((c) => c.data));
  return { ihdr, idatBuffer, hasTrns, chunks };
}

/** アルファチャンネルを持つか(カラータイプ4・6、またはtRNSチャンクがある)。 */
export function hasAlphaChannel(parsed) {
  return parsed.ihdr.colorType === 4 || parsed.ihdr.colorType === 6 || parsed.hasTrns;
}

/** このデコーダがピクセル(アルファ値)を取り出せる形式か(非インターレース・ビット深度8・カラータイプ4/6)。 */
export function canInspectPixels(parsed) {
  return (
    parsed.ihdr.bitDepth === 8 &&
    parsed.ihdr.interlaceMethod === 0 &&
    (parsed.ihdr.colorType === 4 || parsed.ihdr.colorType === 6)
  );
}

/**
 * 画素データ(フィルタ解除済み)を展開する。`canInspectPixels`がfalseの形式では例外を投げる
 * (呼び出し側は事前に`canInspectPixels`で確認し、falseならスキップすること)。
 */
export function decodePixels(parsed) {
  const { width, height, colorType } = parsed.ihdr;
  const bytesPerPixel = bytesPerPixelFor(colorType);
  if (!bytesPerPixel) {
    throw new PngFormatError(`未対応のカラータイプです(${colorType})。`);
  }
  const inflated = inflateSync(parsed.idatBuffer);
  return unfilterScanlines(inflated, width, height, bytesPerPixel);
}

/**
 * フィルタ解除済みの画素データから、1画素あたり1バイトのアルファ配列(長さ width*height)を取り出す。
 * カラータイプ4(グレー+アルファ、2バイト/画素、2バイト目がアルファ)・
 * 6(RGBA、4バイト/画素、4バイト目がアルファ)のみ対応。
 */
export function extractAlphaChannel(parsed, pixels) {
  const { width, height, colorType } = parsed.ihdr;
  const alpha = new Uint8ClampedArray(width * height);
  if (colorType === 6) {
    for (let p = 0; p < width * height; p += 1) {
      alpha[p] = pixels[p * 4 + 3];
    }
  } else if (colorType === 4) {
    for (let p = 0; p < width * height; p += 1) {
      alpha[p] = pixels[p * 2 + 1];
    }
  } else {
    throw new PngFormatError(`アルファ抽出に未対応のカラータイプです(${colorType})。`);
  }
  return alpha;
}

export { paethPredictor };
