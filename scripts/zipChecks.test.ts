import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { checkPngFile, checkZipFiles, expectedFileNames, stampFileName } from './zipChecks.mjs';
import { loadZipBuffer } from './verify-zip.mjs';
import { encodeRgbaPng, makeNormalStampPng, makeOpaqueRgbPng, makeSolidPng } from './testFixtures/encodePng.mjs';

const CONSTANTS = {
  STAMP_COUNT: 24,
  STAMP_MAX_WIDTH: 370,
  STAMP_MAX_HEIGHT: 320,
  STAMP_MAX_FILE_SIZE_BYTES: 1024 * 1024,
  MAIN_IMAGE_SIZE: { width: 240, height: 240 },
  MAIN_IMAGE_FILE_NAME: 'main.png',
  TAB_IMAGE_SIZE: { width: 96, height: 74 },
  TAB_IMAGE_FILE_NAME: 'tab.png',
};

function ngMessages(issues: { level: string; message: string }[]): string[] {
  return issues.filter((i) => i.level === 'ng').map((i) => i.message);
}
function cautionMessages(issues: { level: string; message: string }[]): string[] {
  return issues.filter((i) => i.level === 'caution').map((i) => i.message);
}

describe('stampFileName / expectedFileNames', () => {
  it('1桁・2桁の番号から、ゼロ埋めされた2桁のファイル名を作る', () => {
    expect(stampFileName(1)).toBe('01.png');
    expect(stampFileName(24)).toBe('24.png');
  });

  it('24枚+main.png+tab.pngの、計26個のファイル名を返す', () => {
    const names = expectedFileNames(CONSTANTS);
    expect(names).toHaveLength(26);
    expect(names[0]).toBe('01.png');
    expect(names[23]).toBe('24.png');
    expect(names).toContain('main.png');
    expect(names).toContain('tab.png');
  });
});

describe('checkPngFile: 単体ファイルの検査', () => {
  it('基準を満たす画像はNG・注意なし', () => {
    const buffer = makeNormalStampPng(60, 60, 6);
    const { issues } = checkPngFile('01.png', buffer, CONSTANTS);
    expect(ngMessages(issues)).toEqual([]);
    expect(cautionMessages(issues)).toEqual([]);
  });

  it('371×320(幅が上限370を超える)はNG', () => {
    const buffer = makeNormalStampPng(372, 320, 6);
    const { issues } = checkPngFile('01.png', buffer, CONSTANTS);
    expect(ngMessages(issues).some((m) => m.includes('上限'))).toBe(true);
  });

  it('奇数サイズ(幅が奇数)はNG', () => {
    const buffer = makeNormalStampPng(61, 60, 6);
    const { issues } = checkPngFile('01.png', buffer, CONSTANTS);
    expect(ngMessages(issues).some((m) => m.includes('偶数'))).toBe(true);
  });

  it('main.pngが240×240でない場合はNG', () => {
    const buffer = makeNormalStampPng(200, 200, 6);
    const { issues } = checkPngFile('main.png', buffer, CONSTANTS);
    expect(ngMessages(issues).some((m) => m.includes('240×240ではありません'))).toBe(true);
  });

  it('tab.pngが96×74でない場合はNG', () => {
    const buffer = makeNormalStampPng(100, 74, 6);
    const { issues } = checkPngFile('tab.png', buffer, CONSTANTS);
    expect(ngMessages(issues).some((m) => m.includes('96×74ではありません'))).toBe(true);
  });

  it('1MBを超えるファイルはNG(大きなノイズ画像)', () => {
    // 370×320上限に収めると最大でも約474KBにしかならないため(非圧縮IDAT)、
    // 1MB超を再現するには規格上限より大きい画像にする(同時に寸法NGも出るが、ここでは容量NGだけを確認する)。
    const width = 800;
    const height = 700;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < rgba.length; p += 1) {
      rgba[p] = Math.floor(Math.random() * 256);
    }
    const buffer = encodeRgbaPng(width, height, rgba, 0);
    expect(buffer.length).toBeGreaterThan(CONSTANTS.STAMP_MAX_FILE_SIZE_BYTES);
    const { issues } = checkPngFile('05.png', buffer, CONSTANTS);
    expect(ngMessages(issues).some((m) => m.includes('容量が上限'))).toBe(true);
  });

  it('900KB超1MB以下は「注意」(上限に近い)', () => {
    const width = 500;
    const height = 480;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < rgba.length; p += 1) {
      rgba[p] = Math.floor(Math.random() * 256);
    }
    const buffer = encodeRgbaPng(width, height, rgba, 0);
    expect(buffer.length).toBeGreaterThan(900 * 1024);
    expect(buffer.length).toBeLessThanOrEqual(CONSTANTS.STAMP_MAX_FILE_SIZE_BYTES);
    const { issues } = checkPngFile('06.png', buffer, CONSTANTS);
    expect(cautionMessages(issues).some((m) => m.includes('900KB'))).toBe(true);
    expect(ngMessages(issues).some((m) => m.includes('容量'))).toBe(false);
  });

  it('全画素が透明(完全に空)はNG', () => {
    const buffer = makeSolidPng(40, 40, [0, 0, 0, 0]);
    const { issues } = checkPngFile('01.png', buffer, CONSTANTS);
    expect(ngMessages(issues).some((m) => m.includes('全画素が透明'))).toBe(true);
  });

  it('アルファチャンネルを持たない(RGB)PNGはNG、ピクセル検査は情報としてスキップされる', () => {
    const buffer = makeOpaqueRgbPng(40, 40);
    const { issues } = checkPngFile('01.png', buffer, CONSTANTS);
    expect(ngMessages(issues).some((m) => m.includes('アルファチャンネル'))).toBe(true);
    expect(issues.some((i) => i.level === 'info' && i.message.includes('スキップ'))).toBe(true);
    // スキップ時は、透明割合・もや等の注意は出ない(評価できないため)。
    expect(cautionMessages(issues)).toEqual([]);
  });

  it('外周(最外周1px)に不透明な画素があると「注意」', () => {
    // marginPxを0にして、画像全体を不透明にする(外周も含む)。
    const buffer = makeNormalStampPng(40, 40, 0);
    const { issues } = checkPngFile('01.png', buffer, CONSTANTS);
    expect(cautionMessages(issues).some((m) => m.includes('外周'))).toBe(true);
  });

  it('透明画素の割合が5%未満だと「注意」', () => {
    // 画像を大きくしつつ、marginPxを1pxに留めることで、透明領域の割合を5%未満にする
    // (100×100・margin1pxなら、透明割合は約3.96%)。
    const buffer = makeNormalStampPng(100, 100, 1);
    const { issues } = checkPngFile('01.png', buffer, CONSTANTS);
    expect(cautionMessages(issues).some((m) => m.includes('透明画素の割合'))).toBe(true);
  });

  it('被写体と画像端の余白が4px未満だと「注意」', () => {
    const buffer = makeNormalStampPng(60, 60, 2);
    const { issues } = checkPngFile('01.png', buffer, CONSTANTS);
    expect(cautionMessages(issues).some((m) => m.includes('余白'))).toBe(true);
  });

  it('半透明(アルファ1〜30%)の画素が3%を超えると「注意」(もや)', () => {
    const width = 50;
    const height = 50;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        const inside = x >= 6 && x < width - 6 && y >= 6 && y < height - 6;
        rgba[p * 4] = 150;
        rgba[p * 4 + 1] = 80;
        rgba[p * 4 + 2] = 80;
        if (inside) {
          rgba[p * 4 + 3] = 255;
        } else {
          // 外周一帯を、半透明(アルファ約20%)の「もや」にする。
          rgba[p * 4 + 3] = Math.round(255 * 0.2);
        }
      }
    }
    const buffer = encodeRgbaPng(width, height, rgba, 0);
    const { issues } = checkPngFile('01.png', buffer, CONSTANTS);
    expect(cautionMessages(issues).some((m) => m.includes('もや'))).toBe(true);
  });
});

describe('checkZipFiles: ファイル構成・ZIP全体の検査', () => {
  function buildNormalFilesMap(): Record<string, Buffer> {
    const filesByName: Record<string, Buffer> = {};
    for (let i = 1; i <= 24; i += 1) {
      const name = stampFileName(i);
      // 色を番号ごとに変えて、重複検出(ハッシュ一致)が誤検出されないようにする。
      filesByName[name] = makeNormalStampPng(60, 60, 6, [(i * 7) % 256, (i * 13) % 256, (i * 29) % 256]);
    }
    filesByName['main.png'] = makeNormalStampPng(240, 240, 10);
    filesByName['tab.png'] = makeNormalStampPng(96, 74, 6);
    return filesByName;
  }

  it('24枚+main+tabがそろった正常なZIPは、NG 0件になる', () => {
    const report = checkZipFiles(buildNormalFilesMap(), CONSTANTS);
    expect(report.ngCount).toBe(0);
    expect(report.structureIssues).toEqual([]);
  });

  it('ファイルが不足していると、構成チェックでNGになる', () => {
    const filesByName = buildNormalFilesMap();
    delete filesByName['05.png'];
    const report = checkZipFiles(filesByName, CONSTANTS);
    expect(report.ngCount).toBeGreaterThan(0);
    expect(report.structureIssues.some((i) => i.level === 'ng' && i.message.includes('05.png'))).toBe(
      true,
    );
  });

  it('余分なファイルは「情報」として扱い、NGにはしない', () => {
    const filesByName = buildNormalFilesMap();
    filesByName['sources.txt'] = Buffer.from('dummy');
    const report = checkZipFiles(filesByName, CONSTANTS);
    expect(report.ngCount).toBe(0);
    expect(
      report.structureIssues.some((i) => i.level === 'info' && i.message.includes('sources.txt')),
    ).toBe(true);
  });

  it('同じ内容の重複PNGがあると「注意」になる', () => {
    const filesByName = buildNormalFilesMap();
    filesByName['02.png'] = filesByName['01.png'];
    const report = checkZipFiles(filesByName, CONSTANTS);
    expect(report.cautionCount).toBeGreaterThan(0);
    const file01 = report.files.find((f) => f.name === '01.png');
    expect(file01?.issues.some((i) => i.message.includes('同じ内容'))).toBe(true);
  });

  it('合計サイズを計算して返す', () => {
    const filesByName = buildNormalFilesMap();
    const report = checkZipFiles(filesByName, CONSTANTS);
    const expectedTotal = Object.values(filesByName).reduce((sum, b) => sum + b.length, 0);
    expect(report.totalSizeBytes).toBe(expectedTotal);
  });
});

describe('ZIP全体の結合テスト(jszipで実際にZIPを組み立てて検証する)', () => {
  it('実際のZIPバイト列から読み込んでも、正常なセットはNG 0件になる', async () => {
    const zip = new JSZip();
    for (let i = 1; i <= 24; i += 1) {
      zip.file(stampFileName(i), makeNormalStampPng(60, 60, 6, [(i * 7) % 256, (i * 13) % 256, (i * 29) % 256]));
    }
    zip.file('main.png', makeNormalStampPng(240, 240, 10));
    zip.file('tab.png', makeNormalStampPng(96, 74, 6));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const filesByName = await loadZipBuffer(buffer);
    const report = checkZipFiles(filesByName, CONSTANTS);
    expect(report.ngCount).toBe(0);
  });
});
