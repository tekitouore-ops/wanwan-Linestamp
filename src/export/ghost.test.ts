import { describe, expect, it } from 'vitest';
import { removeGhost } from './ghost';
import { createSolidImage, fillRect } from '../split/testUtils';

const GHOST_ALPHA_10PCT = Math.round(0.1 * 255); // 26
const GHOST_ALPHA_30PCT = Math.round(0.3 * 255); // 77
const ALPHA_MAX_40PCT = Math.round(0.4 * 255); // 102

function alphaAt(image: ReturnType<typeof createSolidImage>, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

function pixelAt(
  image: ReturnType<typeof createSolidImage>,
  x: number,
  y: number,
): [number, number, number, number] {
  const i = (y * image.width + x) * 4;
  return [
    image.data[i] ?? 0,
    image.data[i + 1] ?? 0,
    image.data[i + 2] ?? 0,
    image.data[i + 3] ?? 0,
  ];
}

describe('removeGhost(半透明のもやを色によらず除去、追加修正指示書 第5弾 項目18)', () => {
  it('しきい値(alphaMax)が0のときは、何も変わらない(入力と出力が一致する)', () => {
    const image = createSolidImage(10, 10, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(
      image,
      { x: 3, y: 3, width: 4, height: 4 },
      { r: 255, g: 255, b: 255, a: GHOST_ALPHA_10PCT },
    );
    const result = removeGhost(image, { alphaMax: 0 });
    expect(result).toEqual(image);
  });

  it('外側の半透明の白のリング(alpha10〜30%)が除去される', () => {
    const image = createSolidImage(40, 40, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(image, { x: 15, y: 15, width: 10, height: 10 }, { r: 200, g: 100, b: 50, a: 255 }); // 被写体
    fillRect(
      image,
      { x: 10, y: 10, width: 20, height: 2 },
      { r: 255, g: 255, b: 255, a: GHOST_ALPHA_30PCT },
    );

    const result = removeGhost(image, { alphaMax: ALPHA_MAX_40PCT, protectEdgePx: 1 });

    expect(alphaAt(result, 15, 10)).toBe(0);
    expect(alphaAt(result, 20, 20)).toBe(255); // 被写体自体は変更されない
  });

  it('色を問わない: 外側の半透明の灰色・暗い色のもやも除去される', () => {
    const image = createSolidImage(40, 40, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(image, { x: 15, y: 15, width: 10, height: 10 }, { r: 200, g: 100, b: 50, a: 255 }); // 被写体
    // 灰色のもや
    fillRect(
      image,
      { x: 10, y: 10, width: 4, height: 2 },
      { r: 120, g: 120, b: 120, a: GHOST_ALPHA_10PCT },
    );
    // 暗い色(黒に近い)のもや
    fillRect(
      image,
      { x: 26, y: 10, width: 4, height: 2 },
      { r: 20, g: 15, b: 10, a: GHOST_ALPHA_30PCT },
    );

    const result = removeGhost(image, { alphaMax: ALPHA_MAX_40PCT, protectEdgePx: 1 });

    expect(alphaAt(result, 11, 10)).toBe(0);
    expect(alphaAt(result, 27, 10)).toBe(0);
  });

  it('不透明な白フチ(alpha100%、キャラ・文字の周り)は一切変化しない', () => {
    const image = createSolidImage(20, 20, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(image, { x: 8, y: 8, width: 4, height: 4 }, { r: 200, g: 100, b: 50, a: 255 }); // 被写体
    fillRect(image, { x: 6, y: 6, width: 8, height: 1 }, { r: 255, g: 255, b: 255, a: 255 }); // 不透明な白フチ

    const result = removeGhost(image, { alphaMax: ALPHA_MAX_40PCT, protectEdgePx: 1 });

    expect(pixelAt(result, 9, 6)).toEqual(pixelAt(image, 9, 6));
  });

  it('文字の白フチ(不透明)は、キャラから離れていて連結していなくても残る', () => {
    const image = createSolidImage(40, 20, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(image, { x: 2, y: 8, width: 4, height: 4 }, { r: 200, g: 100, b: 50, a: 255 }); // キャラ
    // キャラから十分離れた、独立した不透明の白(文字の白フチを想定)。
    fillRect(image, { x: 30, y: 8, width: 4, height: 4 }, { r: 255, g: 255, b: 255, a: 255 });
    // その文字フチのすぐ外側にある半透明のもや(除去されるべき)。
    fillRect(
      image,
      { x: 28, y: 8, width: 2, height: 4 },
      { r: 255, g: 255, b: 255, a: GHOST_ALPHA_30PCT },
    );

    const result = removeGhost(image, { alphaMax: ALPHA_MAX_40PCT, protectEdgePx: 1 });

    expect(pixelAt(result, 31, 9)).toEqual([255, 255, 255, 255]); // 文字フチ自体は無傷
    expect(alphaAt(result, 28, 9)).toBe(0); // 隣接するもやは除去される
  });

  it('被写体の内部(不透明な領域に完全に囲まれた)半透明の画素は残る', () => {
    const image = createSolidImage(20, 20, { r: 100, g: 100, b: 100, a: 255 });
    fillRect(
      image,
      { x: 6, y: 6, width: 8, height: 8 },
      { r: 90, g: 80, b: 70, a: GHOST_ALPHA_10PCT },
    );

    const result = removeGhost(image, { alphaMax: ALPHA_MAX_40PCT, protectEdgePx: 1 });

    expect(alphaAt(result, 9, 9)).toBe(GHOST_ALPHA_10PCT);
  });

  it('被写体のエッジのアンチエイリアス(前景から1px以内)は、protectEdgePxで保護される', () => {
    const image = createSolidImage(20, 10, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(image, { x: 5, y: 2, width: 5, height: 6 }, { r: 200, g: 100, b: 50, a: 255 }); // 被写体
    fillRect(
      image,
      { x: 4, y: 2, width: 1, height: 6 },
      { r: 255, g: 255, b: 255, a: GHOST_ALPHA_10PCT },
    );
    fillRect(
      image,
      { x: 10, y: 2, width: 1, height: 6 },
      { r: 255, g: 255, b: 255, a: GHOST_ALPHA_10PCT },
    );

    const protectedResult = removeGhost(image, { alphaMax: ALPHA_MAX_40PCT, protectEdgePx: 1 });
    expect(alphaAt(protectedResult, 4, 5)).toBe(GHOST_ALPHA_10PCT);
    expect(alphaAt(protectedResult, 10, 5)).toBe(GHOST_ALPHA_10PCT);

    const unprotectedResult = removeGhost(image, { alphaMax: ALPHA_MAX_40PCT, protectEdgePx: 0 });
    expect(alphaAt(unprotectedResult, 4, 5)).toBe(0);
    expect(alphaAt(unprotectedResult, 10, 5)).toBe(0);
  });

  it('solidAlphaMin未満(半透明)の画素は、アルファがalphaMaxを超えていても前景として扱わない(通過はできるが除去対象にもならない)', () => {
    const image = createSolidImage(20, 10, { r: 0, g: 0, b: 0, a: 0 });
    // alphaMax(40%)とsolidAlphaMin(既定200, 約78%)の中間のアルファ(60%)の画素。
    const midAlpha = Math.round(0.6 * 255);
    fillRect(image, { x: 8, y: 4, width: 4, height: 2 }, { r: 150, g: 150, b: 150, a: midAlpha });

    const result = removeGhost(image, { alphaMax: ALPHA_MAX_40PCT, protectEdgePx: 0 });

    // alphaMaxを超えるため除去対象にはならないが、「確かな前景」でもないので不変のまま残る。
    expect(alphaAt(result, 9, 5)).toBe(midAlpha);
  });
});
