import { describe, expect, it } from 'vitest';
import { removeGhost } from './ghost';
import { createSolidImage, fillRect } from '../split/testUtils';

const GHOST_ALPHA_10PCT = Math.round(0.1 * 255); // 26
const ALPHA_MAX_20PCT = Math.round(0.2 * 255); // 51

function alphaAt(image: ReturnType<typeof createSolidImage>, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

describe('removeGhost(半透明の白のゴースト除去、追加修正指示書 第3弾 項目15)', () => {
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

  it('被写体の外側にある、半透明の白(alpha約10%)のリングが除去される', () => {
    const image = createSolidImage(40, 40, { r: 0, g: 0, b: 0, a: 0 });
    // 被写体(確かな前景): 中央の不透明な矩形(白ではない色)。
    fillRect(image, { x: 15, y: 15, width: 10, height: 10 }, { r: 200, g: 100, b: 50, a: 255 });
    // 被写体から離れた位置(前景からprotectEdgePxより遠い)に、半透明の白いリングを置く。
    fillRect(
      image,
      { x: 10, y: 10, width: 20, height: 2 },
      { r: 255, g: 255, b: 255, a: GHOST_ALPHA_10PCT },
    );

    const result = removeGhost(image, { alphaMax: ALPHA_MAX_20PCT, protectEdgePx: 1 });

    expect(alphaAt(result, 15, 10)).toBe(0);
    // 被写体自体は変更されない。
    expect(alphaAt(result, 20, 20)).toBe(255);
  });

  it('被写体の内部(不透明な領域に完全に囲まれた)半透明の白の領域は残る', () => {
    // キャンバス全体を不透明な前景(外周まで塗りつぶす)にし、外周からのBFSが届かないようにする。
    const image = createSolidImage(20, 20, { r: 100, g: 100, b: 100, a: 255 });
    fillRect(
      image,
      { x: 6, y: 6, width: 8, height: 8 },
      { r: 255, g: 255, b: 255, a: GHOST_ALPHA_10PCT },
    );

    const result = removeGhost(image, { alphaMax: ALPHA_MAX_20PCT, protectEdgePx: 1 });

    expect(alphaAt(result, 9, 9)).toBe(GHOST_ALPHA_10PCT);
  });

  it('不透明な白フチ(alpha 100%)は残る', () => {
    const image = createSolidImage(20, 20, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(image, { x: 8, y: 8, width: 4, height: 4 }, { r: 200, g: 100, b: 50, a: 255 }); // 被写体
    fillRect(image, { x: 6, y: 6, width: 8, height: 1 }, { r: 255, g: 255, b: 255, a: 255 }); // 不透明な白フチ(上辺)

    const result = removeGhost(image, { alphaMax: ALPHA_MAX_20PCT, protectEdgePx: 1 });

    expect(alphaAt(result, 9, 6)).toBe(255);
  });

  it('被写体のエッジのアンチエイリアス(前景から1px以内)は、protectEdgePxで保護される', () => {
    const image = createSolidImage(20, 10, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(image, { x: 5, y: 2, width: 5, height: 6 }, { r: 200, g: 100, b: 50, a: 255 }); // 被写体
    // 被写体の左右1pxに、半透明の白のアンチエイリアス縁を置く(x=4とx=10)。
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

    const protectedResult = removeGhost(image, { alphaMax: ALPHA_MAX_20PCT, protectEdgePx: 1 });
    expect(alphaAt(protectedResult, 4, 5)).toBe(GHOST_ALPHA_10PCT);
    expect(alphaAt(protectedResult, 10, 5)).toBe(GHOST_ALPHA_10PCT);

    // protectEdgePx: 0なら、同じ画素でも(外周と連結しているため)除去される。
    const unprotectedResult = removeGhost(image, { alphaMax: ALPHA_MAX_20PCT, protectEdgePx: 0 });
    expect(alphaAt(unprotectedResult, 4, 5)).toBe(0);
    expect(alphaAt(unprotectedResult, 10, 5)).toBe(0);
  });

  it('色が白に近くない半透明画素(例: 半透明の茶色の影)は除去されない', () => {
    const image = createSolidImage(20, 20, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(image, { x: 8, y: 8, width: 4, height: 4 }, { r: 200, g: 100, b: 50, a: 255 }); // 被写体
    fillRect(
      image,
      { x: 2, y: 2, width: 4, height: 4 },
      { r: 120, g: 80, b: 40, a: GHOST_ALPHA_10PCT },
    ); // 半透明の茶色の影

    const result = removeGhost(image, { alphaMax: ALPHA_MAX_20PCT, protectEdgePx: 1 });

    expect(alphaAt(result, 3, 3)).toBe(GHOST_ALPHA_10PCT);
  });

  it('背景色モードでは、白ではないが推定した背景色に近い半透明画素も除去対象になる', () => {
    // 白判定(whiteMin=200)には掛からない、くすんだベージュ系の背景色を使う。
    const backgroundColor = { r: 180, g: 150, b: 120 };
    const image = createSolidImage(20, 20, { r: 0, g: 0, b: 0, a: 0 });
    fillRect(image, { x: 8, y: 8, width: 4, height: 4 }, { r: 10, g: 20, b: 30, a: 255 }); // 被写体(背景色と無関係)
    fillRect(
      image,
      { x: 2, y: 2, width: 4, height: 4 },
      { r: 185, g: 145, b: 115, a: GHOST_ALPHA_10PCT }, // 背景色に近い(差は5以内)が白ではない
    );

    const withoutBackgroundColor = removeGhost(image, {
      alphaMax: ALPHA_MAX_20PCT,
      protectEdgePx: 1,
    });
    expect(alphaAt(withoutBackgroundColor, 3, 3)).toBe(GHOST_ALPHA_10PCT); // 白判定だけでは対象外

    const withBackgroundColor = removeGhost(image, {
      alphaMax: ALPHA_MAX_20PCT,
      protectEdgePx: 1,
      backgroundColor,
    });
    expect(alphaAt(withBackgroundColor, 3, 3)).toBe(0);
  });
});
