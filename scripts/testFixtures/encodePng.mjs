// テスト専用の最小PNGエンコーダ(追加修正指示書 第7弾 項目25)。
// 本番コード(scripts/png.mjs)はデコードのみを行うため、検証用のPNGを合成するための
// エンコーダはテストの範囲に閉じる。圧縮は`zlib.deflateSync`に任せる(手書きしない。
// `level: 0`でほぼ無圧縮〈ストアドブロック相当〉になる)。CRCは実際の値を計算せず0を書く
// (scripts/png.mjsはCRCを検証しないため、テスト用途ではこれで十分)。

import { deflateSync } from 'node:zlib';
import { paethPredictor } from '../png.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); // CRCは検証されないため0のまま
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function filterScanline(filterType, row, prevRow, bytesPerPixel) {
  const stride = row.length;
  const out = Buffer.alloc(stride + 1);
  out[0] = filterType;
  for (let x = 0; x < stride; x += 1) {
    const raw = row[x];
    const a = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
    const b = prevRow ? prevRow[x] : 0;
    const c = prevRow && x >= bytesPerPixel ? prevRow[x - bytesPerPixel] : 0;
    let value;
    switch (filterType) {
      case 0:
        value = raw;
        break;
      case 1:
        value = raw - a;
        break;
      case 2:
        value = raw - b;
        break;
      case 3:
        value = raw - Math.floor((a + b) / 2);
        break;
      case 4:
        value = raw - paethPredictor(a, b, c);
        break;
      default:
        throw new Error(`未対応のフィルタタイプです(${filterType})。`);
    }
    out[x + 1] = value & 0xff;
  }
  return out;
}

/**
 * RGBA画素データ(Uint8ClampedArray、長さ width*height*4)から、PNG(カラータイプ6、ビット深度8、
 * 非インターレース)のバイト列を作る。`filterType`(0〜4)はすべての行に同じものを適用する
 * (デコーダのフィルタ種別ごとのテストに使う)。
 */
export function encodeRgbaPng(width, height, rgba, filterType = 0) {
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const filtered = Buffer.alloc((stride + 1) * height);
  let prevRow = null;
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride);
    const filteredRow = filterScanline(filterType, row, prevRow, bytesPerPixel);
    filteredRow.copy(filtered, y * (stride + 1));
    prevRow = row;
  }
  const compressed = deflateSync(filtered, { level: 0 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  ihdr.writeUInt8(0, 10); // compression method
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // interlace method

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 単色+指定アルファで塗りつぶした、width×heightのRGBA PNGを作る(簡易フィクスチャ用)。 */
export function makeSolidPng(width, height, [r, g, b, a], filterType = 0) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    rgba[p * 4] = r;
    rgba[p * 4 + 1] = g;
    rgba[p * 4 + 2] = b;
    rgba[p * 4 + 3] = a;
  }
  return encodeRgbaPng(width, height, rgba, filterType);
}

/**
 * 「普通の」スタンプ画像を模したPNGを作る: 外周`marginPx`は完全透明、内側は不透明(アルファ255)。
 * 半透明のもや・外周の不透明画素なしの、検証でNG/注意が出ない基準フィクスチャとして使う。
 */
export function makeNormalStampPng(width, height, marginPx = 6, color = [200, 80, 80]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const inside = x >= marginPx && x < width - marginPx && y >= marginPx && y < height - marginPx;
      rgba[p * 4] = color[0];
      rgba[p * 4 + 1] = color[1];
      rgba[p * 4 + 2] = color[2];
      rgba[p * 4 + 3] = inside ? 255 : 0;
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

/** RGB(アルファチャンネルなし、カラータイプ2)のPNGを作る(「透過を持たない」NGケース用)。 */
export function makeOpaqueRgbPng(width, height, [r, g, b] = [100, 150, 200]) {
  const bytesPerPixel = 3;
  const stride = width * bytesPerPixel;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    filtered[y * (stride + 1)] = 0; // filter type: None
    for (let x = 0; x < width; x += 1) {
      const base = y * (stride + 1) + 1 + x * bytesPerPixel;
      filtered[base] = r;
      filtered[base + 1] = g;
      filtered[base + 2] = b;
    }
  }
  const compressed = deflateSync(filtered, { level: 0 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9); // color type: RGB
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}
