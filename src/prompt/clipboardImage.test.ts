import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyImageToClipboard, isClipboardImageSupported, toPngBlob } from './clipboardImage';

describe('toPngBlob', () => {
  it('PNGのdata URLは、変換処理(convertToPng)を呼ばずそのまま返す', async () => {
    const pngBlob = new Blob(['png-bytes'], { type: 'image/png' });
    const fetchDataUrl = vi.fn().mockResolvedValue(pngBlob);
    const convertToPng = vi.fn().mockResolvedValue(new Blob(['should-not-be-used']));

    const result = await toPngBlob('data:image/png;base64,AAAA', { fetchDataUrl, convertToPng });

    expect(result).toBe(pngBlob);
    expect(convertToPng).not.toHaveBeenCalled();
  });

  it('JPEGのdata URLは、変換処理(convertToPng)を通してPNGへ変換される', async () => {
    const jpegBlob = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
    const pngBlob = new Blob(['converted-png'], { type: 'image/png' });
    const fetchDataUrl = vi.fn().mockResolvedValue(jpegBlob);
    const convertToPng = vi.fn().mockResolvedValue(pngBlob);

    const result = await toPngBlob('data:image/jpeg;base64,AAAA', { fetchDataUrl, convertToPng });

    expect(result).toBe(pngBlob);
    expect(convertToPng).toHaveBeenCalledWith(jpegBlob);
  });

  it('WebPのdata URLも、同様にPNGへ変換される', async () => {
    const webpBlob = new Blob(['webp-bytes'], { type: 'image/webp' });
    const pngBlob = new Blob(['converted-png'], { type: 'image/png' });
    const fetchDataUrl = vi.fn().mockResolvedValue(webpBlob);
    const convertToPng = vi.fn().mockResolvedValue(pngBlob);

    const result = await toPngBlob('data:image/webp;base64,AAAA', { fetchDataUrl, convertToPng });

    expect(result).toBe(pngBlob);
    expect(convertToPng).toHaveBeenCalledWith(webpBlob);
  });
});

describe('isClipboardImageSupported / copyImageToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('navigator.clipboard.writeとClipboardItemが両方そろっていればtrue', () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });
    vi.stubGlobal('ClipboardItem', class {});
    expect(isClipboardImageSupported()).toBe(true);
  });

  it('ClipboardItemが無ければfalse(file://等)', () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });
    vi.stubGlobal('ClipboardItem', undefined);
    expect(isClipboardImageSupported()).toBe(false);
  });

  it('navigator.clipboardが無ければfalse', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('ClipboardItem', class {});
    expect(isClipboardImageSupported()).toBe(false);
  });

  it('非対応環境では、copyImageToClipboardは例外を投げずfalseを返す', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('ClipboardItem', undefined);
    const result = await copyImageToClipboard(new Blob(['x'], { type: 'image/png' }));
    expect(result).toBe(false);
  });

  it('対応環境でwriteが成功すればtrueを返す', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public items: unknown) {}
      },
    );
    const blob = new Blob(['x'], { type: 'image/png' });
    const result = await copyImageToClipboard(blob);
    expect(result).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('対応環境でもwriteが例外を投げれば、例外を投げずfalseを返す', async () => {
    const write = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public items: unknown) {}
      },
    );
    const result = await copyImageToClipboard(new Blob(['x'], { type: 'image/png' }));
    expect(result).toBe(false);
  });
});
