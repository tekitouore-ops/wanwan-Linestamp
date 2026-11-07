// 書き出しZIPの検証ロジック(追加修正指示書 第7弾 項目25)。
// ZIP/ファイルIOには触れない純粋な関数群にし、CLI(verify-zip.mjs)とテストの両方から
// 同じロジックを呼べるようにする。`lineSpec`定数は呼び出し側から渡す(テストでは
// `scripts/lineSpec.generated.json`を介さず、直接オブジェクトを渡せるようにするため)。

import { createHash } from 'node:crypto';
import { canInspectPixels, decodePixels, extractAlphaChannel, hasAlphaChannel, parsePng } from './png.mjs';

/** 容量が上限に近いことを知らせる「注意」のしきい値(バイト)。指示書の「900KB超」。 */
const FILE_SIZE_CAUTION_BYTES = 900 * 1024;
/** 透明画素の割合がこれ未満だと「背景が残っている可能性」として注意する。 */
const MIN_TRANSPARENT_RATIO_PERCENT = 5;
/** 半透明(アルファ1〜30%)の画素が、全体に対してこの割合を超えると注意する。 */
const GHOST_RATIO_WARNING_PERCENT = 3;
/** 半透明(もや)とみなすアルファ範囲(%)。 */
const GHOST_ALPHA_MIN_PERCENT = 1;
const GHOST_ALPHA_MAX_PERCENT = 30;
/** 被写体と画像端との余白が、これ未満だと注意する(px)。 */
const MIN_MARGIN_PX = 4;

/** 1-indexedの番号から `01.png`〜`24.png` を作る(`src/shared/lineSpec.ts: stampFileName`と同じ形式)。 */
export function stampFileName(index) {
  return `${String(index).padStart(2, '0')}.png`;
}

/** 01.png〜24.png・main.png・tab.pngの、期待されるファイル名一覧。 */
export function expectedFileNames(constants) {
  const stampNames = Array.from({ length: constants.STAMP_COUNT }, (_, i) => stampFileName(i + 1));
  return [...stampNames, constants.MAIN_IMAGE_FILE_NAME, constants.TAB_IMAGE_FILE_NAME];
}

function issue(level, message) {
  return { level, message };
}

/** そのファイルの、規格上の想定サイズ(主スタンプは上限のみ、main/tabは完全一致)を求める。 */
function expectedDimensions(name, constants) {
  if (name === constants.MAIN_IMAGE_FILE_NAME) {
    return { kind: 'exact', width: constants.MAIN_IMAGE_SIZE.width, height: constants.MAIN_IMAGE_SIZE.height };
  }
  if (name === constants.TAB_IMAGE_FILE_NAME) {
    return { kind: 'exact', width: constants.TAB_IMAGE_SIZE.width, height: constants.TAB_IMAGE_SIZE.height };
  }
  if (/^\d{2}\.png$/.test(name)) {
    return { kind: 'max', width: constants.STAMP_MAX_WIDTH, height: constants.STAMP_MAX_HEIGHT };
  }
  return null;
}

/**
 * 1つのPNGファイルを検証する。`name`はZIP内のファイル名、`buffer`はそのファイルのバイト列。
 * 戻り値の`issues`は、このファイルに関する問題点(NG/注意/情報)の一覧。
 */
export function checkPngFile(name, buffer, constants) {
  const issues = [];
  const sizeBytes = buffer.length;

  if (sizeBytes > constants.STAMP_MAX_FILE_SIZE_BYTES) {
    const maxKb = Math.round(constants.STAMP_MAX_FILE_SIZE_BYTES / 1024);
    const actualKb = Math.round(sizeBytes / 1024);
    issues.push(issue('ng', `容量が上限(${maxKb}KB)を超えています(${actualKb}KB)。`));
  } else if (sizeBytes > FILE_SIZE_CAUTION_BYTES) {
    const actualKb = Math.round(sizeBytes / 1024);
    issues.push(issue('caution', `容量が900KBを超えています(${actualKb}KB)。上限に近づいています。`));
  }

  let parsed;
  try {
    parsed = parsePng(buffer);
  } catch (error) {
    issues.push(issue('ng', `PNGとして読み込めません(${error.message})。`));
    return { sizeBytes, issues };
  }

  const { width, height } = parsed.ihdr;
  const dims = expectedDimensions(name, constants);
  if (dims) {
    if (dims.kind === 'exact' && (width !== dims.width || height !== dims.height)) {
      issues.push(issue('ng', `サイズが${dims.width}×${dims.height}ではありません(${width}×${height})。`));
    } else if (dims.kind === 'max' && (width > dims.width || height > dims.height)) {
      issues.push(
        issue('ng', `サイズが規格の上限(${dims.width}×${dims.height})を超えています(${width}×${height})。`),
      );
    }
  }
  if (width % 2 !== 0 || height % 2 !== 0) {
    issues.push(issue('ng', `幅・高さが偶数ではありません(${width}×${height})。`));
  }

  if (!hasAlphaChannel(parsed)) {
    issues.push(issue('ng', 'アルファチャンネル(透過)を持っていません。'));
  }

  if (!canInspectPixels(parsed)) {
    issues.push(
      issue(
        'info',
        `ピクセル検査をスキップしました(ビット深度${parsed.ihdr.bitDepth}・カラータイプ${parsed.ihdr.colorType}・インターレース${parsed.ihdr.interlaceMethod}は非対応)。`,
      ),
    );
    return { sizeBytes, issues };
  }

  let alpha;
  try {
    const pixels = decodePixels(parsed);
    alpha = extractAlphaChannel(parsed, pixels);
  } catch (error) {
    issues.push(issue('ng', `画素データの展開に失敗しました(${error.message})。`));
    return { sizeBytes, issues };
  }

  const totalPixels = width * height;
  let transparentCount = 0;
  let ghostCount = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = alpha[y * width + x];
      if (a === 0) {
        transparentCount += 1;
      } else {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const percent = (a / 255) * 100;
        if (percent >= GHOST_ALPHA_MIN_PERCENT && percent <= GHOST_ALPHA_MAX_PERCENT) {
          ghostCount += 1;
        }
      }
    }
  }

  if (maxX < 0) {
    issues.push(issue('ng', '全画素が透明です(内容が空です)。'));
    return { sizeBytes, issues };
  }

  let borderOpaque = false;
  for (let x = 0; x < width; x += 1) {
    if (alpha[x] > 0 || alpha[(height - 1) * width + x] > 0) {
      borderOpaque = true;
      break;
    }
  }
  if (!borderOpaque) {
    for (let y = 0; y < height; y += 1) {
      if (alpha[y * width] > 0 || alpha[y * width + width - 1] > 0) {
        borderOpaque = true;
        break;
      }
    }
  }
  if (borderOpaque) {
    issues.push(issue('caution', '画像の最外周に不透明な画素があります(被写体が端に接している可能性)。'));
  }

  const transparentPercent = (transparentCount / totalPixels) * 100;
  if (transparentPercent < MIN_TRANSPARENT_RATIO_PERCENT) {
    issues.push(
      issue(
        'caution',
        `透明画素の割合が${MIN_TRANSPARENT_RATIO_PERCENT}%未満です(${transparentPercent.toFixed(1)}%、背景が残っている可能性)。`,
      ),
    );
  }

  const ghostPercent = (ghostCount / totalPixels) * 100;
  if (ghostPercent > GHOST_RATIO_WARNING_PERCENT) {
    issues.push(
      issue(
        'caution',
        `半透明のもや(アルファ${GHOST_ALPHA_MIN_PERCENT}〜${GHOST_ALPHA_MAX_PERCENT}%)が${ghostPercent.toFixed(1)}%あります(黒背景でもやに見える可能性)。`,
      ),
    );
  }

  const margins = {
    left: minX,
    top: minY,
    right: width - 1 - maxX,
    bottom: height - 1 - maxY,
  };
  const minMargin = Math.min(margins.left, margins.top, margins.right, margins.bottom);
  if (minMargin < MIN_MARGIN_PX) {
    issues.push(
      issue(
        'caution',
        `被写体と画像端の余白が${MIN_MARGIN_PX}px未満です(上${margins.top}px/右${margins.right}px/下${margins.bottom}px/左${margins.left}px)。`,
      ),
    );
  }

  return { sizeBytes, issues };
}

/**
 * ZIP内のファイル一覧(`{ファイル名: Buffer}`)を検証する。PNG以外のファイル(sources.txt等)は
 * 「情報」として一覧には載せるが、PNGとしての検査はしない。
 */
export function checkZipFiles(filesByName, constants) {
  const names = Object.keys(filesByName);
  const expected = expectedFileNames(constants);

  const structureIssues = [];
  expected.forEach((name) => {
    if (!(name in filesByName)) {
      structureIssues.push(issue('ng', `${name}: ファイルがありません。`));
    }
  });
  const extraNames = names.filter((name) => !expected.includes(name));
  extraNames.forEach((name) => {
    structureIssues.push(issue('info', `${name}: ファイル構成に含まれない、追加のファイルです。`));
  });

  const files = names.map((name) => {
    const buffer = filesByName[name];
    if (!name.toLowerCase().endsWith('.png')) {
      return { name, sizeBytes: buffer.length, issues: [] };
    }
    const { sizeBytes, issues } = checkPngFile(name, buffer, constants);
    return { name, sizeBytes, issues };
  });

  // 重複(同じ内容のPNG)検出: PNGファイルのハッシュが一致するものをグループ化する。
  const hashToNames = new Map();
  files.forEach(({ name }) => {
    if (!name.toLowerCase().endsWith('.png')) {
      return;
    }
    const hash = createHash('sha256').update(filesByName[name]).digest('hex');
    const list = hashToNames.get(hash) ?? [];
    list.push(name);
    hashToNames.set(hash, list);
  });
  const duplicateIssues = [];
  hashToNames.forEach((namesWithSameHash) => {
    if (namesWithSameHash.length < 2) {
      return;
    }
    namesWithSameHash.forEach((name) => {
      const others = namesWithSameHash.filter((n) => n !== name);
      const fileEntry = files.find((f) => f.name === name);
      fileEntry?.issues.push(
        issue('caution', `同じ内容の別ファイルがあります(${others.join(', ')})。`),
      );
      duplicateIssues.push(issue('caution', `${name}は${others.join(', ')}と同じ内容です。`));
    });
  });

  const totalSizeBytes = names.reduce((sum, name) => sum + filesByName[name].length, 0);

  const allIssues = [
    ...structureIssues,
    ...files.flatMap((f) => f.issues),
  ];
  const ngCount = allIssues.filter((i) => i.level === 'ng').length;
  const cautionCount = allIssues.filter((i) => i.level === 'caution').length;

  return { files, structureIssues, totalSizeBytes, ngCount, cautionCount };
}
