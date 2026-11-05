/**
 * 確認用背景(市松/指定色)の明るさに応じて、カード内の文字色(明るい/暗い)を選ぶための
 * 色ユーティリティ(追加修正指示書 第3弾 項目14参照)。
 */

/** 背景が暗いときに使う明るい文字色のセット。 */
export const LIGHT_TEXT_COLORS = { fg: '#f5f3ee', fgMuted: '#c9c4b8' } as const;
/** 背景が明るいときに使う暗い文字色のセット(既定の--color-text/--color-text-mutedと合わせる)。 */
export const DARK_TEXT_COLORS = { fg: '#2b2b28', fgMuted: '#6b6b63' } as const;

/** 背景が暗いとみなす相対輝度のしきい値(これ未満なら暗い背景)。 */
export const DARK_BACKGROUND_LUMINANCE_THRESHOLD = 0.5;

export interface PreviewTextColors {
  /** 通常のテキスト(ファイル名・選択ボタン等)に使う色。 */
  fg: string;
  /** 補助的なテキスト(容量表示等)に使う、少し弱めた色。 */
  fgMuted: string;
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAGの相対輝度(0=黒〜1=白)を、#RRGGBB形式のHEXから計算する。不正な形式なら0(暗い扱い)。 */
export function relativeLuminance(hex: string): number {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) {
    return 0;
  }
  const value = match[1] as string;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/**
 * 背景色(HEX)に対して読みやすい文字色を選ぶ。相対輝度が
 * `DARK_BACKGROUND_LUMINANCE_THRESHOLD` 未満(暗い背景)なら明るい文字、
 * それ以上(明るい背景)なら暗い文字を返す。
 */
export function pickTextColor(hex: string): PreviewTextColors {
  return relativeLuminance(hex) < DARK_BACKGROUND_LUMINANCE_THRESHOLD
    ? LIGHT_TEXT_COLORS
    : DARK_TEXT_COLORS;
}
