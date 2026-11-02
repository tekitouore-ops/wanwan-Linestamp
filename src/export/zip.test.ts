import { describe, expect, it } from 'vitest';
import { buildFullZipFromBlobs, buildStampZipFromBlobs, formatZipFileName } from './zip';

describe('buildStampZipFromBlobs', () => {
  it('01.png〜03.pngという名前でZIPに格納する', async () => {
    const blobs = [
      new Blob(['a'], { type: 'image/png' }),
      new Blob(['b'], { type: 'image/png' }),
      new Blob(['c'], { type: 'image/png' }),
    ];
    const zipBlob = await buildStampZipFromBlobs(blobs);
    expect(zipBlob.size).toBeGreaterThan(0);

    // ZIPとして読み直せることを確認する(JSZipで再読込)
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['01.png', '02.png', '03.png']);
  });
});

describe('buildFullZipFromBlobs', () => {
  it('01.png〜03.pngに加えて、main.png・tab.pngも含める', async () => {
    const stampBlobs = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    const zipBlob = await buildFullZipFromBlobs(stampBlobs, {
      'main.png': new Blob(['main']),
      'tab.png': new Blob(['tab']),
    });

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual([
      '01.png',
      '02.png',
      '03.png',
      'main.png',
      'tab.png',
    ]);
  });
});

describe('formatZipFileName', () => {
  it('stamps_YYYYMMDD_HHMM.zip の形式になる', () => {
    const name = formatZipFileName(new Date(2026, 0, 5, 9, 7));
    expect(name).toBe('stamps_20260105_0907.zip');
  });
});
