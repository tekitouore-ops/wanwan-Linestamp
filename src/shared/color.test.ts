import { describe, expect, it } from 'vitest';
import { DARK_TEXT_COLORS, LIGHT_TEXT_COLORS, pickTextColor, relativeLuminance } from './color';

describe('pickTextColor(確認用背景の明るさに応じた文字色の選択、追加修正指示書 項目14)', () => {
  it('黒背景には明るい文字を選ぶ', () => {
    expect(pickTextColor('#000000')).toEqual(LIGHT_TEXT_COLORS);
  });

  it('白背景には暗い文字を選ぶ', () => {
    expect(pickTextColor('#ffffff')).toEqual(DARK_TEXT_COLORS);
  });

  it('青(プリセットの青)には明るい文字を選ぶ', () => {
    expect(pickTextColor('#3b82f6')).toEqual(LIGHT_TEXT_COLORS);
  });

  it('黄(プリセットの黄)には明るい文字を選ぶ(輝度が0.5をわずかに下回るため)', () => {
    expect(relativeLuminance('#eab308')).toBeLessThan(0.5);
    expect(pickTextColor('#eab308')).toEqual(LIGHT_TEXT_COLORS);
  });

  it('明るいグレーには暗い文字を選ぶ', () => {
    expect(pickTextColor('#cccccc')).toEqual(DARK_TEXT_COLORS);
  });

  it('先頭に#がなくても、大文字でも扱える', () => {
    expect(pickTextColor('000000')).toEqual(LIGHT_TEXT_COLORS);
    expect(pickTextColor('#FFFFFF')).toEqual(DARK_TEXT_COLORS);
  });
});

describe('relativeLuminance', () => {
  it('黒は0、白は1になる', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1);
  });

  it('不正な形式は0(暗い扱い)として返す', () => {
    expect(relativeLuminance('not-a-color')).toBe(0);
  });
});
